//! Background watcher that keeps registered drives' `mount_path`/`free`
//! fields in sync with which volumes are actually mounted, polling every
//! [`POLL_INTERVAL`] and notifying the frontend via a `"drives:changed"`
//! event whenever anything changed.

use std::time::Duration;

use dp_volumes::resolve_presence;
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// How often the presence watcher polls for mounted volumes.
const POLL_INTERVAL: Duration = Duration::from_secs(5);

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
        // gated on `current` actually having something left to fill,
        // rather than firing on every 5s tick for every matched drive
        // forever (review finding 5).
        let current_missing_identity = current.volume_uuid.is_none() || current.volume_label.is_none();
        if current_missing_identity
            && m.mount_path.is_some()
            && (m.volume_uuid.is_some() || m.volume_label.is_some())
        {
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
