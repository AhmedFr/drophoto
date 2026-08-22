use dp_volumes::{SysinfoVolumes, VolumeProvider};
use std::sync::Arc;

pub struct AppState {
    pub volumes: Arc<dyn VolumeProvider>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            volumes: Arc::new(SysinfoVolumes),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
