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
/// POSIX `EINVAL` ("Invalid argument") — `renamex_np` returns this if a
/// flag combination isn't valid, which some non-APFS filesystems return
/// for `RENAME_EXCL` alone.
const EINVAL: i32 = 22;
/// macOS `ENOTSUP` ("Operation not supported") — what `renamex_np`
/// actually returns on exFAT/msdosfs volumes when asked for
/// `RENAME_EXCL`, even though the destination is completely free.
/// Confirmed empirically against an `hdiutil`-mounted ExFAT volume.
const ENOTSUP: i32 = 45;

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

/// Performs the actual rename, returning `Some((from, to))` if the
/// caller should fall back to copy+verify+delete (EXDEV), `None` on
/// success, or an error for anything else.
///
/// No case-only special-casing here: `renamex_np`'s `RENAME_EXCL` flag
/// (and its portable `checked_rename` fallback, via inode identity)
/// already treats a rename of a file to a case-variant of its own path
/// as the safe, in-place rename it is — while still refusing to
/// silently clobber a genuinely *different* file that happens to share
/// a case-insensitive name, even on case-sensitive volumes.
fn do_rename(rename_fn: &RenameFn, from: &Path, to: &Path) -> DpResult<Option<(PathBuf, PathBuf)>> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DpError::io(&e, Some(parent.display().to_string())))?;
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

/// Whether `from` and `to` refer to the same on-disk file (same device +
/// inode) — as opposed to merely having string-equal (or case-variant)
/// paths, which is *not* a reliable "same file" signal on case-sensitive
/// filesystems (two distinct files can share a case-insensitive name
/// there). Returns `Ok(false)` (rather than an error) whenever either
/// path can't be stat'd, since "can't prove it's the same file" should
/// be treated as "assume it isn't" by callers.
fn same_file(from: &Path, to: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;

    let Ok(from_meta) = std::fs::metadata(from) else {
        return false;
    };
    let Ok(to_meta) = std::fs::symlink_metadata(to) else {
        return false;
    };

    from_meta.dev() == to_meta.dev() && from_meta.ino() == to_meta.ino()
}

/// Portable, non-atomic "no-replace" rename: the entire implementation
/// on platforms without `renamex_np`, and the fallback used when
/// `renamex_np` itself reports `RENAME_EXCL` isn't supported at all
/// (exFAT/msdosfs — confirmed to return `ENOTSUP` even for a completely
/// free destination). Not atomic: on these filesystems there's an
/// unavoidable TOCTOU window between the existence check and the actual
/// rename, where a concurrent writer could create `to` in between. This
/// is an accepted, documented limitation of non-APFS volumes.
fn checked_rename(from: &Path, to: &Path) -> io::Result<()> {
    if same_file(from, to) {
        // Identical file (typically differing only by letter case): a
        // plain rename is always safe and is exactly what that needs.
        return std::fs::rename(from, to);
    }

    if std::fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::from_raw_os_error(EEXIST));
    }

    std::fs::rename(from, to)
}

/// Attempts `primary` (macOS's atomic, exclusive `renamex_np`) first;
/// if the filesystem doesn't support the exclusive-rename flag at all
/// (`ENOTSUP`/`EINVAL`), falls back to the portable [`checked_rename`].
/// Any other error from `primary` — including a genuine `EEXIST` or
/// `EXDEV` — is returned unchanged, so `do_rename`'s handling of those
/// still applies.
fn rename_with_fallback(
    from: &Path,
    to: &Path,
    primary: &dyn Fn(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    match primary(from, to) {
        Ok(()) => Ok(()),
        Err(e) if matches!(e.raw_os_error(), Some(ENOTSUP) | Some(EINVAL)) => checked_rename(from, to),
        Err(e) => Err(e),
    }
}

/// Atomically renames `from` to `to`, failing rather than silently
/// overwriting an existing `to`. Uses `renamex_np(2)` with
/// `RENAME_EXCL` on macOS — a single atomic syscall rather than a
/// racy exists-check-then-rename, and (per Apple's documented and
/// empirically-confirmed behavior) already correct for a case-only
/// self-rename on both case-sensitive and case-insensitive APFS. Falls
/// back to [`checked_rename`] when the volume doesn't support the flag
/// (exFAT/msdosfs) or isn't macOS at all.
#[cfg(target_os = "macos")]
fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    rename_with_fallback(from, to, &renamex_np_exclusive)
}

