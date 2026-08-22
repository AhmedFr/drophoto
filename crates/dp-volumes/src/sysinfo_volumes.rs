use crate::VolumeProvider;
use dp_core::{DpResult, Volume};
use sysinfo::Disks;

pub struct SysinfoVolumes;

#[async_trait::async_trait]
impl VolumeProvider for SysinfoVolumes {
    async fn list(&self) -> DpResult<Vec<Volume>> {
        let disks = tokio::task::spawn_blocking(Disks::new_with_refreshed_list)
            .await
            .map_err(|e| dp_core::DpError::Io {
                message: e.to_string(),
                path: None,
            })?;
        let mut out: Vec<Volume> = disks
            .iter()
            .map(|d| Volume {
                name: d.name().to_string_lossy().to_string(),
                mount_path: d.mount_point().to_string_lossy().to_string(),
                total_bytes: d.total_space(),
                free_bytes: d.available_space(),
                is_removable: d.is_removable(),
            })
            .filter(|v| v.mount_path == "/" || v.mount_path.starts_with("/Volumes/"))
            .collect();
        out.sort_by(|a, b| a.mount_path.cmp(&b.mount_path));
        out.dedup_by(|a, b| a.mount_path == b.mount_path);
        Ok(out)
    }
}
