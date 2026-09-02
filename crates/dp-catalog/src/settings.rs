//! Typed access to the `settings` key/value table (see
//! `0001_init.sql`) — the preview-quality edge and the relocated
//! thumbnail-cache root, read via [`Catalog::get_settings`] and written
//! via [`Catalog::set_preview_edge`]/[`Catalog::set_thumbs_dir`]. Unset
//! keys fall back to their defaults rather than erroring, so a catalog
//! that predates a setting (or a fresh one that's never had it written)
//! behaves exactly as the app did before the setting existed.

use crate::sqlite::db;
use dp_core::{AppSettings, DpResult, DEFAULT_PREVIEW_EDGE};
use sqlx::{Row, SqlitePool};

/// The `settings.key` the preview-quality edge is stored under.
const PREVIEW_EDGE_KEY: &str = "preview_edge";

/// The `settings.key` the relocated thumbnail-cache root is stored under.
/// Absent (or empty) means the default `<app-data>/thumbs`.
const THUMBS_DIR_KEY: &str = "thumbs_dir";

async fn get_value(pool: &SqlitePool, key: &str) -> DpResult<Option<String>> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(db)?;
    match row {
        Some(row) => Ok(Some(row.try_get("value").map_err(db)?)),
        None => Ok(None),
    }
}

pub(crate) async fn get_settings(pool: &SqlitePool) -> DpResult<AppSettings> {
    let preview_edge = match get_value(pool, PREVIEW_EDGE_KEY).await? {
        // A value that somehow isn't a valid u32 (hand-edited DB,
        // future format change) falls back to the default rather
        // than failing the whole settings read.
        Some(value) => value.parse::<u32>().unwrap_or(DEFAULT_PREVIEW_EDGE),
        None => DEFAULT_PREVIEW_EDGE,
    };

    // An empty string is treated as unset — `set_thumbs_dir(None)` clears
    // the row outright, but this keeps a hand-emptied value from producing
    // a nonsensical "" cache root.
    let thumbs_dir = get_value(pool, THUMBS_DIR_KEY).await?.filter(|v| !v.is_empty());

    Ok(AppSettings {
        preview_edge,
        thumbs_dir,
    })
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

/// Persists (or with `None`, clears) the relocated thumbnail-cache root.
/// Written by `move_cache` strictly AFTER the on-disk move has fully
/// succeeded — this function itself does no filesystem work.
pub(crate) async fn set_thumbs_dir(pool: &SqlitePool, dir: Option<&str>) -> DpResult<()> {
    match dir {
        Some(dir) => {
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (?, ?) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(THUMBS_DIR_KEY)
            .bind(dir)
            .execute(pool)
            .await
            .map_err(db)?;
        }
        None => {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(THUMBS_DIR_KEY)
                .execute(pool)
                .await
                .map_err(db)?;
        }
    }
    Ok(())
}
