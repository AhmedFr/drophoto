//! Typed access to the `settings` key/value table (see
//! `0001_init.sql`) — currently just the preview-quality edge, read via
//! [`Catalog::get_settings`] and written via
//! [`Catalog::set_preview_edge`]. Unset keys fall back to
//! [`DEFAULT_PREVIEW_EDGE`] rather than erroring, so a catalog that
//! predates this setting (or a fresh one that's never had it written)
//! behaves exactly as the app did before the setting existed.

use crate::sqlite::db;
use dp_core::{AppSettings, DpResult, DEFAULT_PREVIEW_EDGE};
use sqlx::{Row, SqlitePool};

/// The `settings.key` the preview-quality edge is stored under.
const PREVIEW_EDGE_KEY: &str = "preview_edge";

pub(crate) async fn get_settings(pool: &SqlitePool) -> DpResult<AppSettings> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(PREVIEW_EDGE_KEY)
        .fetch_optional(pool)
        .await
        .map_err(db)?;

    let preview_edge = match row {
        Some(row) => {
            let value: String = row.try_get("value").map_err(db)?;
            // A value that somehow isn't a valid u32 (hand-edited DB,
            // future format change) falls back to the default rather
            // than failing the whole settings read.
            value.parse::<u32>().unwrap_or(DEFAULT_PREVIEW_EDGE)
        }
        None => DEFAULT_PREVIEW_EDGE,
    };

    Ok(AppSettings { preview_edge })
}

pub(crate) async fn set_preview_edge(pool: &SqlitePool, edge: u32) -> DpResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(PREVIEW_EDGE_KEY)
    .bind(edge.to_string())
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(())
}
