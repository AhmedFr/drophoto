mod presence;
mod sysinfo_volumes;
use dp_core::{DpResult, Volume};
pub use presence::{resolve_presence, PresenceMatch};
pub use sysinfo_volumes::{DiskIdentity, DiskutilIdentity, SysinfoVolumes};

#[async_trait::async_trait]
pub trait VolumeProvider: Send + Sync {
    async fn list(&self) -> DpResult<Vec<Volume>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_root_volume() {
        let v = SysinfoVolumes::default().list().await.unwrap();
        assert!(v.iter().any(|x| x.mount_path == "/"), "expected / in {v:?}");
        assert!(v.iter().all(|x| x.total_bytes >= x.free_bytes));
    }
}
