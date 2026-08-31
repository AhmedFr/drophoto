//! Background watcher that keeps registered drives' `mount_path`/`free`
//! fields in sync with which volumes are actually mounted, polling every
//! [`POLL_INTERVAL`] and notifying the frontend via a `"drives:changed"`
//! event whenever anything changed.

use std::time::Duration;

use dp_core::Drive;
use dp_volumes::{resolve_presence, PresenceMatch};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// How often the presence watcher polls for mounted volumes.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Whether `m` actually supplies an identity value `current`'s stored row
/// is missing — the backfill gate for
/// [`dp_catalog::backfill_drive_volume_identity`]. Requires the *specific*
/// column being written to currently be `NULL`, rather than "matched &&
/// something is still missing anywhere on the row": the looser check
/// collapses to "matched" for any volume whose `uuid` can never be read
/// (exFAT/FAT32, or any mount where `diskutil` fails), since
/// `m.volume_label` is `Some` for every match — which fired a no-op
/// `COALESCE` `UPDATE` (and its WAL frame) every [`POLL_INTERVAL`] tick
/// forever. See review finding 3.
fn should_backfill_identity(current: &Drive, m: &PresenceMatch) -> bool {
    (current.volume_uuid.is_none() && m.volume_uuid.is_some())
        || (current.volume_label.is_none() && m.volume_label.is_some())
}

/// Spawns the presence watcher loop on the Tauri async runtime.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tick(&app).await;
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

async fn tick(app: &AppHandle) {
    tracing::debug!("presence watcher tick");
    let state = app.state::<AppState>();

    let (drives, volumes) = match (state.catalog.list_drives().await, state.volumes.list().await) {
        (Ok(drives), Ok(volumes)) => (drives, volumes),
        (Err(e), _) => {
            tracing::warn!("presence watcher: failed to list drives: {e}");
            return;
        }
        (_, Err(e)) => {
            tracing::warn!("presence watcher: failed to list volumes: {e}");
            return;
        }
    };

    let resolved = resolve_presence(&drives, &volumes);
    let mut changed = false;

    for m in resolved {
        let Some(current) = drives.iter().find(|d| d.id == m.drive_id) else {
            continue;
        };

        // Self-heal a legacy drive's identity columns the moment it's
        // matched to a mounted volume — see
        // `dp_catalog::backfill_drive_volume_identity`'s doc comment.
        // `COALESCE` on the write side makes the call itself a no-op once
        // both columns are already set, but SQLite still performs the
        // write and a WAL frame every time regardless — so this is also
        // gated on the matched volume actually supplying a value the
        // stored row lacks (see `should_backfill_identity`), rather than
        // firing on every 5s tick for every matched drive forever (review
        // finding 3).
        if should_backfill_identity(current, &m) {
            if let Err(e) = state
                .catalog
                .backfill_drive_volume_identity(
                    m.drive_id,
                    m.volume_uuid.as_deref(),
                    m.volume_label.as_deref(),
                )
                .await
            {
                tracing::warn!(
                    "presence watcher: failed to backfill volume identity for drive {}: {e}",
                    m.drive_id
                );
            }
        }

        let free_changed = matches!(m.free_bytes, Some(f) if f != current.free);
        if current.mount_path == m.mount_path && !free_changed {
            continue;
        }
        if let Err(e) = state
            .catalog
            .set_drive_presence(m.drive_id, m.mount_path.as_deref(), m.free_bytes)
            .await
        {
            tracing::warn!("presence watcher: failed to update drive {}: {e}", m.drive_id);
            continue;
        }
        changed = true;
    }

    if changed {
        if let Err(e) = app.emit("drives:changed", ()) {
            tracing::warn!("presence watcher: failed to emit drives:changed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dp_core::DriveRole;

    fn drive(volume_uuid: Option<&str>, volume_label: Option<&str>) -> Drive {
        Drive {
            id: 1,
            name: "Kodachrome".to_string(),
            volume_uuid: volume_uuid.map(str::to_string),
            volume_label: volume_label.map(str::to_string),
            mount_path: Some("/Volumes/Kodachrome".to_string()),
            role: DriveRole::Source,
            capacity: 100,
            free: 10,
            last_seen_at: None,
            online: true,
        }
    }

    fn matched(volume_uuid: Option<&str>, volume_label: Option<&str>) -> PresenceMatch {
        PresenceMatch {
            drive_id: 1,
            mount_path: Some("/Volumes/Kodachrome".to_string()),
            free_bytes: Some(10),
            volume_uuid: volume_uuid.map(str::to_string),
            volume_label: volume_label.map(str::to_string),
        }
    }

    #[test]
    fn does_not_backfill_a_uuid_less_volume_once_the_label_is_already_stored() {
        // Review finding 3: a volume with no readable `VolumeUUID`
        // (exFAT/FAT32, or any mount where `diskutil` fails) always
        // supplies a `Some` label, so once the row's `volume_label` is
        // already stored there is nothing left for this match to fill —
        // this must not fire a no-op `UPDATE` on every tick forever.
        let current = drive(None, Some("Kodachrome"));
        let m = matched(None, Some("Kodachrome"));
        assert!(!should_backfill_identity(&current, &m));
    }

    #[test]
    fn backfills_when_the_stored_row_is_missing_the_uuid_the_match_supplies() {
        let current = drive(None, Some("Kodachrome"));
        let m = matched(Some("uuid-1"), Some("Kodachrome"));
        assert!(should_backfill_identity(&current, &m));
    }

    #[test]
    fn backfills_when_the_stored_row_is_missing_the_label_the_match_supplies() {
        let current = drive(Some("uuid-1"), None);
        let m = matched(Some("uuid-1"), Some("Kodachrome"));
        assert!(should_backfill_identity(&current, &m));
    }

    #[test]
    fn does_not_backfill_once_both_columns_are_already_stored() {
        let current = drive(Some("uuid-1"), Some("Kodachrome"));
        let m = matched(Some("uuid-1"), Some("Kodachrome"));
        assert!(!should_backfill_identity(&current, &m));
    }

    #[test]
    fn does_not_backfill_a_fully_unset_row_when_the_match_supplies_nothing() {
        let current = drive(None, None);
        let m = matched(None, None);
        assert!(!should_backfill_identity(&current, &m));
    }
}
