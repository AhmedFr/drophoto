use crate::sqlite::db;
use chrono::{DateTime, Utc};
use dp_core::{DpError, DpResult, Drive, DriveRole, NewDrive};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

fn role_to_str(role: DriveRole) -> &'static str {
    match role {
        DriveRole::Source => "source",
        DriveRole::Archive => "archive",
    }
}

pub(crate) fn role_from_str(s: &str) -> DpResult<DriveRole> {
    match s {
        "source" => Ok(DriveRole::Source),
        "archive" => Ok(DriveRole::Archive),
        other => Err(DpError::Db {
            message: format!("invalid drive role: {other}"),
        }),
    }
}

/// Builds a `Drive` from a row's columns, each looked up as `{prefix}{column}`.
/// `prefix` is `""` for a plain `SELECT * FROM drives` and e.g. `"d_"` for a
/// joined query that aliases the drives columns to avoid collisions with
/// another table's columns of the same name.
pub(crate) fn row_to_drive_prefixed(row: &SqliteRow, prefix: &str) -> DpResult<Drive> {
    let col = |name: &str| format!("{prefix}{name}");
    let mount_path: Option<String> = row.try_get(col("mount_path").as_str()).map_err(db)?;
    let online = mount_path.is_some();
    let role: String = row.try_get(col("role").as_str()).map_err(db)?;
    let capacity: i64 = row.try_get(col("capacity").as_str()).map_err(db)?;
    let free: i64 = row.try_get(col("free").as_str()).map_err(db)?;
    let last_seen_at: Option<String> = row.try_get(col("last_seen_at").as_str()).map_err(db)?;
    let last_seen_at = last_seen_at
        .map(|s| DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)))
        .transpose()
        .map_err(db)?;
    Ok(Drive {
        id: row.try_get(col("id").as_str()).map_err(db)?,
        name: row.try_get(col("name").as_str()).map_err(db)?,
        volume_uuid: row.try_get(col("volume_uuid").as_str()).map_err(db)?,
        volume_label: row.try_get(col("volume_label").as_str()).map_err(db)?,
        mount_path,
        role: role_from_str(&role)?,
        capacity: capacity as u64,
        free: free as u64,
        last_seen_at,
        online,
    })
}

fn row_to_drive(row: &SqliteRow) -> DpResult<Drive> {
    row_to_drive_prefixed(row, "")
}

async fn get_drive(pool: &SqlitePool, id: i64) -> DpResult<Drive> {
    let row = sqlx::query("SELECT * FROM drives WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    row_to_drive(&row)
}

pub(crate) async fn register_drive(pool: &SqlitePool, d: NewDrive) -> DpResult<Drive> {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO drives (name, volume_uuid, volume_label, mount_path, role, capacity, free, last_seen_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&d.name)
    .bind(&d.volume_uuid)
    .bind(&d.volume_label)
    .bind(&d.mount_path)
    .bind(role_to_str(d.role))
    .bind(d.capacity as i64)
    .bind(d.free as i64)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(db)?;
    get_drive(pool, result.last_insert_rowid()).await
}

/// Fills `volume_uuid`/`volume_label` on drive `id` from the volume it's
/// currently matched to, but only where each is still `NULL` (`COALESCE`
/// keeps whatever the row already has) — the presence watcher's
/// self-healing backfill for a drive registered before either column
/// existed, or a legacy drive whose earlier registration never captured
/// them. Called on every presence-resolve tick for a matched drive; a
/// no-op once both columns are already set.
pub(crate) async fn backfill_drive_volume_identity(
    pool: &SqlitePool,
    id: i64,
    volume_uuid: Option<&str>,
    volume_label: Option<&str>,
) -> DpResult<()> {
    sqlx::query(
        "UPDATE drives SET volume_uuid = COALESCE(volume_uuid, ?), \
         volume_label = COALESCE(volume_label, ?) WHERE id = ?",
    )
    .bind(volume_uuid)
    .bind(volume_label)
    .bind(id)
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(())
}

/// Adopts the volume at `mount_path` into drive `id`, **overwriting**
/// `volume_uuid`/`volume_label`/`mount_path` (and `free`/`last_seen_at`)
/// unconditionally — the one deliberate overwrite path in this module,
/// unlike [`backfill_drive_volume_identity`]'s COALESCE-only self-heal.
///
/// It exists for exactly the case COALESCE can never fix: a drive whose
/// stored identity (or complete lack of one — a pre-identity legacy row
/// whose `mount_path` was already nulled by [`set_drive_presence`] while
/// offline) no longer matches ANY currently-mounted volume, so
/// `dp_volumes::resolve_presence` can never re-attach it on its own — the
/// exact drive that produced this feature's original field report. The
/// user is explicitly telling the app "this is the same physical drive,
/// now under a different volume identity" via the RELINK action on an
/// offline `DriveCard`; overwriting is correct here (unlike backfill)
/// because it's a one-time, user-initiated, unambiguous correction rather
/// than an automatic write running on every presence-watcher tick.
///
/// Preserves the row's `id` — and therefore every `media`/`sources`/tag/
/// organize-history row that references it — which is the whole point
/// versus Forget + re-register, which would discard all of that.
pub(crate) async fn relink_drive(
    pool: &SqlitePool,
    id: i64,
    volume_uuid: Option<&str>,
    volume_label: Option<&str>,
    mount_path: &str,
    free: Option<u64>,
) -> DpResult<()> {
    let now = Utc::now().to_rfc3339();
    match free {
        Some(f) => {
            sqlx::query(
                "UPDATE drives SET volume_uuid = ?, volume_label = ?, mount_path = ?, \
                 free = ?, last_seen_at = ? WHERE id = ?",
            )
            .bind(volume_uuid)
            .bind(volume_label)
            .bind(mount_path)
            .bind(f as i64)
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await
            .map_err(db)?;
        }
        None => {
            sqlx::query(
                "UPDATE drives SET volume_uuid = ?, volume_label = ?, mount_path = ?, \
                 last_seen_at = ? WHERE id = ?",
            )
            .bind(volume_uuid)
            .bind(volume_label)
            .bind(mount_path)
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await
            .map_err(db)?;
        }
    }
    Ok(())
}

pub(crate) async fn list_drives(pool: &SqlitePool) -> DpResult<Vec<Drive>> {
    let rows = sqlx::query("SELECT * FROM drives ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.into_iter().map(|r| row_to_drive(&r)).collect()
}

pub(crate) async fn set_drive_presence(
    pool: &SqlitePool,
    id: i64,
    mount_path: Option<&str>,
    free: Option<u64>,
) -> DpResult<()> {
    match mount_path {
        Some(mp) => {
            let now = Utc::now().to_rfc3339();
            match free {
                Some(f) => {
                    sqlx::query("UPDATE drives SET mount_path = ?, last_seen_at = ?, free = ? WHERE id = ?")
                        .bind(mp)
                        .bind(&now)
                        .bind(f as i64)
                        .bind(id)
                        .execute(pool)
                        .await
                        .map_err(db)?;
                }
                None => {
                    sqlx::query("UPDATE drives SET mount_path = ?, last_seen_at = ? WHERE id = ?")
                        .bind(mp)
                        .bind(&now)
                        .bind(id)
                        .execute(pool)
                        .await
                        .map_err(db)?;
                }
            }
        }
        None => {
            sqlx::query("UPDATE drives SET mount_path = NULL WHERE id = ?")
                .bind(id)
                .execute(pool)
                .await
                .map_err(db)?;
        }
    }
    Ok(())
}
