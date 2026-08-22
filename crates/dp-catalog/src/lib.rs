mod drives;
mod media;
mod sqlite;

use async_trait::async_trait;
use dp_core::{DpResult, Drive, MediaRow, NewDrive, NewMedia};
pub use sqlite::SqliteCatalog;

#[async_trait]
pub trait Catalog: Send + Sync {
    async fn register_drive(&self, d: NewDrive) -> DpResult<Drive>;
    async fn list_drives(&self) -> DpResult<Vec<Drive>>;
    async fn set_drive_presence(&self, id: i64, mount_path: Option<&str>, free: Option<u64>) -> DpResult<()>;
    async fn upsert_media(&self, m: NewMedia) -> DpResult<i64>;
    async fn list_media(&self, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>>;
    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64>;
    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool>;
    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()>;
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

    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64> {
        media::count_media(&self.pool, drive_id).await
    }

    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool> {
        media::media_hash_exists(&self.pool, hash).await
    }

    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()> {
        media::record_scan_error(&self.pool, drive_id, path, code, message).await
    }
}
