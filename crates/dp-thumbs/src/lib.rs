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

/// Thumbnail *slot* sizes — [`ThumbStore`] filenames (`400.webp`,
/// `2000.webp`) generated for each media item. These are on-disk slot
/// identifiers, not necessarily the pixel edge actually rendered into
/// them: the `2000` slot (see [`PREVIEW_SLOT`]) is the "preview" and its
/// rendered edge is parametrized by the user's preview-quality setting
/// (see [`render_edge_for_slot`]) — the filename never changes, only what's
/// encoded into it, so lowering/raising quality never renames (or has to
/// migrate) any of the potentially tens of thousands of files already on
/// disk, and every existing `preview_path` (`store.path(hash, 2000)`)
/// keeps working unchanged.
pub const THUMB_SIZES: [u32; 2] = [400, 2000];

/// The `400.webp` slot — always rendered at exactly 400px; never
/// parametrized by the preview-quality setting.
pub const THUMB_SLOT: u32 = 400;

/// The `2000.webp` slot — "the preview". Its *filename* is fixed at
/// `2000.webp` regardless of quality setting; its *rendered* pixel edge is
/// whatever [`render_edge_for_slot`] resolves for the current
/// `preview_edge` setting (`800`/`1200`/`2000` in the current UI — see
/// `dp_core::PREVIEW_EDGE_COMPACT`/`PREVIEW_EDGE_BALANCED`/`PREVIEW_EDGE_MAX`).
pub const PREVIEW_SLOT: u32 = 2000;

/// The pixel edge to actually render/store for thumbnail slot `slot_px`
/// (one of [`THUMB_SLOT`]/[`PREVIEW_SLOT`]), given the current
/// `preview_edge` setting. Only the preview slot is parametrized — the
/// 400px thumb slot always renders at its own fixed size regardless of
/// `preview_edge`.
pub fn render_edge_for_slot(slot_px: u32, preview_edge: u32) -> u32 {
    if slot_px == PREVIEW_SLOT {
        preview_edge
    } else {
        slot_px
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_edge_for_slot_leaves_the_thumb_slot_fixed_regardless_of_preview_edge() {
        assert_eq!(render_edge_for_slot(THUMB_SLOT, 800), THUMB_SLOT);
        assert_eq!(render_edge_for_slot(THUMB_SLOT, 2000), THUMB_SLOT);
    }

    #[test]
    fn render_edge_for_slot_parametrizes_the_preview_slot_by_the_setting() {
        assert_eq!(render_edge_for_slot(PREVIEW_SLOT, 800), 800);
        assert_eq!(render_edge_for_slot(PREVIEW_SLOT, 1200), 1200);
        assert_eq!(render_edge_for_slot(PREVIEW_SLOT, 2000), 2000);
    }
}
