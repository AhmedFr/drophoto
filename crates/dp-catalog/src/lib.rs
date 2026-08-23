mod drives;
mod media;
mod organize;
mod organize_jobs;
mod query;
mod sources;
mod sqlite;

use async_trait::async_trait;
use dp_core::{
    DpResult, Drive, MediaQuery, MediaRow, NewDrive, NewMedia, NewSource, OrganizeItemRow, OrganizeJobRow,
    OrganizeRule, Source, UnorganizedSummary,
};
pub use sqlite::SqliteCatalog;
use std::collections::HashSet;

#[async_trait]
pub trait Catalog: Send + Sync {
    async fn register_drive(&self, d: NewDrive) -> DpResult<Drive>;
    async fn list_drives(&self) -> DpResult<Vec<Drive>>;
    async fn set_drive_presence(&self, id: i64, mount_path: Option<&str>, free: Option<u64>) -> DpResult<()>;
    async fn upsert_media(&self, m: NewMedia) -> DpResult<i64>;
    async fn list_media(&self, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>>;
    async fn query_media(&self, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>>;
    async fn count_media_query(&self, q: &MediaQuery) -> DpResult<u64>;
    async fn get_media_with_drive(&self, id: i64) -> DpResult<(MediaRow, Drive)>;
    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64>;
    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool>;
    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()>;
    async fn get_rule(&self, drive_id: i64) -> DpResult<OrganizeRule>;
    async fn save_rule(&self, r: &OrganizeRule) -> DpResult<()>;
    async fn list_unorganized(&self, drive_id: i64, root: &str) -> DpResult<Vec<MediaRow>>;
    async fn unorganized_summary(&self, drive_id: i64, root: &str) -> DpResult<UnorganizedSummary>;
    async fn organized_hashes(&self, hashes: &[String]) -> DpResult<HashSet<String>>;
    async fn list_rel_paths(&self, drive_id: i64) -> DpResult<Vec<String>>;
    async fn create_organize_job(&self, drive_id: i64, planned: u64) -> DpResult<i64>;
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
    async fn list_organize_jobs(&self, limit: u32) -> DpResult<Vec<OrganizeJobRow>>;
    async fn list_organize_items(&self, job_id: i64, limit: u32) -> DpResult<Vec<OrganizeItemRow>>;
    async fn list_sources(&self, drive_id: i64) -> DpResult<Vec<Source>>;
    async fn upsert_source(&self, s: NewSource) -> DpResult<Source>;
    async fn set_source_enabled(&self, id: i64, enabled: bool) -> DpResult<()>;
    async fn delete_source(&self, id: i64) -> DpResult<()>;
    async fn list_enabled_sources(&self, drive_id: i64) -> DpResult<Vec<Source>>;
    async fn count_media_without_source(&self, drive_id: i64) -> DpResult<u64>;
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

    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()> {
        media::record_scan_error(&self.pool, drive_id, path, code, message).await
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

    async fn list_organize_jobs(&self, limit: u32) -> DpResult<Vec<OrganizeJobRow>> {
        organize_jobs::list_organize_jobs(&self.pool, limit).await
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

    async fn count_media_without_source(&self, drive_id: i64) -> DpResult<u64> {
        sources::count_media_without_source(&self.pool, drive_id).await
    }
}
