//! [`forget_drive`]: the "FORGET…" danger-zone action on a `DriveCard`
//! (works offline — that's the point). Permanently removes a drive and
//! every catalog row that references it — sources, media (and by
//! extension their tags/places/FTS entries), and its organize/revert job
//! history — in one transaction, so a caller never observes a
//! half-forgotten drive.
//!
//! **Never touches the filesystem.** Thumbnails are content-addressed by
//! hash and are frequently shared across drives (the same photo copied to
//! two cards hashes identically and shares one thumb), so a thumb can't
//! be safely deleted just because *a* drive that once referenced it is
//! gone — that's the Settings storage panel's job (and a future
//! orphan-thumb GC), not this one. The user's photos, folders, and `.xmp`
//! sidecar files on the drive itself are of course never touched either
//! — this only ever deletes rows in `catalog.db`.

use crate::sqlite::db;
use dp_core::DpResult;
use sqlx::SqlitePool;

/// Deletes drive `id` and everything that references it, in one
/// transaction:
///
/// 1. `organize_items` for every `organize_jobs` row on this drive —
///    `organize_items.media_id` carries no foreign key (see
///    [`crate::media::delete_media`]'s doc comment), so nothing at the
///    schema level would stop a stray item from surviving; deleted
///    explicitly rather than relying on `organize_jobs`' cascade to reach
///    a table it has no FK relationship with.
/// 2. `organize_jobs` for this drive — `organize_jobs.drive_id` carries
///    no `ON DELETE CASCADE` (unlike `media`/`sources`), so deleting the
///    `drives` row first would fail its FK constraint if any job row for
///    it survived.
/// 3. `job_runs` for this drive — a pure metrics log with no FK to
///    `drives` at all, but still "everything referencing it": left
///    behind, these would be dashboard "LAST RUNS" rows naming a drive
///    that no longer exists.
/// 4. `media_fts` rows for this drive's media — `media_fts` is a plain
///    (non-`contentless`) FTS5 index with no FK to `media`, so it never
///    auto-cascades; deleted here, while `media` (and thus the `id`s
///    this subquery needs) still exists, rather than after.
/// 5. `scan_errors` for this drive — like `job_runs`, no FK to `drives`
///    (`drive_id INTEGER NOT NULL` with no `REFERENCES`), so nothing
///    forces this, but `drives.id` is `INTEGER PRIMARY KEY` *without*
///    `AUTOINCREMENT` (`0001_init.sql`), meaning SQLite *does* reuse a
///    deleted drive's id for the next registration — leaving these rows
///    behind would let a scan-errors panel one day attribute a stale
///    error to a brand-new, unrelated drive that happens to reuse the id.
/// 6. The `drives` row itself — cascades automatically from here:
///    `media` (`ON DELETE CASCADE` on `drive_id`), which cascades further
///    into `media_tags` (`ON DELETE CASCADE` on `media_id`); `sources`
///    (`ON DELETE CASCADE` on `drive_id`); and `organize_rules`
///    (`ON DELETE CASCADE` on `drive_id`).
pub(crate) async fn forget_drive(pool: &SqlitePool, id: i64) -> DpResult<()> {
    let mut tx = pool.begin().await.map_err(db)?;

    sqlx::query(
        "DELETE FROM organize_items WHERE job_id IN (SELECT id FROM organize_jobs WHERE drive_id = ?)",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;

    sqlx::query("DELETE FROM organize_jobs WHERE drive_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    sqlx::query("DELETE FROM job_runs WHERE drive_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    sqlx::query("DELETE FROM media_fts WHERE rowid IN (SELECT id FROM media WHERE drive_id = ?)")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    sqlx::query("DELETE FROM scan_errors WHERE drive_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    sqlx::query("DELETE FROM drives WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    tx.commit().await.map_err(db)?;
    Ok(())
}
