//! `media_fts`: a plain (non-contentless) FTS5 index over `stem`, `tags`,
//! `place`, `camera`, keyed by `rowid = media.id`. It is *derived* data —
//! everything in this module can be rebuilt from `media`/`tags`/`media_tags`
//! at any time via [`rebuild_fts`] — so callers in `media.rs`/`tags.rs`
//! only ever log [`sync_fts`] errors; they never let an FTS failure fail a
//! catalog write. See the `Catalog::sync_fts` doc comment.

use crate::drives::row_to_drive_prefixed;
use crate::media::row_to_media;
use crate::sqlite::db;
use dp_core::{DpResult, Drive, MediaRow};
use sqlx::{Row, SqliteConnection, SqlitePool};

fn stem_of(rel_path: &str) -> String {
    std::path::Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(rel_path)
        .to_string()
}

/// Same query [`crate::tags::tag_names_for_media`] runs, but over a
/// connection already inside [`sync_fts`]/[`rebuild_fts`]'s transaction
/// rather than a fresh pool checkout — kept local to this module so
/// [`insert_fts_row`] can run entirely on `&mut SqliteConnection`.
async fn tag_names_for_media_conn(conn: &mut SqliteConnection, media_id: i64) -> DpResult<Vec<String>> {
    let rows = sqlx::query(
        "SELECT t.name AS name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id \
         WHERE mt.media_id = ? ORDER BY t.name COLLATE NOCASE",
    )
    .bind(media_id)
    .fetch_all(conn)
    .await
    .map_err(db)?;
    rows.iter().map(|r| r.try_get("name").map_err(db)).collect()
}

/// Inserts a fresh `media_fts` row for `media_id` from current catalog
/// state, or does nothing if the media row no longer exists. Assumes any
/// prior row for `media_id` has already been removed (see [`sync_fts`]/
/// [`rebuild_fts`]) — this never deletes on its own. Runs on `conn`
/// directly so callers can share one transaction across the delete +
/// insert (or the whole rebuild loop).
async fn insert_fts_row(conn: &mut SqliteConnection, media_id: i64) -> DpResult<()> {
    let row = sqlx::query(
        "SELECT m.rel_path AS rel_path, m.camera AS camera, \
         p.name AS p_name, p.admin AS p_admin, p.country AS p_country \
         FROM media m LEFT JOIN places p ON p.id = m.place_id WHERE m.id = ?",
    )
    .bind(media_id)
    .fetch_optional(&mut *conn)
    .await
    .map_err(db)?;
    let Some(row) = row else {
        return Ok(());
    };
    let rel_path: String = row.try_get("rel_path").map_err(db)?;
    let camera: Option<String> = row.try_get("camera").map_err(db)?;
    let place_name: Option<String> = row.try_get("p_name").map_err(db)?;
    let place_admin: Option<String> = row.try_get("p_admin").map_err(db)?;
    let place_country: Option<String> = row.try_get("p_country").map_err(db)?;

    let stem = stem_of(&rel_path);
    let tags = tag_names_for_media_conn(&mut *conn, media_id).await?.join(" ");
    let place = place_name.map(|name| {
        let admin = place_admin.unwrap_or_default();
        let country = place_country.unwrap_or_default();
        format!("{name} {admin} {country}")
    });
    let place = place.unwrap_or_default();
    let camera = camera.unwrap_or_default();

    sqlx::query("INSERT INTO media_fts (rowid, stem, tags, place, camera) VALUES (?, ?, ?, ?, ?)")
        .bind(media_id)
        .bind(stem)
        .bind(tags)
        .bind(place)
        .bind(camera)
        .execute(conn)
        .await
        .map_err(db)?;
    Ok(())
}

