use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult};
use image::RgbImage;
use tokio::io::AsyncWriteExt;

use crate::{blocking, resize_fit, PREVIEW_SLOT};

/// Lossy WebP encoding quality used for stored thumbnails (0-100).
const WEBP_QUALITY: f32 = 82.0;

/// Encode `img` as lossy WebP on the blocking pool. Shared by
/// [`ThumbStore::write`] and [`ThumbStore::regen_preview`].
async fn encode_webp(img: RgbImage) -> DpResult<Vec<u8>> {
    blocking(move || {
        let (w, h) = (img.width(), img.height());
        Ok(webp::Encoder::from_rgb(&img, w, h).encode(WEBP_QUALITY).to_vec())
    })
    .await
}

/// On-disk store for rendered thumbnails, laid out as
/// `root/<hash>/<size>.webp`.
pub struct ThumbStore {
    root: PathBuf,
}

impl ThumbStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The store's root directory — every thumbnail lives under
    /// `root/<hash>/<size>.webp`. Used by the storage-usage and reset-app-
    /// data commands, which need the raw path rather than a per-hash one.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The path a thumbnail for `hash` at `size` would live at, whether or
    /// not it currently exists.
    pub fn path(&self, hash: &str, size: u32) -> PathBuf {
        self.root.join(hash).join(format!("{size}.webp"))
    }

    /// Whether a thumbnail for `hash` at `size` has already been written.
    pub fn exists(&self, hash: &str, size: u32) -> bool {
        self.path(hash, size).exists()
    }

    /// Encode `img` as lossy WebP and write it to disk, creating parent
    /// directories as needed. Returns the path written.
    pub async fn write(&self, hash: &str, size: u32, img: &RgbImage) -> DpResult<PathBuf> {
        let path = self.path(hash, size);
        let encoded = encode_webp(img.clone()).await?;

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| DpError::Io {
                message: format!("failed to create thumbnail directory: {e}"),
                path: Some(parent.display().to_string()),
            })?;
        }

        tokio::fs::write(&path, &encoded).await.map_err(|e| DpError::Io {
            message: format!("failed to write thumbnail: {e}"),
            path: Some(path.display().to_string()),
        })?;

        Ok(path)
    }

    /// Every hash directory currently under the store root — i.e. every
    /// hash that has at least one thumbnail slot written. Used by
    /// `dp_jobs::RegenJob` to enumerate what to (maybe) downscale. Returns
    /// an empty list, rather than erroring, when the root doesn't exist
    /// yet (nothing has ever been thumbnailed).
    pub async fn list_hashes(&self) -> DpResult<Vec<String>> {
        let root = self.root.clone();
        blocking(move || {
            if !root.exists() {
                return Ok(Vec::new());
            }
            let entries = std::fs::read_dir(&root).map_err(|e| DpError::Io {
                message: format!("failed to read thumbs root: {e}"),
                path: Some(root.display().to_string()),
            })?;

            let mut hashes = Vec::new();
            for entry in entries {
                let entry = entry.map_err(|e| DpError::Io {
                    message: format!("failed to read thumbs root entry: {e}"),
                    path: Some(root.display().to_string()),
                })?;
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                if !is_dir {
                    continue;
                }
                if let Some(name) = entry.file_name().to_str() {
                    hashes.push(name.to_string());
                }
            }
            Ok(hashes)
        })
        .await
    }

    /// Downscales `hash`'s cached preview slot ([`PREVIEW_SLOT`]) to
    /// `target_edge` if it's currently larger, replacing it atomically
    /// (temp file + rename, so a crash mid-write never corrupts the
    /// existing thumbnail). Never upscales: if the current preview's
    /// longest edge already fits within `target_edge`, this is a no-op.
    /// The `400.webp` thumb slot is never touched.
    ///
    /// Returns `Some((old_bytes, new_bytes))` when it rewrote the file,
    /// `None` when there was nothing to do — either the preview slot
    /// doesn't exist for this hash, or it's already small enough.
    pub async fn regen_preview(&self, hash: &str, target_edge: u32) -> DpResult<Option<(u64, u64)>> {
        let path = self.path(hash, PREVIEW_SLOT);

        let bytes = match tokio::fs::read(&path).await {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => {
                return Err(DpError::Io {
                    message: format!("failed to read cached preview: {e}"),
                    path: Some(path.display().to_string()),
                })
            }
        };
        let old_bytes = bytes.len() as u64;

        let encoded = blocking(move || -> DpResult<Option<Vec<u8>>> {
            let img = image::load_from_memory(&bytes)
                .map_err(|e| DpError::Io {
                    message: format!("failed to decode cached preview: {e}"),
                    path: None,
                })?
                .to_rgb8();
            let (w, h) = (img.width(), img.height());
            if w.max(h) <= target_edge {
                return Ok(None);
            }
            let resized = resize_fit(img, target_edge);
            let (rw, rh) = (resized.width(), resized.height());
            Ok(Some(
                webp::Encoder::from_rgb(&resized, rw, rh)
                    .encode(WEBP_QUALITY)
                    .to_vec(),
            ))
        })
        .await?;

        let Some(encoded) = encoded else {
            return Ok(None);
        };
        let new_bytes = encoded.len() as u64;

        let tmp_path = self.root.join(hash).join(format!("{PREVIEW_SLOT}.webp.tmp"));
        // `sync_all` before the rename — without it, a power loss between
        // the write and the rename can let the rename land on disk ahead
        // of the data it points at, leaving a torn/empty preview behind.
        // That would be unusually sticky here: a scan's existence check
        // would treat the torn file as present (never re-rendering it),
        // and a later regen would fail to decode it — the only recovery
        // would be RESET APP DATA. See also `sweep_orphaned_tmp`, which
        // cleans up the *temp* file if the process dies before the
        // rename below ever runs.
        let mut tmp_file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| DpError::Io {
                message: format!("failed to create regenerated preview temp file: {e}"),
                path: Some(tmp_path.display().to_string()),
            })?;
        tmp_file.write_all(&encoded).await.map_err(|e| DpError::Io {
            message: format!("failed to write regenerated preview: {e}"),
            path: Some(tmp_path.display().to_string()),
        })?;
        tmp_file.sync_all().await.map_err(|e| DpError::Io {
            message: format!("failed to fsync regenerated preview: {e}"),
            path: Some(tmp_path.display().to_string()),
        })?;
        drop(tmp_file);

        tokio::fs::rename(&tmp_path, &path)
            .await
            .map_err(|e| DpError::Io {
                message: format!("failed to replace preview with regenerated version: {e}"),
                path: Some(path.display().to_string()),
            })?;

        Ok(Some((old_bytes, new_bytes)))
    }

    /// Removes every orphaned `regen_preview` temp file (`*.tmp`) left
    /// under any hash directory — the leftover of a process killed
    /// between writing the temp file and renaming it into place (see the
    /// comment in [`Self::regen_preview`]). Meant to be called once at
    /// the start of every `RegenJob` run, so a crash mid-rewrite doesn't
    /// leave dead weight behind indefinitely; a store with nothing to
    /// sweep returns `Ok(0)` cheaply.
    ///
    /// A failure reading one hash directory, or removing one file, is
    /// skipped rather than propagated — this is best-effort cleanup, not
    /// something worth failing an entire regen run over. Only a failure
    /// to read the store root itself is a real error.
    pub async fn sweep_orphaned_tmp(&self) -> DpResult<u64> {
        let root = self.root.clone();
        blocking(move || {
            if !root.exists() {
                return Ok(0);
            }
            let hash_dirs = std::fs::read_dir(&root).map_err(|e| DpError::Io {
                message: format!("failed to read thumbs root: {e}"),
                path: Some(root.display().to_string()),
            })?;

            let mut removed = 0u64;
            for hash_dir in hash_dirs.flatten() {
                if !hash_dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let Ok(entries) = std::fs::read_dir(hash_dir.path()) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let is_tmp = entry.file_name().to_str().is_some_and(|s| s.ends_with(".tmp"));
                    if is_tmp && std::fs::remove_file(entry.path()).is_ok() {
                        removed += 1;
                    }
                }
            }
            Ok(removed)
        })
        .await
    }
}
