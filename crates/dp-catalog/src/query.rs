use crate::drives::row_to_drive_prefixed;
use crate::fts::build_match_query;
use crate::media::row_to_media;
use crate::sqlite::db;
use dp_core::{DpError, DpResult, Drive, MediaKind, MediaQuery, MediaRow, MediaSort};
use sqlx::{sqlite::SqliteArguments, Arguments, SqlitePool};

pub(crate) const SELECT_JOINED: &str =
    "SELECT m.*, d.id AS d_id, d.name AS d_name, d.volume_uuid AS d_volume_uuid, \
     d.volume_label AS d_volume_label, \
     d.mount_path AS d_mount_path, d.role AS d_role, d.capacity AS d_capacity, d.free AS d_free, \
     d.last_seen_at AS d_last_seen_at FROM media m JOIN drives d ON d.id = m.drive_id";

fn kind_str(k: MediaKind) -> &'static str {
    match k {
        MediaKind::Photo => "photo",
        MediaKind::Video => "video",
    }
}

fn order_by(sort: MediaSort) -> &'static str {
    match sort {
        MediaSort::TakenDesc => "ORDER BY m.taken_at DESC NULLS LAST, m.id DESC",
        MediaSort::TakenAsc => "ORDER BY m.taken_at ASC NULLS LAST, m.id ASC",
        MediaSort::AddedDesc => "ORDER BY m.id DESC",
    }
}

/// Returns (where_sql, args). `args` are bound in order.
///
/// Both callers (`query_media` and `count_media_query`) build their `FROM`
/// clause by interpolating [`SELECT_JOINED`] or a bare `media m`, so the
/// `m.*` column references produced here always alias the `media` table as
/// `m` — keep that alias in sync if either call site changes it.
fn where_clause(q: &MediaQuery) -> (String, SqliteArguments<'static>) {
    let mut clauses = Vec::new();
    let mut args = SqliteArguments::default();
    if !q.kinds.is_empty() {
        clauses.push(format!("m.kind IN ({})", vec!["?"; q.kinds.len()].join(",")));
        for k in &q.kinds {
            let _ = args.add(kind_str(*k));
        }
    }
    if !q.exts.is_empty() {
        clauses.push(format!("m.ext IN ({})", vec!["?"; q.exts.len()].join(",")));
        for e in &q.exts {
            let _ = args.add(e.clone());
        }
    }
    if let Some(place_id) = q.place_id {
        clauses.push("m.place_id = ?".to_string());
        let _ = args.add(place_id);
    }
    if !q.tag_ids.is_empty() {
        // `IN (SELECT ...)` rather than a `JOIN media_tags` — a row linked
        // to more than one of `tag_ids` must still appear once.
        clauses.push(format!(
            "m.id IN (SELECT media_id FROM media_tags WHERE tag_id IN ({}))",
            vec!["?"; q.tag_ids.len()].join(",")
        ));
        for tag_id in &q.tag_ids {
            let _ = args.add(*tag_id);
        }
    }
    if let Some(missing) = q.missing {
        clauses.push(if missing {
            "m.missing_at IS NOT NULL".to_string()
        } else {
            "m.missing_at IS NULL".to_string()
        });
    }
    // Trimmed empty/whitespace-only behaves as no filter at all (see
    // `MediaQuery::query`'s doc comment) — a caller that sends `Some("  ")`
    // gets the same untouched result set as one that sends `None`. A
    // trimmed-non-empty query that the sanitizer still reduces to nothing
    // (e.g. all-punctuation input) is different: the caller *did* ask to
    // filter, so it must match zero rows rather than silently falling back
    // to "everything" — `"0"` (SQLite's false) does that without needing a
    // bindable placeholder. Sort stays whatever the caller's `MediaSort`
    // says: a photo library is browsed by date, not FTS relevance rank, so
    // unlike `fts::search_media` this never switches to `ORDER BY bm25(...)`.
    if let Some(trimmed) = q.query.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        match build_match_query(trimmed) {
            Some(match_expr) => {
                clauses.push("m.id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)".to_string());
                let _ = args.add(match_expr);
            }
            None => clauses.push("0".to_string()),
        }
    }
    let sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    (sql, args)
}

pub(crate) async fn query_media(pool: &SqlitePool, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>> {
    let q = q.clone().clamped();
    let (w, mut args) = where_clause(&q);
    let _ = args.add(q.limit as i64);
    let _ = args.add(q.offset as i64);
    let sql = format!("{SELECT_JOINED} {w} {} LIMIT ? OFFSET ?", order_by(q.sort));
    let rows = sqlx::query_with(&sql, args).fetch_all(pool).await.map_err(db)?;
    rows.iter()
        .map(|r| Ok((row_to_media(r)?, row_to_drive_prefixed(r, "d_")?)))
        .collect()
}

pub(crate) async fn count_media_query(pool: &SqlitePool, q: &MediaQuery) -> DpResult<u64> {
    let (w, args) = where_clause(q);
    let sql = format!("SELECT COUNT(*) AS n FROM media m {w}");
    let n: i64 = sqlx::query_scalar_with(&sql, args)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    Ok(n as u64)
}

pub(crate) async fn get_media_with_drive(pool: &SqlitePool, id: i64) -> DpResult<(MediaRow, Drive)> {
    let sql = format!("{SELECT_JOINED} WHERE m.id = ?");
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(db)?
        .ok_or_else(|| DpError::NotFound {
            message: format!("media {id} not found"),
        })?;
    Ok((row_to_media(&row)?, row_to_drive_prefixed(&row, "d_")?))
}
