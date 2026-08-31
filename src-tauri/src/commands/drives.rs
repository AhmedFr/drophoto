use crate::state::AppState;
use dp_core::{DpError, Drive, NewDrive, Volume};
use tauri::State;

/// Whether `volume` is already claimed by a *registered* drive other than
/// `exclude_drive_id` — either by uuid or by its own display name — used
/// by [`plan_relink`] to refuse adopting a volume into a second drive row
/// (the same one-volume-one-drive invariant `resolve_presence` enforces
/// at match time, checked here up front instead of only ever discovering
/// the collision on the next presence tick).
fn volume_claimed_by_another_drive(volume: &Volume, drives: &[Drive], exclude_drive_id: i64) -> bool {
    drives.iter().any(|d| {
        d.id != exclude_drive_id
            && ((volume.uuid.is_some() && d.volume_uuid.as_deref() == volume.uuid.as_deref())
                || d.volume_label.as_deref() == Some(volume.name.as_str()))
    })
}

/// The catalog write [`relink_drive`] performs, once `mount_path` has
/// been resolved against the currently-mounted `volumes` and checked for
/// a claim conflict against `drives` — factored out as a pure function so
/// the decision (which mounted volume, refuse or not) is unit-testable
/// without a real `AppState`.
#[derive(Debug)]
struct RelinkPlan {
    volume_uuid: Option<String>,
    volume_label: Option<String>,
    mount_path: String,
    free: Option<u64>,
}

fn plan_relink(
    volumes: &[Volume],
    drives: &[Drive],
    drive_id: i64,
    mount_path: &str,
) -> Result<RelinkPlan, DpError> {
    let volume = volumes
        .iter()
        .find(|v| v.mount_path == mount_path)
        .ok_or_else(|| DpError::Unsupported {
            message: format!("no mounted volume at {mount_path}"),
            path: Some(mount_path.to_string()),
        })?;

    if volume_claimed_by_another_drive(volume, drives, drive_id) {
        return Err(DpError::Unsupported {
            message: format!("\"{}\" is already registered as another drive", volume.name),
            path: None,
        });
    }

    Ok(RelinkPlan {
        volume_uuid: volume.uuid.clone(),
        volume_label: Some(volume.name.clone()),
        mount_path: volume.mount_path.clone(),
        free: Some(volume.free_bytes),
    })
}

/// The per-drive job kinds [`forget_drive`] refuses to run alongside — a
/// scan, organize/revert (both tracked under the `"organize"` admission
/// bucket — see `AppState::start_organize`/`start_revert`), or a sidecar
/// sync could all still be writing rows for this drive_id; forgetting it
/// out from under one would either race the write or silently resurrect
/// rows the job re-inserts. Global jobs (geocode/regen, tracked under the
/// sentinel drive id `0`) are never scoped to a single drive, so they're
/// never checked here.
const DRIVE_JOB_KINDS: [&str; 3] = ["scan", "organize", "sidecar"];

#[tauri::command]
pub async fn register_drive(state: State<'_, AppState>, input: NewDrive) -> Result<Drive, DpError> {
    state.catalog.register_drive(input).await
}

#[tauri::command]
pub async fn list_drives(state: State<'_, AppState>) -> Result<Vec<Drive>, DpError> {
    state.catalog.list_drives().await
}

/// Permanently forgets `drive_id` — deletes it and every catalog row that
/// references it (see `dp_catalog::forget_drive`'s doc comment for the
/// exact cascade). Refuses while any job is running for this drive: a
/// running scan/organize/sidecar-sync could still be inserting or
/// updating rows this same call is about to delete out from under it.
/// Works offline (an unplugged drive is exactly the case this action
/// exists for) — never touches the filesystem, only `catalog.db`.
#[tauri::command]
pub async fn forget_drive(state: State<'_, AppState>, drive_id: i64) -> Result<(), DpError> {
    for kind in DRIVE_JOB_KINDS {
        if state.active_job(kind, drive_id).is_some() {
            return Err(DpError::Unsupported {
                message: format!(
                    "a {kind} job is running on this drive — wait for it to finish before forgetting it"
                ),
                path: None,
            });
        }
    }
    state.catalog.forget_drive(drive_id).await
}

