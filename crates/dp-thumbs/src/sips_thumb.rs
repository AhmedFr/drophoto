use std::path::Path;

use dp_core::{DpError, DpResult};
use image::RgbImage;

use crate::{blocking, resize_fit, ThumbnailProvider};

const EXTS: &[&str] = &["heic", "heif"];

/// [`ThumbnailProvider`] backed by macOS's built-in `sips` tool, used for
/// formats the `image` crate can't decode natively (HEIC/HEIF).
pub struct SipsThumb;

fn sidecar_err(e: &std::io::Error) -> DpError {
    if e.kind() == std::io::ErrorKind::NotFound {
        DpError::Sidecar {
            tool: "sips".into(),
            message: "sips not found on PATH".into(),
        }
    } else {
        DpError::Sidecar {
            tool: "sips".into(),
            message: e.to_string(),
        }
    }
}

#[async_trait::async_trait]
impl ThumbnailProvider for SipsThumb {
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

        let output = tokio::process::Command::new("sips")
            .arg("-s")
            .arg("format")
            .arg("jpeg")
            .arg("-Z")
            .arg(max_px.to_string())
            .arg(path)
            .arg("--out")
            .arg(&out_path)
            .output()
            .await
            .map_err(|e| sidecar_err(&e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(DpError::Sidecar {
                tool: "sips".into(),
                message: format!(
                    "sips exited with {status}: {stderr}",
                    status = output.status,
                    stderr = stderr.trim()
                ),
            });
        }

        let bytes = tokio::fs::read(&out_path).await.map_err(|e| DpError::Io {
            message: format!("failed to read sips output: {e}"),
            path: Some(out_path.display().to_string()),
        })?;

        blocking(move || {
            let img = image::load_from_memory(&bytes).map_err(|e| DpError::Sidecar {
                tool: "sips".into(),
                message: format!("failed to decode sips output: {e}"),
            })?;
            Ok(resize_fit(img.to_rgb8(), max_px))
        })
        .await
    }
}