/// From `<sys/stdio.h>` (see the `renamex_np(2)` man page): both the
/// `renamex_np` prototype and the `RENAME_EXCL` flag are declared
/// there, not in `<sys/fcntl.h>` as the name might suggest.
#[cfg(target_os = "macos")]
fn renamex_np_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

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
    checked_rename(from, to)
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

        let from_hash = match self.hasher.hash_file(&from).await {
            Ok(h) => h,
            Err(e) => {
                remove_and_warn(&temp, "failed to remove partial copy after a source-hash error").await;
                return Err(e);
            }
        };
        let temp_hash = match self.hasher.hash_file(&temp).await {
            Ok(h) => h,
            Err(e) => {
                remove_and_warn(
                    &temp,
                    "failed to remove partial copy after a destination-hash error",
                )
                .await;
                return Err(e);
            }
        };

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
/// clobber a stale temp file left over from a previous attempt,
/// preserves `from`'s mtime on the copy, and `fsync`s the copy before
/// it's considered done (so a verified-then-renamed file was actually
/// durable, not just buffered). Cleans up `temp` if any step fails
/// partway through.
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

    let result = write_and_sync_temp(&mut src, &mut dest, temp);
    if result.is_err() {
        drop(dest);
        if let Err(remove_err) = std::fs::remove_file(temp) {
            tracing::warn!(error = %remove_err, path = %temp.display(), "failed to remove partial copy after a failed write");
        }
    }
    result
}

fn write_and_sync_temp(src: &mut std::fs::File, dest: &mut std::fs::File, temp: &Path) -> DpResult<()> {
    std::io::copy(src, dest).map_err(|e| DpError::io(&e, Some(temp.display().to_string())))?;

    if let Ok(metadata) = src.metadata() {
        if let Ok(mtime) = metadata.modified() {
            if let Err(e) = dest.set_modified(mtime) {
                tracing::warn!(error = %e, path = %temp.display(), "failed to preserve source mtime on copy");
            }
        }
    }

    dest.sync_all()
        .map_err(|e| DpError::io(&e, Some(temp.display().to_string())))?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rename_with_fallback_falls_back_on_enotsup() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("src.txt");
        std::fs::write(&from, b"hello").unwrap();
        let to = dir.path().join("dst.txt");

        let primary = |_: &Path, _: &Path| -> io::Result<()> { Err(io::Error::from_raw_os_error(ENOTSUP)) };

        rename_with_fallback(&from, &to, &primary).unwrap();

        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"hello");
    }

    #[test]
    fn rename_with_fallback_falls_back_on_einval() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("src.txt");
        std::fs::write(&from, b"hello").unwrap();
        let to = dir.path().join("dst.txt");

        let primary = |_: &Path, _: &Path| -> io::Result<()> { Err(io::Error::from_raw_os_error(EINVAL)) };

        rename_with_fallback(&from, &to, &primary).unwrap();

        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"hello");
    }

    #[test]
    fn rename_with_fallback_passes_through_other_errors() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("src.txt");
        std::fs::write(&from, b"hello").unwrap();
        let to = dir.path().join("dst.txt");

        let primary = |_: &Path, _: &Path| -> io::Result<()> { Err(io::Error::from_raw_os_error(EEXIST)) };

        let err = rename_with_fallback(&from, &to, &primary).unwrap_err();

        assert_eq!(err.raw_os_error(), Some(EEXIST));
        assert!(from.exists(), "no fallback should have run");
        assert!(!to.exists());
    }

    #[test]
    fn checked_rename_refuses_existing_destination() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("src.txt");
        std::fs::write(&from, b"hello").unwrap();
        let to = dir.path().join("dst.txt");
        std::fs::write(&to, b"already here").unwrap();

        let err = checked_rename(&from, &to).unwrap_err();

        assert_eq!(err.raw_os_error(), Some(EEXIST));
        assert_eq!(std::fs::read(&to).unwrap(), b"already here");
        assert!(from.exists());
    }

    #[test]
    fn checked_rename_moves_when_free() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("src.txt");
        std::fs::write(&from, b"hello").unwrap();
        let to = dir.path().join("dst.txt");

        checked_rename(&from, &to).unwrap();

        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"hello");
    }

    #[test]
    fn checked_rename_allows_case_only_self_rename() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("Photo.jpg");
        std::fs::write(&from, b"hello").unwrap();
        let to = dir.path().join("photo.jpg");

        checked_rename(&from, &to).unwrap();

        assert_eq!(std::fs::read(&to).unwrap(), b"hello");
    }
}
