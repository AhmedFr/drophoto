//! Safety deny-list: paths a scan or destination picker should never touch,
//! even if the user (accidentally) points drophoto at them. All matching is
//! case-insensitive, since the target filesystem (APFS/HFS+) commonly is.

use std::path::{Component, Path, PathBuf};

/// Top-level names that, as the *first* component of an absolute path
/// (i.e. `/System`, `/Library`, ...), deny that path and everything under
/// it.
const ABS_PREFIX_NAMES: &[&str] = &[
    "system",
    "library",
    "applications",
    "usr",
    "bin",
    "sbin",
    "private",
    "opt",
    "cores",
];

/// Directory names that are denied no matter where they appear in a path
/// (case-insensitive). Dot-prefixed housekeeping directories such as
/// `.git`, `.Trashes`, `.Spotlight-V100`, and `.fseventsd` are *not*
/// listed explicitly here because they're already caught by the
/// leading-`.` (hidden) rule in [`is_denied_name`].
const DENIED_NAMES_ANYWHERE: &[&str] = &[
    "node_modules",
    "$recycle.bin",
    "system volume information",
    "caches",
];

/// Package/bundle directory suffixes that are denied wherever they occur
/// (e.g. `Foo.app`, `My Trip.photoslibrary`).
const PACKAGE_SUFFIXES: &[&str] = &[
    ".app",
    ".photoslibrary",
    ".aplibrary",
    ".lrcat",
    ".lrdata",
    ".framework",
    ".bundle",
];

/// Whether a single path component `name` is denied on its own merits:
/// hidden (leading `.`), one of the fixed housekeeping directory names, or
/// a package/bundle suffix. Case-insensitive.
///
/// This does *not* account for context-dependent rules (absolute system
/// prefixes, `$HOME/Library`, `<mount>/System`) — those need the full path
/// and are handled by [`is_denied_path`].
pub fn is_denied_name(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    if DENIED_NAMES_ANYWHERE.contains(&lower.as_str()) {
        return true;
    }
    PACKAGE_SUFFIXES.iter().any(|suf| lower.ends_with(suf))
}

/// Whether `abs`'s first path component (right after the root) is one of
/// the fixed system prefixes (`/System`, `/Library`, `/Applications`,
/// `/usr`, `/bin`, `/sbin`, `/private`, `/opt`, `/cores`).
fn is_under_absolute_system_prefix(abs: &Path) -> bool {
    let mut comps = abs.components();
    if !matches!(comps.next(), Some(Component::RootDir)) {
        return false;
    }
    match comps.next() {
        Some(Component::Normal(first)) => {
            let name = first.to_string_lossy().to_ascii_lowercase();
            ABS_PREFIX_NAMES.contains(&name.as_str())
        }
        _ => false,
    }
}

/// Whether `abs` is (or is under) `<mount>/System`, where `<mount>` is an
/// externally-mounted volume under `/Volumes/<name>` (the macOS
/// convention). `/System` at the filesystem root is already covered by
/// [`is_under_absolute_system_prefix`].
fn is_under_mount_system(abs: &Path) -> bool {
    let names: Vec<String> = abs
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_ascii_lowercase()),
            _ => None,
        })
        .collect();
    names.len() >= 3 && names[0] == "volumes" && names[2] == "system"
}

/// Whether `abs` is `home/Library` or something under it.
fn is_under_home_library(abs: &Path, home: &Path) -> bool {
    let lib = home.join("Library");
    let abs_lower: Vec<String> = abs
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    let lib_lower: Vec<String> = lib
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    abs_lower.len() >= lib_lower.len() && abs_lower[..lib_lower.len()] == lib_lower[..]
}

/// Whether `abs` is (or is under) `/Users/<name>/Library` for *any* user —
/// not just the caller-supplied `home` — since a scan can stumble onto
/// another account's home directory (e.g. `/Users/Shared/../otheruser`) as
/// easily as the current user's.
fn is_under_any_users_library(abs: &Path) -> bool {
    let names: Vec<String> = abs
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_ascii_lowercase()),
            _ => None,
        })
        .collect();
    names.len() >= 3 && names[0] == "users" && names[2] == "library"
}

