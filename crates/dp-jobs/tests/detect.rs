use std::fs;
use std::path::Path;

use dp_jobs::detect_folders;
use tokio_util::sync::CancellationToken;

/// `tempfile::tempdir()` defaults to a dot-prefixed (hidden) directory
/// name, which the safety deny-list would treat as a hidden ancestor and
/// reject everything beneath it. Tests need a mount root with an ordinary,
/// non-hidden name — same as any real external drive mount.
fn mount_dir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("dp-detect-test-")
        .tempdir()
        .unwrap()
}

/// Writes `n` tiny jpgs named `0.jpg`, `1.jpg`, ... into `dir` (creating it
/// first).
fn write_jpgs(dir: &Path, n: usize) {
    fs::create_dir_all(dir).unwrap();
    for i in 0..n {
        fs::write(dir.join(format!("{i}.jpg")), b"x").unwrap();
    }
}

fn write_file(path: &Path, contents: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// Builds the tree the task brief describes:
/// - `DCIM/100APPLE/*.jpg` x 30
/// - `Work/node_modules/x.png`
/// - `Library/Caches/a.jpg`
/// - `.hidden/b.jpg`
/// - `Desktop/2.jpg`
fn build_tree(root: &Path) {
    write_jpgs(&root.join("DCIM/100APPLE"), 30);
    write_file(&root.join("Work/node_modules/x.png"), b"x");
    write_file(&root.join("Library/Caches/a.jpg"), b"x");
    write_file(&root.join(".hidden/b.jpg"), b"x");
    write_file(&root.join("Desktop/2.jpg"), b"x");
}

#[test]
fn aggregates_dcim_and_lists_small_folders_while_excluding_denied_dirs() {
    let tmp = mount_dir();
    build_tree(tmp.path());

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, &cancel).unwrap();

    let dcim = folders
        .iter()
        .find(|f| f.rel_path == "DCIM")
        .expect("DCIM should be reported");
    assert_eq!(dcim.media_count, 30);
    assert!(dcim.suggested, "DCIM with 30 media should be suggested");

    // 100APPLE itself must not be reported separately — it's rolled up
    // into DCIM.
    assert!(
        !folders.iter().any(|f| f.rel_path == "DCIM/100APPLE"),
        "100APPLE should be rolled up into DCIM, not reported on its own: {folders:?}"
    );

    let desktop = folders
        .iter()
        .find(|f| f.rel_path == "Desktop")
        .expect("Desktop should be reported individually");
    assert_eq!(desktop.media_count, 1);

    // Denied directories must be entirely absent from the results.
    for denied_substr in ["node_modules", "Caches", ".hidden"] {
        assert!(
            !folders.iter().any(|f| f.rel_path.contains(denied_substr)),
            "expected no folder containing {denied_substr:?}, got {folders:?}"
        );
    }

    // Sorted by media_count desc.
    for pair in folders.windows(2) {
        assert!(pair[0].media_count >= pair[1].media_count);
    }
}

#[test]
fn max_depth_limits_how_far_the_walk_descends() {
    let tmp = mount_dir();
    // A media file 5 levels deep, past a max_depth of 2.
    write_file(&tmp.path().join("a/b/c/d/deep.jpg"), b"x");
    write_file(&tmp.path().join("a/shallow.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 2, &cancel).unwrap();

    assert!(
        !folders.iter().any(|f| f.rel_path.contains("deep")),
        "file beyond max_depth should not be counted: {folders:?}"
    );
    assert!(
        folders.iter().any(|f| f.rel_path == "a" && f.media_count == 1),
        "shallow file within max_depth should be counted: {folders:?}"
    );
}

#[test]
fn cancelling_before_the_walk_returns_an_empty_partial_result() {
    let tmp = mount_dir();
    build_tree(tmp.path());

    let cancel = CancellationToken::new();
    cancel.cancel();

    let folders = detect_folders(tmp.path(), 4, &cancel).unwrap();
    assert!(
        folders.is_empty(),
        "expected no folders when cancelled before any entry is processed, got {folders:?}"
    );
}

#[test]
fn folder_with_at_least_20_media_is_suggested_even_without_a_well_known_name() {
    let tmp = mount_dir();
    write_jpgs(&tmp.path().join("RandomExportFolder"), 25);

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, &cancel).unwrap();

    let f = folders
        .iter()
        .find(|f| f.rel_path == "RandomExportFolder")
        .expect("folder should be reported");
    assert_eq!(f.media_count, 25);
    assert!(f.suggested);
}

#[test]
fn small_well_known_folder_is_suggested_by_name_alone() {
    let tmp = mount_dir();
    write_file(&tmp.path().join("Pictures/one.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, &cancel).unwrap();

    let f = folders
        .iter()
        .find(|f| f.rel_path == "Pictures")
        .expect("Pictures should be reported");
    assert_eq!(f.media_count, 1);
    assert!(
        f.suggested,
        "Pictures should be suggested by name even with just 1 file"
    );
}
