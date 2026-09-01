use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult};
use image::RgbImage;

use crate::{blocking, resize_fit, ThumbnailProvider};

const EXTS: &[&str] = &["mp4", "mov", "m4v"];

/// Seek offsets (seconds) to try, in order, when extracting a preview
/// frame. Short clips can have no frame at 0.5s, so we fall back to the
/// very first frame.
const SEEK_ATTEMPTS: &[&str] = &["0.5", "0"];

/// [`ThumbnailProvider`] that extracts a single video frame via the
/// `ffmpeg` command-line tool.
pub struct FfmpegThumb {
    bin: PathBuf,
}

impl FfmpegThumb {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self { bin: bin.into() }
    }

    pub fn from_path() -> Self {
        Self::new("ffmpeg")
    }

    /// Resolves `ffmpeg` via `dp_metadata::resolve_tool` ($PATH plus the
    /// Homebrew/MacPorts fallback dirs a bundled, Finder-launched app's
    /// environment doesn't inherit — see its doc comment), falling back to
    /// the bare `"ffmpeg"` command name when it can't be found anywhere
    /// (same behavior [`Self::from_path`] always had). Mirrors
    /// `dp_metadata::ExiftoolProvider::from_resolved` exactly — see Task
    /// 5b.3.
    pub fn from_resolved() -> Self {
        Self::new(dp_metadata::resolve_tool("ffmpeg").unwrap_or_else(|| PathBuf::from("ffmpeg")))
    }

    async fn extract_frame(&self, path: &Path, max_px: u32, out_path: &Path) -> DpResult<()> {
        let mut last_message = String::new();

        for ss in SEEK_ATTEMPTS {
            let output = tokio::process::Command::new(&self.bin)
                .arg("-y")
                .arg("-loglevel")
                .arg("error")
                .arg("-ss")
                .arg(ss)
                .arg("-i")
                .arg(path)
                .arg("-frames:v")
                .arg("1")
                .arg("-update")
                .arg("1")
                .arg("-vf")
                .arg(format!("scale='min({max_px},iw)':-2"))
                .arg("-f")
                .arg("image2")
                .arg(out_path)
                .output()
                .await
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        DpError::Sidecar {
                            tool: "ffmpeg".into(),
                            message: "ffmpeg not found on PATH".into(),
                        }
                    } else {
                        DpError::Sidecar {
                            tool: "ffmpeg".into(),
                            message: e.to_string(),
                        }
                    }
                })?;

            let produced = tokio::fs::metadata(out_path)
                .await
                .map(|m| m.len() > 0)
                .unwrap_or(false);

            if output.status.success() && produced {
                return Ok(());
            }

            last_message = if output.status.success() {
                "ffmpeg exited successfully but produced no output file".to_string()
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                format!(
                    "ffmpeg exited with {status}: {stderr}",
                    status = output.status,
                    stderr = stderr.trim()
                )
            };
        }

        Err(DpError::Sidecar {
            tool: "ffmpeg".into(),
            message: last_message,
        })
    }
}

#[async_trait::async_trait]
impl ThumbnailProvider for FfmpegThumb {
    fn supports(&self, ext: &str) -> bool {
        EXTS.contains(&ext)
    }

    async fn render(&self, path: &Path, max_px: u32) -> DpResult<RgbImage> {
        let tmp = tempfile::Builder::new()
            .suffix(".jpg")
            .tempfile()
            .map_err(|e| DpError::Io {
                message: format!("failed to create temp file: {e}"),
                path: None,
            })?;
        let out_path = tmp.path().to_path_buf();

        self.extract_frame(path, max_px, &out_path).await?;

        let bytes = tokio::fs::read(&out_path).await.map_err(|e| DpError::Io {
            message: format!("failed to read ffmpeg output: {e}"),
            path: Some(out_path.display().to_string()),
        })?;

        blocking(move || {
            let img = image::load_from_memory(&bytes).map_err(|e| DpError::Sidecar {
                tool: "ffmpeg".into(),
                message: format!("failed to decode ffmpeg output: {e}"),
            })?;
            Ok(resize_fit(img.to_rgb8(), max_px))
        })
        .await
    }
}
