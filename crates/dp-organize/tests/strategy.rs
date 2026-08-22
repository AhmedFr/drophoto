use std::io;
use std::path::{Path, PathBuf};
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

/// An `hdiutil`-backed disk image, mounted for the lifetime of the
/// guard and detached (and its backing file removed) on drop. Used to
/// exercise real filesystem semantics (case sensitivity, exFAT) that
/// tmpfs/APFS-under-a-tempdir can't reproduce. `create` returns `None`
/// (rather than panicking) if `hdiutil` isn't available or the image
/// couldn't be created/attached, so tests can skip gracefully in
/// environments (e.g. non-macOS CI, sandboxes without disk-image
/// privileges) where this isn't possible.
struct DiskImage {
    dmg_path: PathBuf,
    mount_point: PathBuf,
}

/// `hdiutil` shells out to `diskarbitrationd`, which serializes disk
/// arbitration system-wide; running two `hdiutil create`/`attach` calls
/// concurrently (as happens when cargo runs tests in parallel threads)
/// can make one transiently fail with `EPERM`. Since this test binary
/// only ever has at most two `DiskImage`-using tests, serialize all
/// `hdiutil` invocations behind a single process-wide lock rather than
/// let that race make the test flaky.
static HDIUTIL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Set `DP_REQUIRE_DISK_IMAGE_TESTS=1` to turn the graceful skips below
/// into hard failures — for a machine (or CI job) where the disk-image
/// tests are *expected* to run and a silent skip would be a false green.
const REQUIRE_ENV: &str = "DP_REQUIRE_DISK_IMAGE_TESTS";

/// Reports a disk image that couldn't be created: a skip by default,
/// a panic when [`REQUIRE_ENV`] is set to `1`.
fn missing_disk_image(reason: &str) {
    if std::env::var(REQUIRE_ENV).as_deref() == Ok("1") {
        panic!("{reason} (required by {REQUIRE_ENV}=1)");
    }
    eprintln!("skipping: {reason}");
}

impl DiskImage {
    fn create(fs: &str, volname: &str) -> Option<Self> {
        let _guard = HDIUTIL_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let dmg_path = std::env::temp_dir().join(format!("dp-organize-test-{volname}.dmg"));
        let _ = std::fs::remove_file(&dmg_path);

        let created = std::process::Command::new("hdiutil")
            .args(["create", "-size", "20m", "-fs", fs, "-volname", volname])
            .arg(&dmg_path)
            .status();
        if !matches!(created, Ok(status) if status.success()) {
            return None;
        }

        let attached = std::process::Command::new("hdiutil")
            .args(["attach", "-nobrowse"])
            .arg(&dmg_path)
            .status();
        if !matches!(attached, Ok(status) if status.success()) {
            let _ = std::fs::remove_file(&dmg_path);
            return None;
        }

        let mount_point = PathBuf::from(format!("/Volumes/{volname}"));
        if !mount_point.exists() {
            let _ = std::process::Command::new("hdiutil")
                .args(["detach", "-force"])
                .arg(&mount_point)
                .status();
            let _ = std::fs::remove_file(&dmg_path);
            return None;
        }

        Some(Self {
            dmg_path,
            mount_point,
        })
    }

    fn path(&self) -> &Path {
        &self.mount_point
    }
}

impl Drop for DiskImage {
    fn drop(&mut self) {
        let _guard = HDIUTIL_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = std::process::Command::new("hdiutil")
            .args(["detach", "-force"])
            .arg(&self.mount_point)
            .status();
        let _ = std::fs::remove_file(&self.dmg_path);
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

/// macOS's default filesystem is case-insensitive: renaming a file to a
/// path that differs only by letter case is renaming it to itself, not
/// overwriting a different file, and must succeed without hitting the
/// no-overwrite guard.
#[tokio::test]
async fn rename_handles_case_only_difference() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("Photo.jpg");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("photo.jpg");

    let strategy = RenameStrategy::new(Arc::new(Blake3Hasher));
    strategy.move_file(&from, &to).await.unwrap();

    assert_eq!(std::fs::read(&to).unwrap(), b"hello");

    let entries: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        entries,
        vec!["photo.jpg".to_string()],
        "the file must end up under its new casing, and only once"
    );
}

