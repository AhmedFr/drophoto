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

    for (id, mount_path, free) in resolved {
        let Some(current) = drives.iter().find(|d| d.id == id) else {
            continue;
        };
        let free_changed = matches!(free, Some(f) if f != current.free);
        if current.mount_path == mount_path && !free_changed {
            continue;
        }
        if let Err(e) = state
            .catalog
            .set_drive_presence(id, mount_path.as_deref(), free)
            .await
        {
            tracing::warn!("presence watcher: failed to update drive {id}: {e}");
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
