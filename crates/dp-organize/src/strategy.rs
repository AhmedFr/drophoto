//! Move strategies: how a planned move actually gets applied to the
//! filesystem.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use dp_core::{DpError, DpResult};
use dp_hash::Hasher;

/// Moves a file from one path to another.
#[async_trait::async_trait]
pub trait MoveStrategy: Send + Sync {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()>;
}

/// Runs a blocking closure on tokio's blocking thread pool.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> DpResult<T> + Send + 'static) -> DpResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| DpError::Io {
        message: format!("blocking task panicked: {e}"),
        path: None,
    })?
}

type RenameFn = dyn Fn(&Path, &Path) -> io::Result<()> + Send + Sync;

/// Moves a file with `fs::rename`, creating the destination's parent
/// directories first. Refuses to overwrite an existing destination. On
/// `EXDEV` (rename across filesystems/volumes) falls back to
/// [`CopyVerifyDeleteStrategy`].
pub struct RenameStrategy {
    hasher: Arc<dyn Hasher>,
    rename_fn: Arc<RenameFn>,
}

impl RenameStrategy {
    pub fn new(hasher: Arc<dyn Hasher>) -> Self {
        Self {
            hasher,
            rename_fn: Arc::new(|from, to| std::fs::rename(from, to)),
        }
    }

    /// Builds a `RenameStrategy` with an injectable rename implementation,
    /// so the EXDEV fallback path can be exercised without two real
    /// volumes.
    #[cfg(any(test, feature = "test-util"))]
    pub fn with_rename(
        hasher: Arc<dyn Hasher>,
        rename_fn: impl Fn(&Path, &Path) -> io::Result<()> + Send + Sync + 'static,
    ) -> Self {
        Self {
            hasher,
            rename_fn: Arc::new(rename_fn),
        }
    }
}

/// Linux/macOS `EXDEV`: "Invalid cross-device link".
const EXDEV: i32 = 18;

#[async_trait::async_trait]
impl MoveStrategy for RenameStrategy {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()> {
        let from = from.to_path_buf();
        let to = to.to_path_buf();
        let rename_fn = self.rename_fn.clone();

        let needs_fallback = blocking(move || do_rename(rename_fn.as_ref(), &from, &to)).await?;

        match needs_fallback {
            None => Ok(()),
            Some((from, to)) => {
                let fallback = CopyVerifyDeleteStrategy {
                    hasher: self.hasher.clone(),
                };
                fallback.move_file(&from, &to).await
            }
        }
    }
}

/// Performs the actual rename, returning `Some((from, to))` if the
/// caller should fall back to copy+verify+delete (EXDEV), `None` on
/// success, or an error for anything else.
fn do_rename(rename_fn: &RenameFn, from: &Path, to: &Path) -> DpResult<Option<(PathBuf, PathBuf)>> {
    if to.exists() {
        return Err(DpError::Io {
            message: "destination exists".into(),
            path: Some(to.display().to_string()),
        });
    }

    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DpError::io(&e, Some(parent.display().to_string())))?;
    }

    match rename_fn(from, to) {
        Ok(()) => Ok(None),
        Err(e) if e.raw_os_error() == Some(EXDEV) => Ok(Some((from.to_path_buf(), to.to_path_buf()))),
        Err(e) => Err(DpError::io(&e, Some(to.display().to_string()))),
    }
}

/// Moves a file by copying it, verifying the copy's content hash matches
/// the source's, then deleting the source. Used when a plain rename
/// can't cross filesystems.
pub struct CopyVerifyDeleteStrategy {
    pub hasher: Arc<dyn Hasher>,
}

#[async_trait::async_trait]
impl MoveStrategy for CopyVerifyDeleteStrategy {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()> {
        let from = from.to_path_buf();
        let to = to.to_path_buf();

        {
            let from = from.clone();
            let to = to.clone();
            blocking(move || copy_blocking(&from, &to)).await?;
        }

        let from_hash = self.hasher.hash_file(&from).await?;
        let to_hash = self.hasher.hash_file(&to).await?;

        if from_hash != to_hash {
            let cleanup = to.clone();
            let _ = blocking(move || std::fs::remove_file(&cleanup).map_err(|e| DpError::io(&e, None))).await;
            return Err(DpError::Io {
                message: "verification failed".into(),
                path: Some(to.display().to_string()),
            });
        }

        blocking(move || {
            std::fs::remove_file(&from).map_err(|e| DpError::io(&e, Some(from.display().to_string())))
        })
        .await
    }
}

fn copy_blocking(from: &Path, to: &Path) -> DpResult<()> {
    if to.exists() {
        return Err(DpError::Io {
            message: "destination exists".into(),
            path: Some(to.display().to_string()),
        });
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| DpError::io(&e, Some(parent.display().to_string())))?;
    }
    std::fs::copy(from, to).map_err(|e| DpError::io(&e, Some(to.display().to_string())))?;
    Ok(())
}

/// The default move strategy: rename with a copy+verify+delete fallback
/// for cross-filesystem moves.
pub fn default_strategy(hasher: Arc<dyn Hasher>) -> Arc<dyn MoveStrategy> {
    Arc::new(RenameStrategy::new(hasher))
}
