use std::path::{Path, PathBuf};

use dp_metadata::{sidecar_path, ExiftoolSidecars, Sidecars};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

/// Copies the tiny real jpg fixture into `dir`, returning its path.
async fn copy_fixture_jpg(dir: &Path) -> PathBuf {
    let dest = dir.join("sample.jpg");
    tokio::fs::copy(fixtures_dir().join("sample.jpg"), &dest)
        .await
        .unwrap();
    dest
}

#[test]
fn sidecar_path_appends_xmp() {
    assert_eq!(
        sidecar_path(Path::new("/a/IMG_001.jpg")),
        PathBuf::from("/a/IMG_001.jpg.xmp")
    );
}

#[tokio::test]
async fn write_then_read_round_trips() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let media = copy_fixture_jpg(dir.path()).await;
    let original_bytes = tokio::fs::read(&media).await.unwrap();

    let sidecars = ExiftoolSidecars::from_path();
    let subjects = vec!["beach".to_string(), "Trip".to_string()];
    sidecars.write_subjects(&media, &subjects).await.unwrap();

    let read_back = sidecars.read_subjects(&media).await.unwrap();
    assert_eq!(read_back, subjects);

    let bytes_after = tokio::fs::read(&media).await.unwrap();
    assert_eq!(original_bytes, bytes_after, "media file must be untouched");
}

#[tokio::test]
async fn write_creates_missing_sidecar_from_template() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let media = copy_fixture_jpg(dir.path()).await;
    let sidecar = sidecar_path(&media);
    assert!(!sidecar.exists());

    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media, &["one".to_string()])
        .await
        .unwrap();

    assert!(sidecar.exists());
    let read_back = sidecars.read_subjects(&media).await.unwrap();
    assert_eq!(read_back, vec!["one".to_string()]);
}

#[tokio::test]
async fn write_replaces_existing_subjects_preserving_other_xmp() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let media = copy_fixture_jpg(dir.path()).await;
    let sidecar = sidecar_path(&media);

    // Pre-write a sidecar via exiftool directly, with a Creator and one subject.
    let output = tokio::process::Command::new("exiftool")
        .arg("-overwrite_original")
        .arg("-XMP-dc:Creator=me")
        .arg("-XMP-dc:Subject=old")
        .arg(&sidecar)
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    assert!(sidecar.exists());

    let sidecars = ExiftoolSidecars::from_path();
    sidecars.write_subjects(&media, &["x".to_string()]).await.unwrap();

    let subjects = sidecars.read_subjects(&media).await.unwrap();
    assert_eq!(subjects, vec!["x".to_string()]);

    // Creator must survive the write.
    let output = tokio::process::Command::new("exiftool")
        .args(["-json", "-XMP-dc:Creator"])
        .arg(&sidecar)
        .output()
        .await
        .unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("\"me\""), "Creator missing: {stdout}");
}

#[tokio::test]
async fn read_missing_sidecar_is_empty() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let media = copy_fixture_jpg(dir.path()).await;

    let sidecars = ExiftoolSidecars::from_path();
    let subjects = sidecars.read_subjects(&media).await.unwrap();
    assert_eq!(subjects, Vec::<String>::new());
}

#[tokio::test]
async fn subjects_with_xml_special_chars_round_trip() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let media = copy_fixture_jpg(dir.path()).await;

    let sidecars = ExiftoolSidecars::from_path();
    let subjects = vec!["fête & <friends>".to_string()];
    sidecars.write_subjects(&media, &subjects).await.unwrap();

    let read_back = sidecars.read_subjects(&media).await.unwrap();
    assert_eq!(read_back, subjects);
}

#[tokio::test]
async fn write_empty_list_clears_subjects() {
    if which::which("exiftool").is_err() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let media = copy_fixture_jpg(dir.path()).await;

    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media, &["one".to_string(), "two".to_string()])
        .await
        .unwrap();
    sidecars.write_subjects(&media, &[]).await.unwrap();

    let read_back = sidecars.read_subjects(&media).await.unwrap();
    assert_eq!(read_back, Vec::<String>::new());
}
