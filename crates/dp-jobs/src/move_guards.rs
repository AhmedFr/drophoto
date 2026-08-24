//! Filesystem-safety guards shared by every job that moves a file to (or
//! from) a location under a drive's mount point — currently
//! [`crate::OrganizeJob`] and [`crate::RevertJob`]. Kept in one place so
//! the two jobs can never drift apart on what counts as "safe": a bug
//! fixed in one must be fixed in both, and extracting the checks here is
//! what makes that automatic.

use std::path::{Component, Path};
use std::sync::Arc;

use dp_catalog::Catalog;
use dp_metadata::sidecar_path;
use dp_organize::MoveStrategy;

use crate::{JobCtx, JobEvent};

/// How many items are applied between two checks that the drive is still
/// mounted. A drive yanked mid-run would otherwise have every single
/// remaining item fail its own way through the filesystem — one
/// pointless `ItemError` per photo — instead of the run stopping at the
/// first sign the destination isn't there any more.
pub(crate) const MOUNT_RECHECK_INTERVAL: usize = 50;

/// Whether `rel_path` (rendered relative to `mount`, yielding `resolved`)
/// would escape `mount`: either because it contains a component that
/// isn't a plain path segment (an absolute-path root/prefix, or a `.`/
/// `..` traversal component), or because the resulting joined path
/// doesn't actually stay under `mount`.
///
/// Purely lexical — it says nothing about what the path *resolves* to
/// once symlinks are followed; that's [`destination_is_inside`]'s job.
pub(crate) fn escapes_mount(rel_path: &str, resolved: &Path, mount: &Path) -> bool {
    let has_unsafe_component = Path::new(rel_path).components().any(|c| {
        matches!(
            c,
            Component::RootDir | Component::Prefix(_) | Component::ParentDir | Component::CurDir
        )
    });
    has_unsafe_component || !resolved.starts_with(mount)
}

/// Whether `to` really lands inside `mount` once symlinks are resolved.
///
/// `to` itself usually doesn't exist yet (that's the whole point of the
/// move), so this resolves the deepest ancestor of `to` that *does*
/// exist — `mount` at worst, since `to` is always built by joining onto
/// it — and requires that to sit under the canonical `mount`. A
/// directory symlink planted anywhere along the way (`<mount>/archive`
/// → `/Users/me/Pictures`) therefore fails here, before a single byte
/// is written outside the drive.
///
/// Anything that can't be proven inside is treated as outside: a mount
/// that won't canonicalize (the drive vanished), a dangling symlink, a
/// path whose ancestors have all disappeared.
pub(crate) fn destination_is_inside(to: &Path, mount: &Path) -> bool {
    let Ok(mount_real) = mount.canonicalize() else {
        return false;
    };

    let mut candidate = Some(to);
    while let Some(path) = candidate {
        if std::fs::symlink_metadata(path).is_ok() {
            return match path.canonicalize() {
                Ok(real) => real.starts_with(&mount_real),
                Err(_) => false,
            };
        }
        candidate = path.parent();
    }

    false
}

/// [`destination_is_inside`] off the async runtime — it stats and
/// canonicalizes real paths, which can block on a slow/spinning drive.
pub(crate) async fn destination_stays_on_drive(to: &Path, mount: &Path) -> bool {
    let to = to.to_path_buf();
    let mount = mount.to_path_buf();
    tokio::task::spawn_blocking(move || destination_is_inside(&to, &mount))
        .await
        .unwrap_or(false)
}

/// Whether the drive is still mounted where the job expects it.
pub(crate) fn mount_is_online(mount_path: &str) -> bool {
    Path::new(mount_path).exists()
}

/// [`mount_is_online`] off the async runtime. A join error is read as
/// "still online" so a runtime hiccup can never abort a healthy run —
/// the per-item errors remain the backstop if the drive really is gone.
pub(crate) async fn mount_online(mount_path: &str) -> bool {
    let mount_path = mount_path.to_string();
    tokio::task::spawn_blocking(move || mount_is_online(&mount_path))
        .await
        .unwrap_or(true)
}

