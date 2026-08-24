mod exiftool;
mod parse;
mod sidecar;

pub use exiftool::ExiftoolProvider;
pub use parse::parse_exiftool_json;
pub use sidecar::{sidecar_path, ExiftoolSidecars, Sidecars};

use std::path::Path;

use dp_core::{DpResult, MediaMetadata};

/// Reads media metadata (EXIF/QuickTime tags) for a file.
#[async_trait::async_trait]
pub trait MetadataProvider: Send + Sync {
    async fn read(&self, path: &Path) -> DpResult<MediaMetadata>;
}
