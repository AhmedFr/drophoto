use std::path::PathBuf;

use dp_metadata::{ExiftoolProvider, MetadataProvider};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

#[tokio::test]
async fn reads_photo_metadata() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let provider = ExiftoolProvider::from_path();
    let m = provider.read(&fixtures_dir().join("sample.jpg")).await.unwrap();

    assert_eq!(m.camera.as_deref(), Some("Sony ILCE-7M4"));
    assert!((m.lat.unwrap() - 38.71).abs() < 1e-6);
    assert!((m.lon.unwrap() - (-9.13)).abs() < 1e-6);
    assert_eq!(m.taken_at.unwrap().to_rfc3339(), "2025-09-12T14:03:21+00:00");
    assert_eq!(m.width, Some(640));
}

#[tokio::test]
async fn reads_video_metadata() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let provider = ExiftoolProvider::from_path();
    let m = provider.read(&fixtures_dir().join("sample.mp4")).await.unwrap();

    assert_eq!(m.duration_ms, Some(2000));
    assert!(m.taken_at.is_none());
}

#[tokio::test]
async fn reads_heic_metadata() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let provider = ExiftoolProvider::from_path();
    let m = provider.read(&fixtures_dir().join("sample.heic")).await.unwrap();

    assert_eq!(m.width, Some(640));
    assert!(m.camera.is_some());
}
