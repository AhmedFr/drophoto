use std::io::Read;
use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult};

/// Size of each chunk read from disk while hashing.
const CHUNK_SIZE: usize = 1024 * 1024;

/// Computes a content hash for a file.
#[async_trait::async_trait]
pub trait Hasher: Send + Sync {
    /// Hashes the file at `path`, returning its digest as lowercase hex.
    async fn hash_file(&self, path: &Path) -> DpResult<String>;
}

/// [`Hasher`] implementation backed by BLAKE3.
pub struct Blake3Hasher;

#[async_trait::async_trait]
impl Hasher for Blake3Hasher {
    async fn hash_file(&self, path: &Path) -> DpResult<String> {
        let path: PathBuf = path.to_path_buf();
        let path_for_err = path.clone();
        tokio::task::spawn_blocking(move || hash_file_blocking(&path))
            .await
            .map_err(|e| DpError::Io {
                message: format!("hashing task panicked: {e}"),
                path: Some(path_to_string(&path_for_err)),
            })?
    }
}

fn hash_file_blocking(path: &Path) -> DpResult<String> {
    let mut file = std::fs::File::open(path).map_err(|e| DpError::io(&e, path_to_string(path)))?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; CHUNK_SIZE];

    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| DpError::io(&e, path_to_string(path)))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[tokio::test]
    async fn hashes_file_content_with_blake3() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"hello").unwrap();

        let got = Blake3Hasher.hash_file(file.path()).await.unwrap();

        assert_eq!(got, blake3::hash(b"hello").to_hex().to_string());
    }
}
