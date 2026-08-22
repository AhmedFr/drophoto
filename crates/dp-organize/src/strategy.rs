//! Move strategies: how a planned move actually gets applied to the
//! filesystem.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use dp_core::{DpError, DpResult};
use dp_hash::Hasher;

/// Moves a file from one path to another.
#[async_trait::async_trait]
pub trait MoveStrategy: Send + Sync {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()>;
}

/// Runs a blocking closure on tokio's blocking thread pool.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> DpResult<T> + Send + 'static) -> DpResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| DpError::Io {
        message: format!("blocking task panicked: {e}"),
        path: None,
    })?
}

/// POSIX `EEXIST` ("File exists").
const EEXIST: i32 = 17;
/// POSIX `EXDEV` ("Invalid cross-device link").
const EXDEV: i32 = 18;

type RenameFn = dyn Fn(&Path, &Path) -> io::Result<()> + Send + Sync;

/// Moves a file with an atomic, no-overwrite rename, creating the
/// destination's parent directories first. On `EXDEV` (rename across
/// filesystems/volumes) falls back to [`CopyVerifyDeleteStrategy`].
pub struct RenameStrategy {
    hasher: Arc<dyn Hasher>,
    rename_fn: Arc<RenameFn>,
}

impl RenameStrategy {
    pub fn new(hasher: Arc<dyn Hasher>) -> Self {
        Self {
            hasher,
            rename_fn: Arc::new(rename_no_replace),
        }
    }

    /// Builds a `RenameStrategy` with an injectable rename implementation.
    /// This is a documented test/injection seam: it lets failure modes
    /// (like `EXDEV`) be exercised deterministically without two real
    /// volumes.
    pub fn with_rename(
        hasher: Arc<dyn Hasher>,
        rename_fn: impl Fn(&Path, &Path) -> io::Result<()> + Send + Sync + 'static,
    ) -> Self {
        Self {
            hasher,
            rename_fn: Arc::new(rename_fn),
        }
    }
}

#[async_trait::async_trait]
impl MoveStrategy for RenameStrategy {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()> {
        let from = from.to_path_buf();
        let to = to.to_path_buf();
        let rename_fn = self.rename_fn.clone();

        let needs_fallback = blocking(move || do_rename(rename_fn.as_ref(), &from, &to)).await?;

        match needs_fallback {
            None => Ok(()),
            Some((from, to)) => {
                let fallback = CopyVerifyDeleteStrategy {
                    hasher: self.hasher.clone(),
                };
                fallback.move_file(&from, &to).await
            }
        }
    }
}

/// True when `from` and `to` name the same path up to letter case —
/// i.e. this is a case-only rename of a file to itself, which macOS's
/// default (case-insensitive) filesystem handles as a normal in-place
/// rename, not an overwrite of a *different* file.
fn is_case_only_rename(from: &Path, to: &Path) -> bool {
    from != to && from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase()
}

/// Performs the actual rename, returning `Some((from, to))` if the
/// caller should fall back to copy+verify+delete (EXDEV), `None` on
/// success, or an error for anything else.
fn do_rename(rename_fn: &RenameFn, from: &Path, to: &Path) -> DpResult<Option<(PathBuf, PathBuf)>> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DpError::io(&e, Some(parent.display().to_string())))?;
    }

    if is_case_only_rename(from, to) {
        // `to` "exists" here only because it's the very file we're
        // renaming (same inode, different case) — the no-overwrite guard
        // below would otherwise reject it. A plain rename is safe and
        // correct for this case.
        return std::fs::rename(from, to)
            .map(|()| None)
            .map_err(|e| DpError::io(&e, Some(to.display().to_string())));
    }

    match rename_fn(from, to) {
        Ok(()) => Ok(None),
        Err(e) if e.raw_os_error() == Some(EEXIST) => Err(DpError::Io {
            message: "destination exists".into(),
            path: Some(to.display().to_string()),
        }),
        Err(e) if e.raw_os_error() == Some(EXDEV) => Ok(Some((from.to_path_buf(), to.to_path_buf()))),
        Err(e) => Err(DpError::io(&e, Some(to.display().to_string()))),
    }
}

/// Atomically renames `from` to `to`, failing rather than silently
/// overwriting an existing `to`. Avoids the exists-check/rename race by
/// using `renamex_np(2)` with `RENAME_EXCL` on macOS; other targets fall
/// back to a (non-atomic) exists-check followed by `fs::rename`.
#[cfg(target_os = "macos")]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    // From <sys/fcntl.h> / the `renamex_np(2)` man page.
    const RENAME_EXCL: libc::c_uint = 0x0000_0004;

    extern "C" {
        fn renamex_np(from: *const libc::c_char, to: *const libc::c_char, flags: libc::c_uint)
            -> libc::c_int;
    }

    let from_c = CString::new(from.as_os_str().as_bytes())?;
    let to_c = CString::new(to.as_os_str().as_bytes())?;

    let rc = unsafe { renamex_np(from_c.as_ptr(), to_c.as_ptr(), RENAME_EXCL) };
    if rc != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    if to.exists() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    std::fs::rename(from, to)
}