/// CRITICAL regression test: on a case-*sensitive* volume, two files
/// that differ only by letter case are genuinely different files.
/// Renaming one onto the other's name must be refused, not silently
/// overwrite it — this is exactly the scenario a naive
/// lowercase-string-comparison "is this a case-only rename?" shortcut
/// gets wrong (it can't distinguish "renaming a file to itself under a
/// new case" from "renaming a file onto a different file that happens
/// to share a case-insensitive name").
#[tokio::test]
async fn rename_refuses_to_clobber_distinct_case_variant_files_on_case_sensitive_volume() {
    let Some(image) = DiskImage::create("Case-sensitive APFS", "dp_test_case_sensitive") else {
        missing_disk_image("could not create/attach a case-sensitive APFS disk image via hdiutil");
        return;
    };

    let from = image.path().join("Photo.jpg");
    let to = image.path().join("photo.jpg");
    std::fs::write(&from, b"AAA").unwrap();
    std::fs::write(&to, b"BBB").unwrap();

    let strategy = RenameStrategy::new(Arc::new(Blake3Hasher));
    let err = strategy.move_file(&from, &to).await.unwrap_err();

    assert_eq!(err.to_string(), "destination exists");
    assert_eq!(std::fs::read(&from).unwrap(), b"AAA", "source must be untouched");
    assert_eq!(
        std::fs::read(&to).unwrap(),
        b"BBB",
        "the distinct file must not be clobbered"
    );
}

/// HIGH regression test: `renamex_np`'s `RENAME_EXCL` isn't supported at
/// all on exFAT (confirmed empirically: it returns `ENOTSUP` even for a
/// completely free destination), which used to make every rename onto
/// an exFAT-formatted archive volume fail outright. `RenameStrategy`
/// must fall back to a working (if non-atomic) rename there.
#[tokio::test]
async fn rename_falls_back_on_exfat_volume() {
    let Some(image) = DiskImage::create("ExFAT", "dp_test_exfat") else {
        missing_disk_image("could not create/attach an ExFAT disk image via hdiutil");
        return;
    };

    let from = image.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = image.path().join("nested/dst.txt");

    let strategy = RenameStrategy::new(Arc::new(Blake3Hasher));
    strategy.move_file(&from, &to).await.unwrap();

    assert!(!from.exists());
    assert!(to.exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"hello");

    // The "destination exists" contract must still hold on the fallback
    // path, even though it can't be enforced atomically there.
    let from2 = image.path().join("src2.txt");
    std::fs::write(&from2, b"second").unwrap();
    let strategy2 = RenameStrategy::new(Arc::new(Blake3Hasher));
    let err = strategy2.move_file(&from2, &to).await.unwrap_err();
    assert_eq!(err.to_string(), "destination exists");
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

    let leftover: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        leftover,
        vec!["src.txt".to_string()],
        "the partial temp copy must be removed on mismatch, and the final path must never appear"
    );
}

#[tokio::test]
async fn copy_verify_delete_leaves_no_temp_file_on_success() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("dst.txt");

    let strategy = CopyVerifyDeleteStrategy {
        hasher: Arc::new(Blake3Hasher),
    };
    strategy.move_file(&from, &to).await.unwrap();

    assert!(!from.exists());
    assert!(to.exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"hello");

    let leftover: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        leftover,
        vec!["dst.txt".to_string()],
        "no partial temp file should remain after a successful move"
    );
}

/// A copy interrupted partway through (a crash, a yanked drive) used to
/// leave a `dst.txt.drophoto-partial` file that `create_new` would then
/// refuse to overwrite — permanently blocking every retry of that one
/// photo. The temp name is now unique per attempt, and any corpse from
/// a previous attempt is swept away first.
#[tokio::test]
async fn copy_verify_delete_recovers_from_a_stale_partial_copy() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("dst.txt");

    // Exactly what an interrupted earlier attempt left behind, under
    // the old fixed name.
    let stale = dir.path().join("dst.txt.drophoto-partial");
    std::fs::write(&stale, b"half-written gar").unwrap();

    let strategy = CopyVerifyDeleteStrategy {
        hasher: Arc::new(Blake3Hasher),
    };
    strategy.move_file(&from, &to).await.unwrap();

    assert!(!from.exists());
    assert_eq!(std::fs::read(&to).unwrap(), b"hello");
    assert!(!stale.exists(), "the stale partial copy must be swept away");

    let leftover: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(leftover, vec!["dst.txt".to_string()]);
}

/// The sweep is scoped to the destination being written: a partial copy
/// staged for a *different* target (and a real photo that merely shares
/// a prefix) must survive untouched.
#[tokio::test]
async fn copy_verify_delete_only_sweeps_partials_for_its_own_destination() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("src.txt");
    std::fs::write(&from, b"hello").unwrap();
    let to = dir.path().join("dst.txt");

    let other_partial = dir.path().join("other.txt.drophoto-partial-1-2");
    std::fs::write(&other_partial, b"someone else's").unwrap();

    let strategy = CopyVerifyDeleteStrategy {
        hasher: Arc::new(Blake3Hasher),
    };
    strategy.move_file(&from, &to).await.unwrap();

    assert_eq!(std::fs::read(&to).unwrap(), b"hello");
    assert_eq!(
        std::fs::read(&other_partial).unwrap(),
        b"someone else's",
        "another destination's partial copy must not be swept"
    );
}
