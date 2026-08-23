use std::fs;
use std::path::Path;

use dp_jobs::{detect_folders, detect_folders_with_progress};
use tokio_util::sync::CancellationToken;

/// Plain `tempfile::tempdir()` — no workaround needed. Its default
/// dot-prefixed name and its home under the system temp directory (which
/// on macOS canonicalizes through `/private`, itself on the mount-relative
/// deny list) used to break the deny-list; both are now non-issues since
/// `is_denied_path`'s rules are scoped to path components *below* the
/// mount, never to the mount's own real location or name.
fn mount_dir() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

/// Writes `n` tiny (1-byte) jpgs named `0.jpg`, `1.jpg`, ... into `dir`
/// (creating it first).
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
    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();

    let dcim = folders
        .iter()
        .find(|f| f.rel_path == "DCIM")
        .expect("DCIM should be reported");
    assert_eq!(dcim.media_count, 30);
    // Every file is written as a single byte (`b"x"`), so 30 files means
    // 30 bytes summed across the aggregated subtree.
    assert_eq!(dcim.bytes, 30, "bytes should sum every counted file's size");
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
    assert_eq!(desktop.bytes, 1);

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
fn regression_a_tempdir_mount_canonicalizing_under_private_still_works() {
    // This is the regression test for the "mount canonicalizes under
    // /private -> everything denied" bug: a plain tempfile::tempdir() on
    // macOS lives under /tmp or /var, both symlinks into /private, so
    // std::fs::canonicalize(mount) inside detect_folders lands squarely on
    // one of the mount-relative denied prefix names. If system-prefix
    // checks were still absolute (checking the mount's own real location)
    // this would silently return an empty result.
    let tmp = mount_dir();
    write_jpgs(&tmp.path().join("DCIM/100APPLE"), 25);
    write_file(&tmp.path().join("Desktop/pic.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();

    let dcim = folders
        .iter()
        .find(|f| f.rel_path == "DCIM")
        .expect("DCIM should be reported even though the mount canonicalizes under /private");
    assert_eq!(dcim.media_count, 25);
    assert!(folders.iter().any(|f| f.rel_path == "Desktop"));
}

#[test]
fn max_depth_limits_how_far_the_walk_descends() {
    let tmp = mount_dir();
    // A media file 5 levels deep, past a max_depth of 2.
    write_file(&tmp.path().join("a/b/c/d/deep.jpg"), b"x");
    write_file(&tmp.path().join("a/shallow.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 2, None, &cancel).unwrap();

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

    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();
    assert!(
        folders.is_empty(),
        "expected no folders when cancelled before any entry is processed, got {folders:?}"
    );
}

#[test]
fn cancelling_mid_walk_via_the_progress_hook_stops_before_the_whole_tree_is_counted() {
    let tmp = mount_dir();
    // 40 folders x 50 jpgs = 2000 files; cancelling after the 100th
    // walked entry (from inside the walk itself, not a wall-clock race)
    // should leave the overwhelming majority uncounted.
    for i in 0..40 {
        write_jpgs(&tmp.path().join(format!("Folder{i}")), 50);
    }

    let cancel = CancellationToken::new();
    let mut entries_seen = 0u64;
    let folders = detect_folders_with_progress(tmp.path(), 4, None, &cancel, &mut |count| {
        entries_seen = count;
        if count >= 100 {
            cancel.cancel();
        }
    })
    .expect("mid-walk cancellation should still return Ok");

    let total_counted: u64 = folders.iter().map(|f| f.media_count).sum();
    assert!(
        entries_seen >= 100,
        "hook should have fired at least 100 times, got {entries_seen}"
    );
    assert!(
        total_counted < 2000,
        "expected an early stop, counted {total_counted} of 2000 files"
    );
}

#[test]
fn folder_with_at_least_20_media_is_suggested_even_without_a_well_known_name() {
    let tmp = mount_dir();
    write_jpgs(&tmp.path().join("RandomExportFolder"), 25);

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();

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
    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();

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

#[test]
fn rollup_never_collapses_past_a_well_known_folder_or_a_users_name_dir() {
    let tmp = mount_dir();
    write_jpgs(&tmp.path().join("Users/alice/Pictures"), 25);
    write_file(&tmp.path().join("Users/alice/Work/x.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();

    let pictures = folders
        .iter()
        .find(|f| f.rel_path == "Users/alice/Pictures")
        .expect("Users/alice/Pictures should be reported on its own");
    assert_eq!(pictures.media_count, 25);
    assert!(pictures.suggested);

    let work = folders
        .iter()
        .find(|f| f.rel_path == "Users/alice/Work")
        .expect("Users/alice/Work should be reported on its own");
    assert_eq!(work.media_count, 1);

    assert!(
        !folders
            .iter()
            .any(|f| f.rel_path == "Users" || f.rel_path == "Users/alice"),
        "neither Users nor Users/alice should absorb their children: {folders:?}"
    );
}

#[test]
fn mount_relative_system_folder_is_denied_for_any_mount_location() {
    let tmp = mount_dir();
    // Not under /Volumes — proves the deny rule is mount-relative, not
    // tied to the `/Volumes/<name>/System` convention alone.
    write_file(&tmp.path().join("System/CoreServices/x.jpg"), b"x");
    write_file(&tmp.path().join("Pictures/keep.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 4, None, &cancel).unwrap();

    assert!(
        !folders.iter().any(|f| f.rel_path.starts_with("System")),
        "mount/System should be denied regardless of where the mount lives: {folders:?}"
    );
    assert!(folders.iter().any(|f| f.rel_path == "Pictures"));
}

#[test]
fn home_library_is_excluded_when_home_is_supplied() {
    let tmp = mount_dir();
    // `home` must line up with the *canonicalized* mount (what
    // detect_folders actually walks), so build it from the canonical form
    // rather than tmp.path() directly.
    let mount_canon = std::fs::canonicalize(tmp.path()).unwrap();
    let home = mount_canon.join("home-stand-in");
    write_file(&home.join("Library/Caches/should-not-count.jpg"), b"x");
    write_file(&home.join("Pictures/keep.jpg"), b"x");

    let cancel = CancellationToken::new();
    let folders = detect_folders(tmp.path(), 6, Some(&home), &cancel).unwrap();

    assert!(
        !folders.iter().any(|f| f.rel_path.contains("Library")),
        "home/Library should be excluded when home is supplied: {folders:?}"
    );
    assert!(folders.iter().any(|f| f.rel_path.ends_with("Pictures")));
}
