mod chain;
mod exiftool_preview;
mod ffmpeg_thumb;
mod image_thumb;
mod sips_thumb;
mod store;

pub use chain::ThumbChain;
pub use exiftool_preview::ExiftoolPreviewThumb;
pub use ffmpeg_thumb::FfmpegThumb;
pub use image_thumb::ImageCrateThumb;
pub use sips_thumb::SipsThumb;
pub use store::ThumbStore;

use std::path::Path;

use dp_core::{DpError, DpResult};
use image::{imageops::FilterType, RgbImage};

/// Thumbnail sizes (longest edge, px) generated for each media item.
pub const THUMB_SIZES: [u32; 2] = [400, 2000];

/// A source that can render a still-image thumbnail for a given file
/// extension.
#[async_trait::async_trait]
pub trait ThumbnailProvider: Send + Sync {
    /// Whether this provider handles files with the given (lowercase,
    /// no-dot) extension.
    fn supports(&self, ext: &str) -> bool;

    /// Render a thumbnail for `path`, scaled so its longest edge is at
    /// most `max_px`.
    async fn render(&self, path: &Path, max_px: u32) -> DpResult<RgbImage>;
}

/// Scale `img` so its longest edge equals `max_px`, preserving aspect
/// ratio. Never upscales: if the source's longest edge is already `<=
/// max_px`, `img` is returned unchanged.
pub fn resize_fit(img: RgbImage, max_px: u32) -> RgbImage {
    let (w, h) = (img.width(), img.height());
    let longest = w.max(h);
    if longest <= max_px {
        return img;
    }
    let scale = max_px as f64 / longest as f64;
    let new_w = ((w as f64 * scale).round() as u32).max(1);
    let new_h = ((h as f64 * scale).round() as u32).max(1);
    image::imageops::resize(&img, new_w, new_h, FilterType::Triangle)
}

/// Run a CPU-bound closure on tokio's blocking thread pool. Used to keep
/// decode/resize/encode work (which can take tens of milliseconds per
/// file, and runs in a loop over potentially thousands of files during a
/// scan) off the async worker threads.
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> DpResult<T> + Send + 'static,
) -> DpResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| DpError::Io {
        message: e.to_string(),
        path: None,
    })?
}
