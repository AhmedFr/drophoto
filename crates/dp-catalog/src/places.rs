//! `places`: named locations reverse-geocoded from media GPS coordinates
//! (or entered manually), and the `media.place_id` column that links a
//! media row to one. Geocoder rows are deduped by `(name, admin, country,
//! source)` via [`upsert_place`] — the reverse-geocode job calls it once
//! per resolved coordinate and gets back the same [`dp_core::Place`] row
//! for repeat locations.

use crate::media::row_to_media;
use crate::sqlite::db;
use dp_core::{DpError, DpResult, MediaRow, NewPlace, Place, PlaceCount, PlaceSource};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

fn source_to_str(s: PlaceSource) -> &'static str {
    match s {
        PlaceSource::Geocoder => "geocoder",
        PlaceSource::Manual => "manual",
    }
}

fn source_from_str(s: &str) -> DpResult<PlaceSource> {
    match s {
        "geocoder" => Ok(PlaceSource::Geocoder),
        "manual" => Ok(PlaceSource::Manual),
        other => Err(DpError::Db {
            message: format!("invalid place source: {other}"),
        }),
    }
}

fn row_to_place(row: &SqliteRow) -> DpResult<Place> {
    let source: String = row.try_get("source").map_err(db)?;
    Ok(Place {
        id: row.try_get("id").map_err(db)?,
        lat: row.try_get("lat").map_err(db)?,
        lon: row.try_get("lon").map_err(db)?,
        name: row.try_get("name").map_err(db)?,
        admin: row.try_get("admin").map_err(db)?,
        country: row.try_get("country").map_err(db)?,
        source: source_from_str(&source)?,
    })
}

async fn get_place(pool: &SqlitePool, id: i64) -> DpResult<Place> {
    let row = sqlx::query("SELECT * FROM places WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    row_to_place(&row)
}

/// `admin IS ?` rather than `admin = ?` so a `NULL` `admin` on both sides
/// (very common — many places have no meaningful admin region) still
/// counts as a match; SQLite's `IS` treats two `NULL`s as equal where `=`
/// would not.
async fn find_place_id(pool: &SqlitePool, p: &NewPlace, source: &str) -> DpResult<Option<i64>> {
    sqlx::query_scalar("SELECT id FROM places WHERE name = ? AND admin IS ? AND country = ? AND source = ?")
        .bind(&p.name)
        .bind(&p.admin)
        .bind(&p.country)
        .bind(source)
        .fetch_optional(pool)
        .await
        .map_err(db)
}

/// Finds an existing place matching `(name, admin, country, source)`, or
/// creates one from `p`. This is how the reverse-geocode job avoids
/// creating a fresh `places` row for every media row that resolves to the
/// same location — repeat lookups return the same id.
///
/// The insert itself is `ON CONFLICT DO NOTHING` against the
/// `places_identity` unique index (mirroring `sources::upsert_source`),
/// rather than a plain `SELECT`-then-`INSERT`: two callers racing to
/// upsert the same identity (e.g. the geocode job resolving two media
/// rows to the same city concurrently) could otherwise both pass the
/// initial `find_place_id` check and both insert, producing duplicate
/// rows. The conflicting insert simply does nothing and the follow-up
/// `find_place_id` picks up whichever row — this caller's or the other
/// racer's — ended up committed first.
pub(crate) async fn upsert_place(pool: &SqlitePool, p: NewPlace) -> DpResult<Place> {
    let source = source_to_str(p.source);
    if let Some(id) = find_place_id(pool, &p, source).await? {
        return get_place(pool, id).await;
    }
    sqlx::query(
        "INSERT INTO places (lat, lon, name, admin, country, source) VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT (name, IFNULL(admin, ''), country, source) DO NOTHING",
    )
    .bind(p.lat)
    .bind(p.lon)
    .bind(&p.name)
    .bind(&p.admin)
    .bind(&p.country)
    .bind(source)
    .execute(pool)
    .await
    .map_err(db)?;
    let id = find_place_id(pool, &p, source)
        .await?
        .ok_or_else(|| DpError::Db {
            message: "place row not found immediately after insert".into(),
        })?;
    get_place(pool, id).await
}

/// Every place with at least one media row pointing at it (`count`), for
/// the map/list view — places nobody's media currently references are
/// left out entirely rather than showing up with a zero count.
pub(crate) async fn list_place_counts(pool: &SqlitePool) -> DpResult<Vec<PlaceCount>> {
    let rows = sqlx::query(
        "SELECT p.*, COUNT(m.id) AS media_count FROM places p \
         JOIN media m ON m.place_id = p.id \
         GROUP BY p.id ORDER BY p.name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter()
        .map(|r| {
            let place = row_to_place(r)?;
            let count: i64 = r.try_get("media_count").map_err(db)?;
            Ok(PlaceCount {
                place,
                count: count as u64,
            })
        })
        .collect()
}

/// Sets (or clears, when `place_id` is `None`) `place_id` on every id in
/// `ids`, all in one transaction, then syncs each row's FTS entry
/// afterward — mirrors `Catalog::tag_media`'s split between the
/// transactional write and the log-only FTS sync (FTS is derived data;
/// see the `fts` module docs).
pub(crate) async fn set_media_place(pool: &SqlitePool, ids: &[i64], place_id: Option<i64>) -> DpResult<()> {
    if ids.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(db)?;
    for &id in ids {
        sqlx::query("UPDATE media SET place_id = ? WHERE id = ?")
            .bind(place_id)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    tx.commit().await.map_err(db)?;

    // FTS is derived data — never fail the write over a sync problem.
    for &id in ids {
        if let Err(e) = crate::fts::sync_fts(pool, id).await {
            tracing::warn!(media_id = id, error = %e, "failed to sync FTS index after set_media_place");
        }
    }

    Ok(())
}

/// Media rows worth handing to the reverse-geocode job: they have GPS
/// coordinates but no place yet. `lat IS NOT NULL AND lon IS NOT NULL AND
/// place_id IS NULL` is the whole predicate — it also correctly excludes
/// rows the user already assigned a *manual* place to, since assigning
/// any place (geocoder or manual) fills `place_id` and takes the row out
/// of this set. There is no separate "manual-skip" flag to check.
///
/// Cursor-paginated by `id` rather than offset-paginated: `after_id` (`0`
/// for the first page) plus `id > ?, ORDER BY id LIMIT ?` means a row that
/// gains a `place_id` between pages (and so drops out of this predicate)
/// can never shift a later page's window and cause a not-yet-seen row to
/// be skipped — the classic failure mode of `OFFSET`-based pagination
/// over a set that shrinks while it's being paged through. The geocode
/// job relies on this: a page of rows it can't place at all still lets it
/// advance past them on the next fetch, rather than re-fetching the same
/// stuck page forever.
pub(crate) async fn list_ungeocoded(pool: &SqlitePool, after_id: i64, limit: u32) -> DpResult<Vec<MediaRow>> {
    let rows = sqlx::query(
        "SELECT * FROM media WHERE lat IS NOT NULL AND lon IS NOT NULL AND place_id IS NULL \
         AND id > ? ORDER BY id LIMIT ?",
    )
    .bind(after_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter().map(row_to_media).collect()
}