/// After a media move `from → to` has already succeeded and the catalog
/// already reflects it, moves that item's `.xmp` sidecar (if any) along
/// with it — best-effort, and never a reason to undo or reclassify the
/// media move itself: the caller has already committed to `Moved` by the
/// time this runs. `old_rel_path`/`new_rel_path` are the *media* item's
/// own rel paths (relative to `mount`); the sidecar's rel paths are
/// derived by appending `.xmp` to each, which is cheaper than re-deriving
/// them from `from`/`to` and is exactly equivalent since [`sidecar_path`]
/// only ever appends `.xmp` to the file name.
///
/// Nothing happens if there's no sidecar to move (`sc_from` doesn't
/// exist). Otherwise, if the sidecar's own [`escapes_mount`] /
/// [`destination_stays_on_drive`] guards refuse it, or `strategy.move_file`
/// itself fails, the failure is reported exactly the same way: an
/// `ItemError` with code `"sidecar"` on `ctx.events`, and the row is
/// marked `sidecar_pending` so a later sync job recreates the sidecar at
/// its new location. A failure in `mark_sidecar_pending` itself is only
/// logged — this whole function is best-effort and must never fail the
/// item it was called for.
///
/// Shared by [`crate::OrganizeJob::apply_move`] and
/// [`crate::RevertJob::apply_revert`] so the two jobs can't drift on how
/// a sidecar tags along with its file.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn move_sidecar_along(
    ctx: &JobCtx,
    job_id: &str,
    catalog: &Arc<dyn Catalog>,
    strategy: &Arc<dyn MoveStrategy>,
    media_id: i64,
    from: &Path,
    to: &Path,
    old_rel_path: &str,
    new_rel_path: &str,
    mount: &Path,
) {
    let sc_from = sidecar_path(from);
    if std::fs::symlink_metadata(&sc_from).is_err() {
        return;
    }
    let sc_to = sidecar_path(to);
    let old_sc_rel = format!("{old_rel_path}.xmp");
    let new_sc_rel = format!("{new_rel_path}.xmp");

    let refused = escapes_mount(&old_sc_rel, &sc_from, mount)
        || escapes_mount(&new_sc_rel, &sc_to, mount)
        || !destination_stays_on_drive(&sc_to, mount).await;

    let message = if refused {
        Some("sidecar path escapes the drive root".to_string())
    } else {
        match strategy.move_file(&sc_from, &sc_to).await {
            Ok(()) => None,
            Err(e) => Some(e.to_string()),
        }
    };

    let Some(message) = message else {
        return;
    };

    let _ = ctx
        .events
        .send(JobEvent::ItemError {
            job_id: job_id.to_string(),
            path: sc_from.display().to_string(),
            code: "sidecar".to_string(),
            message,
        })
        .await;

    if let Err(e) = catalog.mark_sidecar_pending(media_id).await {
        tracing::warn!(error = %e, media_id, "failed to mark sidecar pending after a sidecar move failure");
    }
}

#[cfg(test)]
mod tests {
    use super::{destination_is_inside, escapes_mount, mount_is_online};
    use std::path::Path;

    #[test]
    fn escapes_mount_rejects_parent_dir_component() {
        let mount = Path::new("/Volumes/A");
        let to = mount.join("../escape.jpg");
        assert!(escapes_mount("../escape.jpg", &to, mount));
    }

    #[test]
    fn escapes_mount_rejects_absolute_new_path() {
        let mount = Path::new("/Volumes/A");
        let to = Path::new("/etc/passwd");
        assert!(escapes_mount("/etc/passwd", to, mount));
    }

    #[test]
    fn escapes_mount_allows_a_plain_relative_path() {
        let mount = Path::new("/Volumes/A");
        let to = mount.join("archive/2025/Q3/2025-09-12_a.jpg");
        assert!(!escapes_mount("archive/2025/Q3/2025-09-12_a.jpg", &to, mount));
    }

    #[test]
    fn destination_is_inside_accepts_a_not_yet_created_subdirectory() {
        let mount = tempfile::tempdir().unwrap();
        let to = mount.path().join("archive/2025/Q3/a.jpg");
        assert!(destination_is_inside(&to, mount.path()));
    }

    #[test]
    fn destination_is_inside_rejects_a_directory_symlink_pointing_out_of_the_mount() {
        let mount = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), mount.path().join("archive")).unwrap();

        let to = mount.path().join("archive/2025/Q3/a.jpg");
        assert!(!destination_is_inside(&to, mount.path()));
    }

    #[test]
    fn destination_is_inside_rejects_a_mount_that_does_not_exist() {
        let mount = Path::new("/definitely/not/a/mount/point/dp-organize");
        assert!(!destination_is_inside(&mount.join("a.jpg"), mount));
    }

    #[test]
    fn mount_is_online_is_false_for_a_missing_path() {
        assert!(!mount_is_online("/definitely/not/a/mount/point/dp-organize"));
    }

    #[test]
    fn mount_is_online_is_true_for_a_mounted_path() {
        let dir = tempfile::tempdir().unwrap();
        assert!(mount_is_online(&dir.path().to_string_lossy()));
    }
}
