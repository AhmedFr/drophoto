use std::path::Path;
use std::sync::Arc;

use dp_core::{DpError, DpResult};
use image::RgbImage;

use crate::{ExiftoolPreviewThumb, FfmpegThumb, ImageCrateThumb, SipsThumb, ThumbnailProvider};

/// An ordered chain of [`ThumbnailProvider`]s. The first provider whose
/// [`ThumbnailProvider::supports`] matches the given extension handles the
/// render.
pub struct ThumbChain(Vec<Arc<dyn ThumbnailProvider>>);

impl ThumbChain {
    pub fn new(providers: Vec<Arc<dyn ThumbnailProvider>>) -> Self {
        Self(providers)
    }

    /// The default provider chain: native `image` crate decoders first,
    /// then RAW previews via `exiftool`, then HEIC/HEIF via `sips`, then
    /// video frames via `ffmpeg`.
    pub fn default_chain() -> Self {
        Self(vec![
            Arc::new(ImageCrateThumb),
            Arc::new(ExiftoolPreviewThumb::from_path()),
            Arc::new(SipsThumb),
            Arc::new(FfmpegThumb::from_path()),
        ])
    }

    /// Render a thumbnail for `path` (with lowercase, no-dot extension
    /// `ext`) using the first supporting provider in the chain.
    pub async fn render(&self, path: &Path, ext: &str, max_px: u32) -> DpResult<RgbImage> {
        for provider in &self.0 {
            if provider.supports(ext) {
                return provider.render(path, max_px).await;
            }
        }

        Err(DpError::Unsupported {
            message: format!("no thumbnail provider for .{ext}"),
            path: Some(path.display().to_string()),
        })
    }
}