/// Whether `abs` (a file or a directory) falls under drophoto's safety
/// deny-list: fixed absolute system prefixes, `<mount>/System`,
/// `/Users/<name>/Library` (for any user), `home/Library` (when `home` is
/// known), or any ancestor component whose name is itself denied
/// ([`is_denied_name`]) — housekeeping directories, hidden entries, and
/// app/library package bundles.
///
/// **Fails closed**: a non-absolute path is denied outright (relative
/// paths can't be checked against the absolute rules above, and treating
/// them as safe would be a silent bypass), as is any path containing a
/// `..` (`ParentDir`) component (it could walk back out of an
/// already-approved subtree into a denied one, e.g.
/// `/Users/me/Pictures/../../../System`). Callers are expected to hand in
/// a canonicalized, absolute path.
///
/// Checks every component of `abs`, so a file nested under a denied
/// ancestor (e.g. `Foo.app/Contents/x.jpg`) is denied too — including any
/// hidden (leading-`.`) *ancestor* directory anywhere above `abs`, not just
/// within whatever subtree a caller happens to be walking. That's correct
/// for real mounts (never hidden), but a trap for test fixtures built with
/// `tempfile::tempdir()`, whose default directory name is dot-prefixed.
pub fn is_denied_path(abs: &Path, home: Option<&Path>) -> bool {
    if !abs.is_absolute() {
        return true;
    }
    if abs.components().any(|c| matches!(c, Component::ParentDir)) {
        return true;
    }
    if is_under_absolute_system_prefix(abs) {
        return true;
    }
    if is_under_mount_system(abs) {
        return true;
    }
    if is_under_any_users_library(abs) {
        return true;
    }
    if let Some(home) = home {
        if is_under_home_library(abs, home) {
            return true;
        }
    }
    let mut ancestor = PathBuf::new();
    for comp in abs.components() {
        // `Prefix` (Windows drive letters, e.g. `C:`) never occurs on the
        // Unix targets this app runs on; skip it explicitly rather than
        // letting it fall through to the `Normal` check below.
        if matches!(comp, Component::Prefix(_)) {
            continue;
        }
        ancestor.push(comp);
        if let Component::Normal(name) = comp {
            if is_denied_name(&name.to_string_lossy()) {
                return true;
            }
        }
    }
    false
}