/// The sibling temp path a copy is staged at before being verified and
/// atomically renamed into place: `to` with `.drophoto-partial`
/// appended to its file name.
fn temp_path_for(to: &Path) -> PathBuf {
    let mut name: OsString = to.file_name().map(OsString::from).unwrap_or_default();
    name.push(".drophoto-partial");
    to.with_file_name(name)
}

/// Removes `path`, logging (rather than swallowing) any failure to do
/// so — best-effort cleanup shouldn't hide its own errors, but also
/// shouldn't shadow the primary error being returned to the caller.
async fn remove_and_warn(path: &Path, context: &'static str) {
    let path = path.to_path_buf();
    let result = blocking(move || std::fs::remove_file(&path).map_err(|e| DpError::io(&e, None))).await;
    if let Err(e) = result {
        tracing::warn!(error = %e, "{context}");
    }
}

/// Moves a file by copying it to a sibling temp file, verifying the
/// copy's content hash matches the source's, atomically renaming the
/// temp file into place, then deleting the source. Used when a plain
/// rename can't cross filesystems.
pub struct CopyVerifyDeleteStrategy {
    pub hasher: Arc<dyn Hasher>,
}

#[async_trait::async_trait]
impl MoveStrategy for CopyVerifyDeleteStrategy {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()> {
        let from = from.to_path_buf();
        let to = to.to_path_buf();
        let temp = temp_path_for(&to);

        {
            let from = from.clone();
            let temp = temp.clone();
            blocking(move || copy_to_temp(&from, &temp)).await?;
        }

        let from_hash = self.hasher.hash_file(&from).await?;
        let temp_hash = self.hasher.hash_file(&temp).await?;

        if from_hash != temp_hash {
            remove_and_warn(
                &temp,
                "failed to remove partial copy after a verification mismatch",
            )
            .await;
            return Err(DpError::Io {
                message: "verification failed".into(),
                path: Some(to.display().to_string()),
            });
        }

        let finalize_result = {
            let temp = temp.clone();
            let to = to.clone();
            blocking(move || finalize_copy(&temp, &to)).await
        };
        if let Err(e) = finalize_result {
            remove_and_warn(&temp, "failed to remove partial copy after a failed finalize").await;
            return Err(e);
        }

        blocking(move || {
            std::fs::remove_file(&from).map_err(|e| DpError::io(&e, Some(from.display().to_string())))
        })
        .await
    }
}

/// Copies `from` into the not-yet-existing `temp` path, refusing to
/// clobber a stale temp file left over from a previous attempt, and
/// preserves `from`'s mtime on the copy. Cleans up any partially-written
/// `temp` file if the copy itself fails partway through.
fn copy_to_temp(from: &Path, temp: &Path) -> DpResult<()> {
    if let Some(parent) = temp.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DpError::io(&e, Some(parent.display().to_string())))?;
    }

    let mut src = std::fs::File::open(from).map_err(|e| DpError::io(&e, Some(from.display().to_string())))?;
    let mut dest = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temp)
        .map_err(|e| DpError::io(&e, Some(temp.display().to_string())))?;

    if let Err(e) = std::io::copy(&mut src, &mut dest) {
        drop(dest);
        if let Err(remove_err) = std::fs::remove_file(temp) {
            tracing::warn!(error = %remove_err, path = %temp.display(), "failed to remove partial copy after a failed write");
        }
        return Err(DpError::io(&e, Some(temp.display().to_string())));
    }

    if let Ok(metadata) = src.metadata() {
        if let Ok(mtime) = metadata.modified() {
            let _ = dest.set_modified(mtime);
        }
    }

    Ok(())
}

/// Atomically renames a verified temp copy into its final place.
fn finalize_copy(temp: &Path, to: &Path) -> DpResult<()> {
    match rename_no_replace(temp, to) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(EEXIST) => Err(DpError::Io {
            message: "destination exists".into(),
            path: Some(to.display().to_string()),
        }),
        Err(e) => Err(DpError::io(&e, Some(to.display().to_string()))),
    }
}

/// The default move strategy: rename with a copy+verify+delete fallback
/// for cross-filesystem moves.
pub fn default_strategy(hasher: Arc<dyn Hasher>) -> Arc<dyn MoveStrategy> {
    Arc::new(RenameStrategy::new(hasher))
}
