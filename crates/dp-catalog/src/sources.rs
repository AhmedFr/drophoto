//! Per-drive scan sources: the `sources` table, and listing/upserting/
//! enabling/deleting them.

use crate::sqlite::db;
use dp_core::{DpError, DpResult, NewSource, Source};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

/// Validates and normalizes a source's `rel_path`: rejects a NUL byte,
/// any absolute path, and any `..` (`ParentDir`) component, then
/// normalizes what's left — backslashes become forward slashes, `.`
/// components and empty components (i.e. leading `./`, trailing `/`, and
/// collapsed `//`) are dropped. `""` (the mount root) is always allowed
/// and normalizes to itself.
pub fn normalize_rel_path(raw: &str) -> DpResult<String> {
    if raw.contains('\0') {
        return Err(DpError::Unsupported {
            message: "source path must not contain a NUL byte".into(),
            path: Some(raw.to_string()),
        });
    }
    let slashified = raw.replace('\\', "/");
    if slashified.starts_with('/') {
        return Err(DpError::Unsupported {
            message: "source path must be relative to the drive mount, not absolute".into(),
            path: Some(raw.to_string()),
        });
    }

    let mut parts: Vec<&str> = Vec::new();
    for component in slashified.split('/') {
        match component {
            "" | "." => continue,
            ".." => {
                return Err(DpError::Unsupported {
                    message: "source path must not contain \"..\"".into(),
                    path: Some(raw.to_string()),
                });
            }
            other => parts.push(other),
        }
    }
    Ok(parts.join("/"))
}

fn row_to_source(row: &SqliteRow) -> DpResult<Source> {
    let enabled: i64 = row.try_get("enabled").map_err(db)?;
    Ok(Source {
        id: row.try_get("id").map_err(db)?,
        drive_id: row.try_get("drive_id").map_err(db)?,
        rel_path: row.try_get("rel_path").map_err(db)?,
        enabled: enabled != 0,
    })
}

pub(crate) async fn list_sources(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<Source>> {
    let rows = sqlx::query("SELECT * FROM sources WHERE drive_id = ? ORDER BY rel_path")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_source).collect()
}

pub(crate) async fn list_enabled_sources(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<Source>> {
    let rows = sqlx::query("SELECT * FROM sources WHERE drive_id = ? AND enabled = 1 ORDER BY rel_path")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_source).collect()
}

/// Inserts a new source for `s.drive_id`/`s.rel_path` (validated and
/// normalized — see [`normalize_rel_path`]), or, if one already exists
/// for that (drive_id, normalized rel_path) pair, re-enables it (a
/// previously-deleted-in-spirit but merely-disabled source is simply
/// turned back on rather than duplicated).
pub(crate) async fn upsert_source(pool: &SqlitePool, s: NewSource) -> DpResult<Source> {
    let rel_path = normalize_rel_path(&s.rel_path)?;

    sqlx::query(
        "INSERT INTO sources (drive_id, rel_path, enabled) VALUES (?, ?, 1) \
         ON CONFLICT(drive_id, rel_path) DO UPDATE SET enabled = 1",
    )
    .bind(s.drive_id)
    .bind(&rel_path)
    .execute(pool)
    .await
    .map_err(db)?;

    let row = sqlx::query("SELECT * FROM sources WHERE drive_id = ? AND rel_path = ?")
        .bind(s.drive_id)
        .bind(&rel_path)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    row_to_source(&row)
}

pub(crate) async fn set_source_enabled(pool: &SqlitePool, id: i64, enabled: bool) -> DpResult<()> {
    sqlx::query("UPDATE sources SET enabled = ? WHERE id = ?")
        .bind(enabled as i64)
        .bind(id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

pub(crate) async fn delete_source(pool: &SqlitePool, id: i64) -> DpResult<()> {
    sqlx::query("DELETE FROM sources WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_rel_path;

    #[test]
    fn empty_is_allowed_and_normalizes_to_empty() {
        assert_eq!(normalize_rel_path("").unwrap(), "");
    }

    #[test]
    fn strips_leading_dot_slash_and_trailing_slash() {
        assert_eq!(normalize_rel_path("./DCIM/").unwrap(), "DCIM");
    }

    #[test]
    fn collapses_double_slash() {
        assert_eq!(normalize_rel_path("DCIM//a").unwrap(), "DCIM/a");
    }

    #[test]
    fn rejects_parent_dir_component() {
        assert!(normalize_rel_path("../x").is_err());
        assert!(normalize_rel_path("DCIM/../x").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        assert!(normalize_rel_path("/etc").is_err());
    }

    #[test]
    fn rejects_nul_byte() {
        assert!(normalize_rel_path("DCIM/\0evil").is_err());
    }

    #[test]
    fn normalizes_backslashes_to_forward_slashes() {
        assert_eq!(normalize_rel_path("DCIM\\Sub").unwrap(), "DCIM/Sub");
    }
}