/// Alias for [`is_denied_path`], kept for readability at call sites that
/// are specifically walking directories (e.g. a `walkdir` `filter_entry`).
pub fn is_denied_dir(abs: &Path, home: Option<&Path>) -> bool {
    is_denied_path(abs, home)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_prefixes_are_denied() {
        for p in [
            "/System/Library/CoreServices",
            "/Library/Preferences",
            "/Applications/Foo.app",
            "/usr/local/bin",
            "/bin/sh",
            "/sbin/init",
            "/private/var/db",
            "/opt/homebrew",
            "/cores/core.1234",
        ] {
            assert!(is_denied_path(Path::new(p), None), "expected {p} denied");
        }
    }

    #[test]
    fn absolute_prefixes_are_case_insensitive() {
        assert!(is_denied_path(Path::new("/SYSTEM/Library"), None));
        assert!(is_denied_path(Path::new("/AppLications/Foo.app"), None));
    }

    #[test]
    fn sibling_of_denied_prefix_is_allowed() {
        // "Systemic" starts with "System" as a string but is a distinct
        // component name, so it must not be denied.
        assert!(!is_denied_path(Path::new("/Systemic/data"), None));
    }

    #[test]
    fn mount_system_is_denied() {
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/System/CoreServices"),
            None
        ));
        assert!(is_denied_path(Path::new("/Volumes/Backup/system"), None));
    }

    #[test]
    fn mount_non_system_top_level_dir_is_allowed() {
        assert!(!is_denied_path(Path::new("/Volumes/Backup/Pictures"), None));
    }

    #[test]
    fn home_library_is_denied() {
        let home = Path::new("/Users/ahmed");
        assert!(is_denied_path(&home.join("Library"), Some(home)));
        assert!(is_denied_path(&home.join("Library/Caches/x"), Some(home)));
    }

    #[test]
    fn home_library_is_case_insensitive() {
        let home = Path::new("/Users/ahmed");
        assert!(is_denied_path(Path::new("/Users/ahmed/LIBRARY/foo"), Some(home)));
    }

    #[test]
    fn home_pictures_is_allowed() {
        let home = Path::new("/Users/ahmed");
        assert!(!is_denied_path(&home.join("Pictures/img.jpg"), Some(home)));
    }

    #[test]
    fn without_home_library_rule_is_skipped() {
        // A non-/Users home (e.g. Linux-style) isn't caught by the
        // always-on "any /Users/<name>/Library" rule, so without `home`
        // supplied there's nothing left to deny it.
        assert!(!is_denied_path(Path::new("/home/ahmed/Library/x"), None));
    }

    #[test]
    fn directory_names_anywhere_are_denied() {
        for p in [
            "/Volumes/Backup/Work/node_modules/x.png",
            "/Volumes/Backup/$RECYCLE.BIN/x",
            "/Volumes/Backup/System Volume Information/x",
            "/Volumes/Backup/.git/x",
            "/Volumes/Backup/.Trashes/x",
            "/Volumes/Backup/.Spotlight-V100/x",
            "/Volumes/Backup/.fseventsd/x",
            "/Volumes/Backup/Library/Caches/a.jpg",
        ] {
            assert!(is_denied_path(Path::new(p), None), "expected {p} denied");
        }
    }

    #[test]
    fn hidden_directories_and_files_are_denied() {
        assert!(is_denied_path(Path::new("/Volumes/Backup/.hidden/b.jpg"), None));
        assert!(is_denied_path(Path::new("/Volumes/Backup/.dotfile.jpg"), None));
    }

    #[test]
    fn package_suffixes_deny_their_contents() {
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/Foo.app/Contents/x.jpg"),
            None
        ));
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/Trip.photoslibrary/data"),
            None
        ));
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/Trip.aplibrary/data"),
            None
        ));
        assert!(is_denied_path(Path::new("/Volumes/Backup/Catalog.lrcat"), None));
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/Catalog.lrdata/x"),
            None
        ));
        assert!(is_denied_path(Path::new("/Volumes/Backup/Foo.framework/x"), None));
        assert!(is_denied_path(Path::new("/Volumes/Backup/Foo.bundle/x"), None));
    }

    #[test]
    fn package_suffixes_are_case_insensitive() {
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/Foo.APP/Contents/x.jpg"),
            None
        ));
    }

    #[test]
    fn plain_folders_like_pictures_are_allowed() {
        assert!(!is_denied_path(
            Path::new("/Volumes/Backup/Pictures/img.jpg"),
            None
        ));
        assert!(!is_denied_path(
            Path::new("/Volumes/Backup/DCIM/100APPLE/img.jpg"),
            None
        ));
    }

    #[test]
    fn is_denied_dir_is_an_alias_for_is_denied_path() {
        let home = Path::new("/Users/ahmed");
        for p in [
            "/System/Library",
            "/Volumes/Backup/Pictures",
            "/Users/ahmed/Library",
        ] {
            assert_eq!(
                is_denied_dir(Path::new(p), Some(home)),
                is_denied_path(Path::new(p), Some(home))
            );
        }
    }

    #[test]
    fn relative_paths_fail_closed() {
        assert!(is_denied_path(Path::new("Library/Preferences"), None));
        assert!(is_denied_path(Path::new("Pictures/img.jpg"), None));
    }

    #[test]
    fn parent_dir_components_fail_closed() {
        assert!(is_denied_path(
            Path::new("/Users/me/Pictures/../../../System/x"),
            None
        ));
        // Even one that "resolves" to somewhere harmless must still be
        // denied — the point is refusing to reason about `..` at all.
        assert!(is_denied_path(
            Path::new("/Volumes/Backup/Pics/../Pics/x.jpg"),
            None
        ));
    }

    #[test]
    fn any_users_library_is_denied_regardless_of_caller_home() {
        assert!(is_denied_path(Path::new("/Users/bob/Library/x"), None));
        assert!(is_denied_path(
            Path::new("/Users/bob/Library"),
            Some(Path::new("/Users/ahmed"))
        ));
        assert!(is_denied_path(Path::new("/USERS/bob/LIBRARY/x"), None));
    }

    #[test]
    fn users_non_library_top_level_dir_is_allowed() {
        assert!(!is_denied_path(Path::new("/Users/bob/Pictures/x.jpg"), None));
    }

    #[test]
    fn is_denied_name_covers_each_class_directly() {
        assert!(is_denied_name(".git"));
        assert!(is_denied_name("node_modules"));
        assert!(is_denied_name("$RECYCLE.BIN"));
        assert!(is_denied_name("System Volume Information"));
        assert!(is_denied_name(".Trashes"));
        assert!(is_denied_name(".Spotlight-V100"));
        assert!(is_denied_name(".fseventsd"));
        assert!(is_denied_name("Caches"));
        assert!(is_denied_name("Foo.app"));
        assert!(!is_denied_name("Pictures"));
        assert!(!is_denied_name("DCIM"));
    }
}
