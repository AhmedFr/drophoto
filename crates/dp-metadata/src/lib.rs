mod exiftool;
mod parse;
mod resolve;
mod sidecar;
mod version;

pub use exiftool::ExiftoolProvider;
pub use parse::parse_exiftool_json;
pub use resolve::{resolve_tool, resolve_tool_in};
pub use sidecar::{sidecar_path, ExiftoolSidecars, Sidecars};
pub use version::{
    parse_exiftool_version, parse_ffmpeg_version, probe_exiftool_version, probe_ffmpeg_version, status_from,
    ParsedVersion, ToolVersion, MIN_EXIFTOOL, MIN_FFMPEG,
};

use std::path::Path;

use dp_core::{DpResult, MediaMetadata};

/// Reads media metadata (EXIF/QuickTime tags) for a file.
#[async_trait::async_trait]
pub trait MetadataProvider: Send + Sync {
    async fn read(&self, path: &Path) -> DpResult<MediaMetadata>;
}
