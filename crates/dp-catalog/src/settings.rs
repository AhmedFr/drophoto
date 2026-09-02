//! Typed access to the `settings` key/value table (see
//! `0001_init.sql`) — the preview-quality edge and the relocated
//! thumbnail-cache root, read via [`Catalog::get_settings`] and written
//! via [`Catalog::set_preview_edge`]/[`Catalog::set_thumbs_dir`]. Unset
//! keys fall back to their defaults rather than erroring, so a catalog
//! that predates a setting (or a fresh one that's never had it written)
//! behaves exactly as the app did before the setting existed.

use crate::sqlite::db;
use dp_core::{AppSettings, DpResult, OrganizeDefaults, DEFAULT_PREVIEW_EDGE};
use sqlx::{Row, SqlitePool};

/// The `settings.key` the preview-quality edge is stored under.
const PREVIEW_EDGE_KEY: &str = "preview_edge";

/// The `settings.key` the relocated thumbnail-cache root is stored under.
/// Absent (or empty) means the default `<app-data>/thumbs`.
const THUMBS_DIR_KEY: &str = "thumbs_dir";

/// The `settings.key`s the four [`OrganizeDefaults`] fields are stored
/// under — see [`get_organize_defaults`]/[`set_organize_defaults`].
const DEFAULT_ROOT_KEY: &str = "default_root";
const DEFAULT_FOLDER_TPL_KEY: &str = "default_folder_tpl";
const DEFAULT_FILE_TPL_KEY: &str = "default_file_tpl";
const DEFAULT_KEEP_PAIRS_KEY: &str = "default_keep_pairs";

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
    set_value(pool, THUMBS_DIR_KEY, dir).await
}

/// Upserts `key` to `value` when `Some`, else deletes the row — the same
/// set-or-clear shape [`set_thumbs_dir`] used inline before this was
/// factored out for [`set_organize_defaults`]'s four keys.
async fn set_value(pool: &SqlitePool, key: &str, value: Option<&str>) -> DpResult<()> {
    match value {
        Some(value) => {
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (?, ?) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(key)
            .bind(value)
            .execute(pool)
            .await
            .map_err(db)?;
        }
        None => {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(key)
                .execute(pool)
                .await
                .map_err(db)?;
        }
    }
    Ok(())
}

/// The settings-backed organize-rule defaults — see
/// [`dp_core::OrganizeDefaults`]'s doc comment for how `Catalog::get_rule`
/// composes them. Each field independently falls back to `None` (never
/// written, or hand-emptied — same "empty string means unset" convention
/// as [`get_settings`]'s `thumbs_dir` handling) rather than failing the
/// whole read.
pub(crate) async fn get_organize_defaults(pool: &SqlitePool) -> DpResult<OrganizeDefaults> {
    let root = get_value(pool, DEFAULT_ROOT_KEY).await?.filter(|v| !v.is_empty());
    let folder_tpl = get_value(pool, DEFAULT_FOLDER_TPL_KEY)
        .await?
        .filter(|v| !v.is_empty());
    let file_tpl = get_value(pool, DEFAULT_FILE_TPL_KEY)
        .await?
        .filter(|v| !v.is_empty());
    // An unparseable stored value (hand-edited DB) is treated as unset,
    // same rationale as `get_settings`'s `preview_edge` parse fallback.
    let keep_pairs = get_value(pool, DEFAULT_KEEP_PAIRS_KEY)
        .await?
        .and_then(|v| v.parse::<i64>().ok())
        .map(|v| v != 0);

    Ok(OrganizeDefaults {
        root,
        folder_tpl,
        file_tpl,
        keep_pairs,
    })
}

/// Persists [`OrganizeDefaults`]: each `Some` field upserts its key, each
/// `None` clears it (returning that field to "fall back to
/// `OrganizeRule::default_for`"). Sets all four keys unconditionally on
/// every call — a caller that wants to leave a field untouched must first
/// read the current defaults (via [`get_organize_defaults`]) and pass its
/// value back through unchanged.
pub(crate) async fn set_organize_defaults(pool: &SqlitePool, defaults: &OrganizeDefaults) -> DpResult<()> {
    set_value(pool, DEFAULT_ROOT_KEY, defaults.root.as_deref()).await?;
    set_value(pool, DEFAULT_FOLDER_TPL_KEY, defaults.folder_tpl.as_deref()).await?;
    set_value(pool, DEFAULT_FILE_TPL_KEY, defaults.file_tpl.as_deref()).await?;
    set_value(
        pool,
        DEFAULT_KEEP_PAIRS_KEY,
        defaults.keep_pairs.map(|v| if v { "1" } else { "0" }),
    )
    .await?;
    Ok(())
}
