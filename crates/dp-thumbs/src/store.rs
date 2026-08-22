use std::path::PathBuf;

use dp_core::{DpError, DpResult};
use image::RgbImage;

/// Lossy WebP encoding quality used for stored thumbnails (0-100).
const WEBP_QUALITY: f32 = 82.0;

/// On-disk store for rendered thumbnails, laid out as
/// `root/<hash>/<size>.webp`.
pub struct ThumbStore {
    root: PathBuf,
}

impl ThumbStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// The path a thumbnail for `hash` at `size` would live at, whether or
    /// not it currently exists.
    pub fn path(&self, hash: &str, size: u32) -> PathBuf {
        self.root.join(hash).join(format!("{size}.webp"))
    }

    /// Whether a thumbnail for `hash` at `size` has already been written.
    pub fn exists(&self, hash: &str, size: u32) -> bool {
        self.path(hash, size).exists()
    }

    /// Encode `img` as lossy WebP and write it to disk, creating parent
    /// directories as needed. Returns the path written.
    pub async fn write(&self, hash: &str, size: u32, img: &RgbImage) -> DpResult<PathBuf> {
        let path = self.path(hash, size);

        let (w, h) = (img.width(), img.height());
        let encoded = webp::Encoder::from_rgb(img, w, h).encode(WEBP_QUALITY);

        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| DpError::Io {
                message: format!("failed to create thumbnail directory: {e}"),
                path: Some(parent.display().to_string()),
            })?;
        }

        tokio::fs::write(&path, &*encoded)
            .await
            .map_err(|e| DpError::Io {
                message: format!("failed to write thumbnail: {e}"),
                path: Some(path.display().to_string()),
            })?;

        Ok(path)
    }
}