/// Rebuilds `media_id`'s `media_fts` row from current catalog state
/// (stem of `rel_path`, space-joined tag names, place, camera); deletes
/// the row outright when the media row is gone (e.g. after a delete).
/// The delete + insert run in one transaction (M1) so a reader never
/// observes `media_id`'s row transiently missing.
pub(crate) async fn sync_fts(pool: &SqlitePool, media_id: i64) -> DpResult<()> {
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("DELETE FROM media_fts WHERE rowid = ?")
        .bind(media_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    insert_fts_row(&mut tx, media_id).await?;
    tx.commit().await.map_err(db)?;
    Ok(())
}

/// Drops and refills the whole index — the recovery path if `media_fts`
/// is ever found to have drifted from `media`/`tags`, and the path
/// `SqliteCatalog::open` takes automatically when it finds `media_fts`
/// empty on a catalog that already has media rows. The whole drop +
/// refill runs in one transaction, so a search running concurrently
/// never sees the index partially emptied.
pub(crate) async fn rebuild_fts(pool: &SqlitePool) -> DpResult<()> {
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("DELETE FROM media_fts")
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM media")
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
    for id in ids {
        insert_fts_row(&mut tx, id).await?;
    }
    tx.commit().await.map_err(db)?;
    Ok(())
}

/// Builds an FTS5 `MATCH` expression from raw user input, or `None` when
/// nothing usable survives sanitization. Splits on whitespace, then
/// splits *each* whitespace token again on every character that isn't
/// `is_alphanumeric()`/`_` (so quotes, `OR`, `-`, `*`, etc. in user input
/// can never reach the FTS query parser as syntax) — producing a
/// separate piece per run of alphanumeric/underscore characters rather
/// than deleting the separator outright, so e.g. `2025-09-12` becomes
/// three pieces instead of the single unmatchable blob `20250912`. This
/// mirrors how FTS5's own `unicode61` tokenizer splits the *indexed*
/// text: hyphens and apostrophes are separators there too, while `_`
/// stays part of a token. Drops pieces that end up empty, quotes every
/// surviving piece, ANDs them together, and prefix-matches only the last
/// one — `"tok1" AND "tok2"*` (the `*` sits outside the closing quote,
/// which is the syntax FTS5 requires for a quoted prefix match).
fn build_match_query(query: &str) -> Option<String> {
    let tokens: Vec<String> = query
        .split_whitespace()
        .flat_map(|tok| {
            tok.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                .filter(|piece| !piece.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let last = tokens.len() - 1;
    let expr = tokens
        .iter()
        .enumerate()
        .map(|(i, tok)| {
            if i == last {
                format!("\"{tok}\"*")
            } else {
                format!("\"{tok}\"")
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ");
    Some(expr)
}

const SELECT_JOINED: &str = "SELECT m.*, d.id AS d_id, d.name AS d_name, d.volume_uuid AS d_volume_uuid, \
     d.volume_label AS d_volume_label, \
     d.mount_path AS d_mount_path, d.role AS d_role, d.capacity AS d_capacity, d.free AS d_free, \
     d.last_seen_at AS d_last_seen_at \
     FROM media_fts JOIN media m ON m.id = media_fts.rowid JOIN drives d ON d.id = m.drive_id \
     WHERE media_fts MATCH ? ORDER BY bm25(media_fts) ASC LIMIT ?";

/// Full-text search over `media_fts`, ranked by `bm25` ascending (SQLite's
/// bm25 scores are negative and more negative is a better match, so
/// ascending puts the best match first), joined back to `media`+`drives`
/// like [`crate::query::query_media`]. Empty/whitespace-only/fully-stripped
/// queries return `Ok(vec![])` rather than reaching FTS5 as a query — see
/// [`build_match_query`].
pub(crate) async fn search_media(
    pool: &SqlitePool,
    query: &str,
    limit: u32,
) -> DpResult<Vec<(MediaRow, Drive)>> {
    let Some(match_expr) = build_match_query(query) else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(SELECT_JOINED)
        .bind(match_expr)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter()
        .map(|r| Ok((row_to_media(r)?, row_to_drive_prefixed(r, "d_")?)))
        .collect()
}
