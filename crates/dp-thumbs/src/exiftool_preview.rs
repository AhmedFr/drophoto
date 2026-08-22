use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult};
use image::RgbImage;

use crate::{resize_fit, ThumbnailProvider};

const EXTS: &[&str] = &["raf", "cr2", "cr3", "arw", "nef", "dng", "orf", "rw2"];

/// Tags to try, in order, for extracting an embedded preview image from a
/// RAW file via `exiftool -b`. Cameras vary in which of these they embed.
const TAGS: &[&str] = &["-PreviewImage", "-JpgFromRaw", "-ThumbnailImage"];

/// [`ThumbnailProvider`] that extracts an embedded JPEG preview from a RAW
/// file via the `exiftool` command-line tool.
pub struct ExiftoolPreviewThumb {
    bin: PathBuf,
}

impl ExiftoolPreviewThumb {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self { bin: bin.into() }
    }

    pub fn from_path() -> Self {
        Self::new("exiftool")
    }

    async fn extract_preview(&self, path: &Path) -> DpResult<Vec<u8>> {
        let mut last_stderr = String::new();

        for tag in TAGS {
            let output = tokio::process::Command::new(&self.bin)
                .arg("-b")
                .arg(tag)
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

            if output.status.success() && !output.stdout.is_empty() {
                return Ok(output.stdout);
            }

            if !output.status.success() {
                last_stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            }
        }

        Err(DpError::Sidecar {
            tool: "exiftool".into(),
            message: format!(
                "no embedded preview image found (tried {tags}){stderr}",
                tags = TAGS.join(", "),
                stderr = if last_stderr.is_empty() {
                    String::new()
                } else {
                    format!(": {last_stderr}")
                }
            ),
        })
    }
}

#[async_trait::async_trait]
impl ThumbnailProvider for ExiftoolPreviewThumb {
    fn supports(&self, ext: &str) -> bool {
        EXTS.contains(&ext)
    }

    async fn render(&self, path: &Path, max_px: u32) -> DpResult<RgbImage> {
        let bytes = self.extract_preview(path).await?;

        let img = image::load_from_memory(&bytes).map_err(|e| DpError::Sidecar {
            tool: "exiftool".into(),
            message: format!("failed to decode extracted preview: {e}"),
        })?;

        Ok(resize_fit(img.to_rgb8(), max_px))
    }
}
