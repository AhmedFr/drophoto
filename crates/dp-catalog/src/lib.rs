mod drives;
mod forget_drive;
mod fts;
mod job_runs;
mod media;
mod organize;
mod organize_jobs;
mod places;
mod query;
mod settings;
mod sources;
mod sqlite;
mod tags;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use dp_core::{
    AppSettings, DpResult, Drive, JobRunRow, MediaMetadata, MediaQuery, MediaRow, NewDrive, NewJobRun,
    NewMedia, NewPlace, NewSource, OrganizeItemRow, OrganizeJobRow, OrganizeRule, Place, PlaceCount,
    ScanErrorCodeCount, ScanErrorRow, ScanIndexEntry, Source, Tag, UnorganizedSummary,
};
pub use sources::normalize_rel_path as normalize_source_rel_path;
pub use sqlite::SqliteCatalog;
use std::collections::HashSet;

#[async_trait]
pub trait Catalog: Send + Sync {
    async fn register_drive(&self, d: NewDrive) -> DpResult<Drive>;
    async fn list_drives(&self) -> DpResult<Vec<Drive>>;
    async fn set_drive_presence(&self, id: i64, mount_path: Option<&str>, free: Option<u64>) -> DpResult<()>;
    /// Fills `volume_uuid`/`volume_label` on drive `id` from a currently
    /// matched volume's identity, but only where each is still `NULL` —
    /// self-heals a legacy drive row the first time it's matched to a
    /// mounted volume since either column existed. See
    /// [`dp_core::Drive::volume_label`].
    async fn backfill_drive_volume_identity(
        &self,
        id: i64,
        volume_uuid: Option<&str>,
        volume_label: Option<&str>,
    ) -> DpResult<()>;
    /// Adopts a currently-mounted volume into drive `id`, **overwriting**
    /// its stored identity/mount_path unconditionally — the deliberate,
    /// user-initiated RELINK action for a drive `resolve_presence` can
    /// never re-attach on its own (no matching uuid/label/name/prior
    /// mount path). See [`crate::drives::relink_drive`] for why this
    /// bypasses the `backfill_drive_volume_identity` COALESCE rule.
    async fn relink_drive(
        &self,
        id: i64,
        volume_uuid: Option<&str>,
        volume_label: Option<&str>,
        mount_path: &str,
        free: Option<u64>,
    ) -> DpResult<()>;
    /// Permanently deletes drive `id` and everything that references it —
    /// sources, media (and by extension tags/places/FTS), and its
    /// organize/revert job history — in one transaction. Never touches
    /// the filesystem: thumbnails are content-addressed and possibly
    /// shared across drives, so they're left in the thumb store; the
    /// user's photos/folders/sidecars on the drive itself are never
    /// touched either. See [`crate::forget_drive`] for the exact cascade.
    async fn forget_drive(&self, id: i64) -> DpResult<()>;
    async fn upsert_media(&self, m: NewMedia) -> DpResult<i64>;
    async fn list_media(&self, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>>;
    async fn query_media(&self, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>>;
    async fn count_media_query(&self, q: &MediaQuery) -> DpResult<u64>;
    async fn get_media_with_drive(&self, id: i64) -> DpResult<(MediaRow, Drive)>;
    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64>;
    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool>;
    /// Every media row on `drive_id` never attributed to a source
    /// (`source_id IS NULL`) — see [`dp_core::MediaRow::source_id`].
    async fn list_media_without_source(&self, drive_id: i64) -> DpResult<Vec<MediaRow>>;
    /// One query for a whole drive's [`ScanIndexEntry`]s — the
    /// incremental-rescan skip index a scan loads (into a
    /// `HashMap<rel_path, ScanIndexEntry>`) before walking, so a scan can
    /// decide per file whether to skip it without a per-file query.
    async fn list_scan_index(&self, drive_id: i64) -> DpResult<Vec<ScanIndexEntry>>;
    /// Records the XMP sidecar's on-disk mtime as of the last time it was
    /// actually read — see [`dp_core::ScanIndexEntry::sidecar_mtime`].
    /// Called by `dp_jobs::ScanJob` after any sidecar import, and by
    /// `dp_jobs::SidecarSyncJob` after any write it performs.
    async fn set_sidecar_mtime(&self, media_id: i64, mtime: DateTime<Utc>) -> DpResult<()>;
    /// Deletes media row `id` unless an `organize_items` row references
    /// it; `Ok(false)` means it was left in place. See the `SqliteCatalog`
    /// implementation for why the guard exists.
    async fn delete_media(&self, id: i64) -> DpResult<bool>;
    /// Updates one media row's metadata columns plus `meta_read_at` — see
    /// [`crate::media::update_media_metadata`]'s doc comment for exactly
    /// what it touches (and doesn't) and who calls it.
    async fn update_media_metadata(&self, id: i64, m: &MediaMetadata, read_at: DateTime<Utc>)
        -> DpResult<()>;
    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()>;
    /// How many `scan_errors` rows `drive_id` currently has — see
    /// [`crate::media::count_scan_errors`]'s doc comment.
    async fn count_scan_errors(&self, drive_id: i64) -> DpResult<u64>;
    /// Pages `drive_id`'s `scan_errors` rows, newest first — see
    /// [`crate::media::list_scan_errors`]'s doc comment.
    async fn list_scan_errors(&self, drive_id: i64, limit: u32, offset: u32) -> DpResult<Vec<ScanErrorRow>>;
    /// `drive_id`'s `scan_errors` rows grouped by `code`, count DESC — see
    /// [`crate::media::scan_error_code_counts`]'s doc comment.
    async fn scan_error_code_counts(&self, drive_id: i64) -> DpResult<Vec<ScanErrorCodeCount>>;
    async fn get_rule(&self, drive_id: i64) -> DpResult<OrganizeRule>;
    async fn save_rule(&self, r: &OrganizeRule) -> DpResult<()>;
    async fn list_unorganized(&self, drive_id: i64, root: &str) -> DpResult<Vec<MediaRow>>;
    async fn unorganized_summary(&self, drive_id: i64, root: &str) -> DpResult<UnorganizedSummary>;
    async fn organized_hashes(&self, hashes: &[String]) -> DpResult<HashSet<String>>;
    async fn list_rel_paths(&self, drive_id: i64) -> DpResult<Vec<String>>;
    async fn create_organize_job(&self, drive_id: i64, planned: u64) -> DpResult<i64>;
    /// Creates a `revert` job row for `reverts_job_id`. See
    /// [`OrganizeJobRow::reverts_job_id`]/[`OrganizeJobRow::reverted_by_job_id`].
    async fn create_revert_job(&self, drive_id: i64, reverts_job_id: i64, planned: u64) -> DpResult<i64>;
    async fn finish_organize_job(
        &self,
        id: i64,
        status: &str,
        moved: u64,
        skipped: u64,
        failed: u64,
    ) -> DpResult<()>;
    async fn insert_organize_item(&self, item: &OrganizeItemRow) -> DpResult<i64>;
    async fn mark_media_organized(&self, media_id: i64, new_rel_path: &str) -> DpResult<()>;
    /// Reverts a single media row's organize move (see
    /// [`Self::mark_media_organized`]): restores `rel_path` to
    /// `old_rel_path` and clears `organized_at`.
    async fn mark_media_reverted(&self, media_id: i64, old_rel_path: &str) -> DpResult<()>;
    async fn list_organize_jobs(&self, limit: u32) -> DpResult<Vec<OrganizeJobRow>>;
    /// A single `organize_jobs` row by id (`None` if it doesn't exist),
    /// with the same `reverted_by_job_id` computation as
    /// [`Self::list_organize_jobs`].
    async fn get_organize_job(&self, id: i64) -> DpResult<Option<OrganizeJobRow>>;
    async fn list_organize_items(&self, job_id: i64, limit: u32) -> DpResult<Vec<OrganizeItemRow>>;
    async fn list_sources(&self, drive_id: i64) -> DpResult<Vec<Source>>;
    async fn upsert_source(&self, s: NewSource) -> DpResult<Source>;
    async fn set_source_enabled(&self, id: i64, enabled: bool) -> DpResult<()>;
    async fn delete_source(&self, id: i64) -> DpResult<()>;
    async fn list_enabled_sources(&self, drive_id: i64) -> DpResult<Vec<Source>>;
    /// Count of `drive_id`'s legacy rows — never attributed to a source,
    /// still unorganized, and outside `root` — see
    /// `dp_core::UnorganizedSummary::legacy`.
    async fn count_legacy_unorganized(&self, drive_id: i64, root: &str) -> DpResult<u64>;
    async fn list_tags(&self) -> DpResult<Vec<Tag>>;
    /// (media_id, tag) pairs for every id in `ids`, tags ordered by name.
    async fn tags_for_media(&self, ids: &[i64]) -> DpResult<Vec<(i64, Tag)>>;
    /// Creates any missing tags in `add` (name-insensitive), links them to every id,
    /// unlinks every tag id in `remove`, and sets `sidecar_pending = 1` on every id
    /// whose tag set actually changed. Whole call in one transaction.
    async fn tag_media(&self, ids: &[i64], add: &[String], remove: &[i64]) -> DpResult<()>;
    /// Tag names for one media row, ordered by name (for sidecar writing).
    async fn tag_names_for_media(&self, media_id: i64) -> DpResult<Vec<String>>;
    async fn list_sidecar_pending(&self, drive_id: i64) -> DpResult<Vec<MediaRow>>;
    /// Whether any row on `drive_id` is flagged `sidecar_pending` — the
    /// cheap gate in front of [`Self::list_sidecar_pending`], for callers
    /// that only need to know whether a sweep is worth starting.
    async fn has_sidecar_pending(&self, drive_id: i64) -> DpResult<bool>;
    async fn clear_sidecar_pending(&self, media_id: i64) -> DpResult<()>;
    async fn mark_sidecar_pending(&self, media_id: i64) -> DpResult<()>;
    /// Rebuilds one media row's FTS text (stem, tags, place, camera) from
    /// current catalog state; deletes the FTS row when the media row is gone.
    /// `media.rs`/`tags.rs` never propagate this method's errors to the
    /// caller of a media/tag write — see Global Constraints — they only
    /// `tracing::warn!` on failure. This method itself still returns errors.
    async fn sync_fts(&self, media_id: i64) -> DpResult<()>;
    /// Drops and refills the whole index. Recovery path.
    async fn rebuild_fts(&self) -> DpResult<()>;
    /// FTS search: every whitespace token AND-ed, the last one prefix-matched
    /// (`tok*`), ranked by bm25, joined back to media+drives like query_media.
    async fn search_media(&self, query: &str, limit: u32) -> DpResult<Vec<(MediaRow, Drive)>>;
    /// Find-or-create by (name, admin, country, source) — geocoder places dedupe.
    async fn upsert_place(&self, p: NewPlace) -> DpResult<Place>;
    /// Every place with at least one media row pointing at it.
    async fn list_place_counts(&self) -> DpResult<Vec<PlaceCount>>;
    /// Sets place_id on every id + syncs FTS per row (log-only, like tags).
    async fn set_media_place(&self, ids: &[i64], place_id: Option<i64>) -> DpResult<()>;
    /// Rows with GPS, no place, and NOT manual-skipped — for the geocode job.
    /// Cursor-paginated: only rows with `id > after_id` (ascending, `LIMIT
    /// limit`) — pass `0` for the first page, then the max `id` seen in the
    /// previous page. Unlike an offset, this can never skip or re-show a
    /// row when earlier rows in the same run gain a `place_id` (and so drop
    /// out of the result set) between pages.
    async fn list_ungeocoded(&self, after_id: i64, limit: u32) -> DpResult<Vec<MediaRow>>;
    /// Records one job's terminal run metrics — called by
    /// `dp_jobs::JobRunner` on every done/cancelled/failed job.
    async fn record_job_run(&self, run: NewJobRun) -> DpResult<()>;
    /// The most recent `limit` job runs, newest first — for the
    /// dashboard's "LAST RUNS" card.
    async fn list_job_runs(&self, limit: u32) -> DpResult<Vec<JobRunRow>>;
    /// Current app-wide settings, falling back to defaults for any key
    /// never written — see [`dp_core::DEFAULT_PREVIEW_EDGE`].
    async fn get_settings(&self) -> DpResult<AppSettings>;
    /// Sets the preview-quality edge (px) — see
    /// [`dp_core::AppSettings::preview_edge`]. Does not itself trigger a
    /// regen; that's the caller's job (see `start_regen_previews`).
    async fn set_preview_edge(&self, edge: u32) -> DpResult<()>;
}

#[async_trait]
impl Catalog for SqliteCatalog {
    async fn register_drive(&self, d: NewDrive) -> DpResult<Drive> {
        drives::register_drive(&self.pool, d).await
    }

    async fn list_drives(&self) -> DpResult<Vec<Drive>> {
        drives::list_drives(&self.pool).await
    }

    async fn set_drive_presence(&self, id: i64, mount_path: Option<&str>, free: Option<u64>) -> DpResult<()> {
        drives::set_drive_presence(&self.pool, id, mount_path, free).await
    }

    async fn backfill_drive_volume_identity(
        &self,
        id: i64,
        volume_uuid: Option<&str>,
        volume_label: Option<&str>,
    ) -> DpResult<()> {
        drives::backfill_drive_volume_identity(&self.pool, id, volume_uuid, volume_label).await
    }

    async fn relink_drive(
        &self,
        id: i64,
        volume_uuid: Option<&str>,
        volume_label: Option<&str>,
        mount_path: &str,
        free: Option<u64>,
    ) -> DpResult<()> {
        drives::relink_drive(&self.pool, id, volume_uuid, volume_label, mount_path, free).await
    }

    async fn forget_drive(&self, id: i64) -> DpResult<()> {
        forget_drive::forget_drive(&self.pool, id).await
    }

    async fn upsert_media(&self, m: NewMedia) -> DpResult<i64> {
        media::upsert_media(&self.pool, m).await
    }

    async fn list_media(&self, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>> {
        media::list_media(&self.pool, limit, offset).await
    }

    async fn query_media(&self, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>> {
        query::query_media(&self.pool, q).await
    }

    async fn count_media_query(&self, q: &MediaQuery) -> DpResult<u64> {
        query::count_media_query(&self.pool, q).await
    }

    async fn get_media_with_drive(&self, id: i64) -> DpResult<(MediaRow, Drive)> {
        query::get_media_with_drive(&self.pool, id).await
    }

    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64> {
        media::count_media(&self.pool, drive_id).await
    }

    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool> {
        media::media_hash_exists(&self.pool, hash).await
    }

    async fn list_media_without_source(&self, drive_id: i64) -> DpResult<Vec<MediaRow>> {
        media::list_media_without_source(&self.pool, drive_id).await
    }

    async fn list_scan_index(&self, drive_id: i64) -> DpResult<Vec<ScanIndexEntry>> {
        media::list_scan_index(&self.pool, drive_id).await
    }

    async fn set_sidecar_mtime(&self, media_id: i64, mtime: DateTime<Utc>) -> DpResult<()> {
        media::set_sidecar_mtime(&self.pool, media_id, mtime).await
    }

    async fn delete_media(&self, id: i64) -> DpResult<bool> {
        media::delete_media(&self.pool, id).await
    }

    async fn update_media_metadata(
        &self,
        id: i64,
        m: &MediaMetadata,
        read_at: DateTime<Utc>,
    ) -> DpResult<()> {
        media::update_media_metadata(&self.pool, id, m, read_at).await
    }

    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()> {
        media::record_scan_error(&self.pool, drive_id, path, code, message).await
    }

    async fn count_scan_errors(&self, drive_id: i64) -> DpResult<u64> {
        media::count_scan_errors(&self.pool, drive_id).await
    }

    async fn list_scan_errors(&self, drive_id: i64, limit: u32, offset: u32) -> DpResult<Vec<ScanErrorRow>> {
        media::list_scan_errors(&self.pool, drive_id, limit, offset).await
    }

    async fn scan_error_code_counts(&self, drive_id: i64) -> DpResult<Vec<ScanErrorCodeCount>> {
        media::scan_error_code_counts(&self.pool, drive_id).await
    }

    async fn get_rule(&self, drive_id: i64) -> DpResult<OrganizeRule> {
        organize::get_rule(&self.pool, drive_id).await
    }

    async fn save_rule(&self, r: &OrganizeRule) -> DpResult<()> {
        organize::save_rule(&self.pool, r).await
    }

    async fn list_unorganized(&self, drive_id: i64, root: &str) -> DpResult<Vec<MediaRow>> {
        organize::list_unorganized(&self.pool, drive_id, root).await
    }

    async fn unorganized_summary(&self, drive_id: i64, root: &str) -> DpResult<UnorganizedSummary> {
        organize::unorganized_summary(&self.pool, drive_id, root).await
    }

    async fn organized_hashes(&self, hashes: &[String]) -> DpResult<HashSet<String>> {
        organize::organized_hashes(&self.pool, hashes).await
    }

    async fn list_rel_paths(&self, drive_id: i64) -> DpResult<Vec<String>> {
        organize::list_rel_paths(&self.pool, drive_id).await
    }

    async fn create_organize_job(&self, drive_id: i64, planned: u64) -> DpResult<i64> {
        organize_jobs::create_organize_job(&self.pool, drive_id, planned).await
    }

    async fn create_revert_job(&self, drive_id: i64, reverts_job_id: i64, planned: u64) -> DpResult<i64> {
        organize_jobs::create_revert_job(&self.pool, drive_id, reverts_job_id, planned).await
    }

    async fn finish_organize_job(
        &self,
        id: i64,
        status: &str,
        moved: u64,
        skipped: u64,
        failed: u64,
    ) -> DpResult<()> {
        organize_jobs::finish_organize_job(&self.pool, id, status, moved, skipped, failed).await
    }

    async fn insert_organize_item(&self, item: &OrganizeItemRow) -> DpResult<i64> {
        organize_jobs::insert_organize_item(&self.pool, item).await
    }

    async fn mark_media_organized(&self, media_id: i64, new_rel_path: &str) -> DpResult<()> {
        organize::mark_media_organized(&self.pool, media_id, new_rel_path).await
    }

    async fn mark_media_reverted(&self, media_id: i64, old_rel_path: &str) -> DpResult<()> {
        organize::mark_media_reverted(&self.pool, media_id, old_rel_path).await
    }

    async fn list_organize_jobs(&self, limit: u32) -> DpResult<Vec<OrganizeJobRow>> {
        organize_jobs::list_organize_jobs(&self.pool, limit).await
    }

    async fn get_organize_job(&self, id: i64) -> DpResult<Option<OrganizeJobRow>> {
        organize_jobs::get_organize_job(&self.pool, id).await
    }

    async fn list_organize_items(&self, job_id: i64, limit: u32) -> DpResult<Vec<OrganizeItemRow>> {
        organize_jobs::list_organize_items(&self.pool, job_id, limit).await
    }

    async fn list_sources(&self, drive_id: i64) -> DpResult<Vec<Source>> {
        sources::list_sources(&self.pool, drive_id).await
    }

    async fn upsert_source(&self, s: NewSource) -> DpResult<Source> {
        sources::upsert_source(&self.pool, s).await
    }

    async fn set_source_enabled(&self, id: i64, enabled: bool) -> DpResult<()> {
        sources::set_source_enabled(&self.pool, id, enabled).await
    }

    async fn delete_source(&self, id: i64) -> DpResult<()> {
        sources::delete_source(&self.pool, id).await
    }

    async fn list_enabled_sources(&self, drive_id: i64) -> DpResult<Vec<Source>> {
        sources::list_enabled_sources(&self.pool, drive_id).await
    }

    async fn count_legacy_unorganized(&self, drive_id: i64, root: &str) -> DpResult<u64> {
        organize::count_legacy_unorganized(&self.pool, drive_id, root).await
    }

    async fn list_tags(&self) -> DpResult<Vec<Tag>> {
        tags::list_tags(&self.pool).await
    }

    async fn tags_for_media(&self, ids: &[i64]) -> DpResult<Vec<(i64, Tag)>> {
        tags::tags_for_media(&self.pool, ids).await
    }

    async fn tag_media(&self, ids: &[i64], add: &[String], remove: &[i64]) -> DpResult<()> {
        tags::tag_media(&self.pool, ids, add, remove).await
    }

    async fn tag_names_for_media(&self, media_id: i64) -> DpResult<Vec<String>> {
        tags::tag_names_for_media(&self.pool, media_id).await
    }

    async fn list_sidecar_pending(&self, drive_id: i64) -> DpResult<Vec<MediaRow>> {
        tags::list_sidecar_pending(&self.pool, drive_id).await
    }

    async fn has_sidecar_pending(&self, drive_id: i64) -> DpResult<bool> {
        tags::has_sidecar_pending(&self.pool, drive_id).await
    }

    async fn clear_sidecar_pending(&self, media_id: i64) -> DpResult<()> {
        tags::clear_sidecar_pending(&self.pool, media_id).await
    }

    async fn mark_sidecar_pending(&self, media_id: i64) -> DpResult<()> {
        tags::mark_sidecar_pending(&self.pool, media_id).await
    }

    async fn sync_fts(&self, media_id: i64) -> DpResult<()> {
        fts::sync_fts(&self.pool, media_id).await
    }

    async fn rebuild_fts(&self) -> DpResult<()> {
        fts::rebuild_fts(&self.pool).await
    }

    async fn search_media(&self, query: &str, limit: u32) -> DpResult<Vec<(MediaRow, Drive)>> {
        fts::search_media(&self.pool, query, limit).await
    }

    async fn upsert_place(&self, p: NewPlace) -> DpResult<Place> {
        places::upsert_place(&self.pool, p).await
    }

    async fn list_place_counts(&self) -> DpResult<Vec<PlaceCount>> {
        places::list_place_counts(&self.pool).await
    }

    async fn set_media_place(&self, ids: &[i64], place_id: Option<i64>) -> DpResult<()> {
        places::set_media_place(&self.pool, ids, place_id).await
    }

    async fn list_ungeocoded(&self, after_id: i64, limit: u32) -> DpResult<Vec<MediaRow>> {
        places::list_ungeocoded(&self.pool, after_id, limit).await
    }

    async fn record_job_run(&self, run: NewJobRun) -> DpResult<()> {
        job_runs::record_job_run(&self.pool, run).await
    }

    async fn list_job_runs(&self, limit: u32) -> DpResult<Vec<JobRunRow>> {
        job_runs::list_job_runs(&self.pool, limit).await
    }

    async fn get_settings(&self) -> DpResult<AppSettings> {
        settings::get_settings(&self.pool).await
    }

    async fn set_preview_edge(&self, edge: u32) -> DpResult<()> {
        settings::set_preview_edge(&self.pool, edge).await
    }
}
