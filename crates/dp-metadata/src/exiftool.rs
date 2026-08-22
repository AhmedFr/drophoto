use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult, MediaMetadata};

use crate::parse::parse_exiftool_json;
use crate::MetadataProvider;

/// Tags requested from exiftool, in the order passed on the command line.
///
/// Note: this deliberately uses `-fast` rather than `-fast2`. `-fast2` stops
/// scanning QuickTime-format files (mp4/mov) at the `mdat` atom, which on our
/// synthetic fixtures suppresses `Duration`/`CreateDate` entirely (they live
/// past `mdat` in these files) — see fixtures/README.md and Task 1.3 spike
/// notes. `-fast` (level 1) skips trailing preview/AFCP data for JPEGs while
/// still reading the QuickTime atoms we need, at effectively the same speed.
const ARGS: &[&str] = &[
    "-json",
    "-n",
    "-fast",
    "-DateTimeOriginal",
    "-CreateDate",
    "-MediaCreateDate",
    "-Model",
    "-LensModel",
    "-FNumber",
    "-ExposureTime",
    "-ISO",
    "-FocalLength",
    "-ImageWidth",
    "-ImageHeight",
    "-GPSLatitude",
    "-GPSLongitude",
    "-Duration",
];

/// [`MetadataProvider`] backed by the `exiftool` command-line tool.
pub struct ExiftoolProvider {
    bin: PathBuf,
}

impl ExiftoolProvider {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self { bin: bin.into() }
    }

    pub fn from_path() -> Self {
        Self::new("exiftool")
    }
}

#[async_trait::async_trait]
impl MetadataProvider for ExiftoolProvider {
    async fn read(&self, path: &Path) -> DpResult<MediaMetadata> {
        let output = tokio::process::Command::new(&self.bin)
            .args(ARGS)
            .arg(path)
            .output()
            .await
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    DpError::Sidecar {
                        tool: "exiftool".into(),
                        message: "exiftool not found on PATH".into(),
                    }
                } else {
                    DpError::Sidecar {
                        tool: "exiftool".into(),
                        message: e.to_string(),
                    }
                }
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(DpError::Sidecar {
                tool: "exiftool".into(),
                message: format!(
                    "exiftool exited with {status}: {stderr}",
                    status = output.status,
                    stderr = stderr.trim()
                ),
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_exiftool_json(&stdout)
    }
}
