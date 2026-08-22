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

fn role_from_str(s: &str) -> DpResult<DriveRole> {
    match s {
        "source" => Ok(DriveRole::Source),
        "archive" => Ok(DriveRole::Archive),
        other => Err(DpError::Db {
            message: format!("invalid drive role: {other}"),
        }),
    }
}

fn row_to_drive(row: SqliteRow) -> DpResult<Drive> {
    let mount_path: Option<String> = row.try_get("mount_path").map_err(db)?;
    let online = mount_path.is_some();
    let role: String = row.try_get("role").map_err(db)?;
    let capacity: i64 = row.try_get("capacity").map_err(db)?;
    let free: i64 = row.try_get("free").map_err(db)?;
    let last_seen_at: Option<String> = row.try_get("last_seen_at").map_err(db)?;
    let last_seen_at = last_seen_at
        .map(|s| DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)))
        .transpose()
        .map_err(db)?;
    Ok(Drive {
        id: row.try_get("id").map_err(db)?,
        name: row.try_get("name").map_err(db)?,
        volume_uuid: row.try_get("volume_uuid").map_err(db)?,
        mount_path,
        role: role_from_str(&role)?,
        capacity: capacity as u64,
        free: free as u64,
        last_seen_at,
        online,
    })
}

async fn get_drive(pool: &SqlitePool, id: i64) -> DpResult<Drive> {
    let row = sqlx::query("SELECT * FROM drives WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    row_to_drive(row)
}

pub(crate) async fn register_drive(pool: &SqlitePool, d: NewDrive) -> DpResult<Drive> {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO drives (name, volume_uuid, mount_path, role, capacity, free, last_seen_at) \
         VALUES (?, NULL, ?, ?, ?, ?, ?)",
    )
    .bind(&d.name)
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

pub(crate) async fn list_drives(pool: &SqlitePool) -> DpResult<Vec<Drive>> {
    let rows = sqlx::query("SELECT * FROM drives ORDER BY name")
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.into_iter().map(row_to_drive).collect()
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
