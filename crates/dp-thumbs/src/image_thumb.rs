use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult};
use image::RgbImage;

use crate::{resize_fit, ThumbnailProvider};

/// [`ThumbnailProvider`] backed by the `image` crate's native decoders
/// (JPEG, PNG, TIFF, WebP).
pub struct ImageCrateThumb;

const EXTS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp"];

#[async_trait::async_trait]
impl ThumbnailProvider for ImageCrateThumb {
    fn supports(&self, ext: &str) -> bool {
        EXTS.contains(&ext)
    }

    async fn render(&self, path: &Path, max_px: u32) -> DpResult<RgbImage> {
        let path: PathBuf = path.to_path_buf();
        let img = tokio::task::spawn_blocking(move || {
            image::open(&path).map_err(|e| DpError::Io {
                message: format!("failed to decode image: {e}"),
                path: Some(path.display().to_string()),
            })
        })
        .await
        .map_err(|e| DpError::Io {
            message: format!("image decode task panicked: {e}"),
            path: None,
        })??;

        Ok(resize_fit(img.to_rgb8(), max_px))
    }
}
