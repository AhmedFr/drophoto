use std::io;
use std::path::Path;
use std::sync::Arc;

use dp_core::DpResult;
use dp_hash::{Blake3Hasher, Hasher};
use dp_organize::{CopyVerifyDeleteStrategy, MoveStrategy, RenameStrategy};

/// A [`Hasher`] stub that returns a fixed digest regardless of file
/// content, or two different fixed digests depending on the queried
/// path, so tests can force a verification mismatch deterministically.
struct StubHasher {
    for_path: Box<dyn Fn(&Path) -> String + Send + Sync>,
}

#[async_trait::async_trait]
impl Hasher for StubHasher {
    async fn hash_file(&self, path: &Path) -> DpResult<String> {
        Ok((self.for_path)(path))
    }
}

#[tokio::test]
async fn rename_moves_and_creates_dirs() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("nested/deep/dst.txt");

    let strategy = RenameStrategy::new(Arc::new(Blake3Hasher));
    strategy.move_file(&from, &to).await.unwrap();

    assert!(!from.exists());
    assert!(to.exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"hello");
}

#[tokio::test]
async fn refuses_to_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("dst.txt");
    std::fs::write(&to, b"already here").unwrap();

    let strategy = RenameStrategy::new(Arc::new(Blake3Hasher));
    let err = strategy.move_file(&from, &to).await.unwrap_err();

    assert_eq!(err.to_string(), "destination exists");
    assert!(from.exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"already here");
}

#[tokio::test]
async fn copy_verify_delete_moves_when_rename_fails() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("nested/dst.txt");

    let exdev_rename = |_from: &Path, _to: &Path| -> io::Result<()> { Err(io::Error::from_raw_os_error(18)) };
    let strategy = RenameStrategy::with_rename(Arc::new(Blake3Hasher), exdev_rename);

    strategy.move_file(&from, &to).await.unwrap();

    assert!(!from.exists());
    assert!(to.exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"hello");
}

#[tokio::test]
async fn copy_verify_delete_keeps_source_on_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("dst.txt");

    let from_for_hash = from.clone();
    let hasher = StubHasher {
        for_path: Box::new(move |p: &Path| {
            if p == from_for_hash {
                "hash-a".to_string()
            } else {
                "hash-b".to_string()
            }
        }),
    };

    let strategy = CopyVerifyDeleteStrategy {
        hasher: Arc::new(hasher),
    };
    let err = strategy.move_file(&from, &to).await.unwrap_err();

    assert_eq!(err.to_string(), "verification failed");
    assert!(from.exists(), "source must survive a verification mismatch");
    assert!(!to.exists(), "destination must be cleaned up on mismatch");
}