/// Adopts the mounted volume at `mount_path` into `drive_id`, overwriting
/// its stored `volume_uuid`/`volume_label`/`mount_path` and bringing it
/// online — the RELINK action on an offline `DriveCard`. Unlike Forget +
/// re-register, this preserves the row's id and therefore every
/// media/source/tag/organize-history row that references it; it exists
/// for a drive `resolve_presence` can never re-attach on its own (no
/// uuid/label/name/prior-mount-path match), which is exactly the drive
/// that produced this feature's original field report — see
/// `dp_catalog::drives::relink_drive`'s doc comment.
///
/// Refuses with [`DpError::Unsupported`] if `mount_path` isn't currently
/// mounted, or if the volume there is already claimed (by uuid or label)
/// by a *different* registered drive — relinking must never silently
/// double-claim a volume another drive row already owns.
#[tauri::command]
pub async fn relink_drive(
    state: State<'_, AppState>,
    drive_id: i64,
    mount_path: String,
) -> Result<(), DpError> {
    let volumes = state.volumes.list().await?;
    let drives = state.catalog.list_drives().await?;
    let plan = plan_relink(&volumes, &drives, drive_id, &mount_path)?;

    state
        .catalog
        .relink_drive(
            drive_id,
            plan.volume_uuid.as_deref(),
            plan.volume_label.as_deref(),
            &plan.mount_path,
            plan.free,
        )
        .await
}

/// How many media rows `drive_id` currently has in the catalog — what the
/// `FORGET…` confirmation dialog shows the user before they type the
/// confirmation phrase ("removes N photos…"), so the count reflects
/// reality even for a drive that's currently offline (no filesystem walk
/// involved, purely a catalog read).
#[tauri::command]
pub async fn count_drive_media(state: State<'_, AppState>, drive_id: i64) -> Result<u64, DpError> {
    state.catalog.count_media(Some(drive_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use dp_core::DriveRole;

    fn drive(id: i64, volume_uuid: Option<&str>, volume_label: Option<&str>) -> Drive {
        Drive {
            id,
            name: format!("Drive {id}"),
            volume_uuid: volume_uuid.map(str::to_string),
            volume_label: volume_label.map(str::to_string),
            mount_path: None,
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
            last_seen_at: None,
            online: false,
        }
    }

    fn volume(name: &str, mount_path: &str, uuid: Option<&str>) -> Volume {
        Volume {
            name: name.to_string(),
            mount_path: mount_path.to_string(),
            total_bytes: 1_000,
            free_bytes: 123,
            is_removable: true,
            uuid: uuid.map(str::to_string),
        }
    }

    #[test]
    fn plan_relink_resolves_the_chosen_volumes_identity() {
        let volumes = vec![volume("T7", "/Volumes/T7", Some("uuid-real"))];
        let drives = vec![drive(1, None, None)];

        let plan = plan_relink(&volumes, &drives, 1, "/Volumes/T7").unwrap();

        assert_eq!(plan.volume_uuid, Some("uuid-real".to_string()));
        assert_eq!(plan.volume_label, Some("T7".to_string()));
        assert_eq!(plan.mount_path, "/Volumes/T7");
        assert_eq!(plan.free, Some(123));
    }

    #[test]
    fn plan_relink_refuses_a_mount_path_that_is_not_currently_mounted() {
        let err = plan_relink(&[], &[drive(1, None, None)], 1, "/Volumes/Ghost").unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    #[test]
    fn plan_relink_refuses_a_volume_already_claimed_by_another_drive_via_uuid() {
        let volumes = vec![volume("T7", "/Volumes/T7", Some("uuid-real"))];
        let drives = vec![
            drive(1, None, None),
            drive(2, Some("uuid-real"), None), // already owns this volume
        ];

        let err = plan_relink(&volumes, &drives, 1, "/Volumes/T7").unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    #[test]
    fn plan_relink_refuses_a_volume_already_claimed_by_another_drive_via_label() {
        let volumes = vec![volume("T7", "/Volumes/T7", None)];
        let drives = vec![drive(1, None, None), drive(2, None, Some("T7"))];

        let err = plan_relink(&volumes, &drives, 1, "/Volumes/T7").unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    /// Relinking a drive to the volume it *already* owns must never
    /// refuse itself as "claimed by another drive" — `exclude_drive_id`
    /// must actually exclude the target.
    #[test]
    fn plan_relink_allows_a_drive_to_relink_to_its_own_already_claimed_volume() {
        let volumes = vec![volume("T7", "/Volumes/T7", Some("uuid-real"))];
        let drives = vec![drive(1, Some("uuid-real"), Some("T7"))];

        assert!(plan_relink(&volumes, &drives, 1, "/Volumes/T7").is_ok());
    }

    #[test]
    fn volume_claimed_by_another_drive_ignores_two_volumes_with_no_uuid() {
        // Neither the candidate volume nor the other drive has a uuid —
        // `None == None` must never count as a match.
        let v = volume("Untitled", "/Volumes/Untitled", None);
        let drives = vec![drive(2, None, None)];
        assert!(!volume_claimed_by_another_drive(&v, &drives, 1));
    }
}
