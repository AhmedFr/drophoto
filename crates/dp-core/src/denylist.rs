//! Safety deny-list: paths a scan or destination picker should never touch,
//! even if the user (accidentally) points drophoto at them. All matching is
//! case-insensitive, since the target filesystem (APFS/HFS+) commonly is.

use std::path::{Component, Path};

/// Top-level names that, as the *first* path component **relative to a
/// given mount**, deny that subtree (e.g. `<mount>/System`,
/// `<mount>/Library`, ...).
///
/// This deliberately never looks at where `mount` itself sits in the real
/// filesystem — only at path components *below* it. See [`is_denied_path`]
/// for why.
const MOUNT_TOP_LEVEL_DENIED_NAMES: &[&str] = &[
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
/// This does *not* account for context-dependent rules (mount-relative
/// system prefixes, `home/Library`) — those need the full path and are
/// handled by [`is_denied_path`].
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

/// Whether `rel`'s first component is one of [`MOUNT_TOP_LEVEL_DENIED_NAMES`].
fn rel_first_component_is_denied_prefix(rel: &Path) -> bool {
    match rel.components().next() {
        Some(Component::Normal(first)) => {
            let name = first.to_string_lossy().to_ascii_lowercase();
            MOUNT_TOP_LEVEL_DENIED_NAMES.contains(&name.as_str())
        }
        _ => false,
    }
}

/// Whether `rel` (a path relative to some mount) starts with
/// `Users/<any-name>/Library` — for *any* user, not just the
/// caller-supplied `home`, since a scan can stumble onto another
/// account's home directory just as easily as the current user's.
fn rel_starts_with_any_users_library(rel: &Path) -> bool {
    let names: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_ascii_lowercase()),
            _ => None,
        })
        .collect();
    names.len() >= 3 && names[0] == "users" && names[2] == "library"
}

/// Whether `abs` is `home/Library` or something under it. Checked against
/// the real, absolute path (not mount-relative) since `home` identifies a
/// specific real filesystem location regardless of what's being scanned.
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

/// Whether `abs` (a file or directory reached while walking `mount`) falls
/// under drophoto's safety deny-list.
///
/// **System-prefix denials are mount-relative.** `abs` is checked against
/// `System`/`Library`/`Applications`/`usr`/`bin`/`sbin`/`private`/`opt`/`cores`
/// and the `Users/<name>/Library` pattern only via its path *relative to
/// `mount`* — never via `mount`'s own real (canonicalized) location. This
/// is deliberate: canonicalizing a mount can land it under `/private`
/// (e.g. any macOS temp directory, since both `/tmp` and `/var` are
/// themselves symlinks into `/private`), and an absolute-path check there
/// would then deny *every* entry on such a mount. The same mount-relative
/// scoping applies to [`is_denied_name`]'s hidden/anywhere-name/package
/// rule below: only components of `abs` *below* `mount` are checked, so a
/// hidden or otherwise-denied ancestor *above* `mount` (e.g. a
/// dot-prefixed temp-dir name) no longer matters.
///
/// `home` is checked against the real, absolute `home/Library` path (not
/// mount-relative) via [`is_under_home_library`], since it identifies a
/// specific real filesystem location regardless of what's being scanned.
///
/// **Fails closed**: `abs` must be absolute, must contain no `..`
/// (`ParentDir`) component, and must actually be under `mount` — anything
/// else is denied outright rather than risk misjudging it. Callers are
/// expected to hand in a canonicalized `mount`.
pub fn is_denied_path(abs: &Path, mount: &Path, home: Option<&Path>) -> bool {
    if !abs.is_absolute() {
        return true;
    }
    if abs.components().any(|c| matches!(c, Component::ParentDir)) {
        return true;
    }
    let Ok(rel) = abs.strip_prefix(mount) else {
        return true;
    };
    if rel_first_component_is_denied_prefix(rel) {
        return true;
    }
    if rel_starts_with_any_users_library(rel) {
        return true;
    }
    if let Some(home) = home {
        if is_under_home_library(abs, home) {
            return true;
        }
    }
    for comp in rel.components() {
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
pub fn is_denied_dir(abs: &Path, mount: &Path, home: Option<&Path>) -> bool {
    is_denied_path(abs, mount, home)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mount_relative_prefixes_are_denied() {
        let mount = Path::new("/Volumes/Backup");
        for name in [
            "System",
            "Library",
            "Applications",
            "usr",
            "bin",
            "sbin",
            "private",
            "opt",
            "cores",
        ] {
            let abs = mount.join(name).join("sub");
            assert!(is_denied_path(&abs, mount, None), "expected {abs:?} denied");
        }
    }

    #[test]
    fn mount_relative_prefixes_are_case_insensitive() {
        let mount = Path::new("/Volumes/Backup");
        assert!(is_denied_path(&mount.join("SYSTEM/Library"), mount, None));
        assert!(is_denied_path(&mount.join("AppLications/Foo.app"), mount, None));
    }

    #[test]
    fn sibling_of_denied_prefix_is_allowed() {
        // "Systemic" starts with "System" as a string but is a distinct
        // component name, so it must not be denied.
        let mount = Path::new("/Volumes/Backup");
        assert!(!is_denied_path(&mount.join("Systemic/data"), mount, None));
    }

    #[test]
    fn absolute_style_checks_still_work_with_a_root_mount() {
        // Scanning mount == "/" recovers the old "absolute prefix" checks,
        // since rel == abs minus the leading "/" in that case.
        let mount = Path::new("/");
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
            assert!(is_denied_path(Path::new(p), mount, None), "expected {p} denied");
        }
    }

    #[test]
    fn regression_a_mount_that_canonicalizes_under_private_is_not_wholesale_denied() {
        // The actual bug this fixes: on macOS, canonicalizing a temp-dir
        // mount (e.g. under /tmp or /var, both symlinks into /private)
        // lands it under /private — one of the mount-relative denied
        // names. Before this fix, checking `abs` against the *absolute*
        // filesystem root would deny every single entry under such a
        // mount. Mount-relative scoping means `mount` itself is never
        // checked against the prefix list — only what's below it.
        let mount = Path::new("/private/var/folders/xy/T/dp-detect-abc123");
        assert!(!is_denied_path(&mount.join("DCIM/img.jpg"), mount, None));
        assert!(!is_denied_path(&mount.join("Desktop/pic.jpg"), mount, None));
        assert!(!is_denied_path(&mount.join("Pictures/a.jpg"), mount, None));
    }

    #[test]
    fn hidden_or_denied_ancestors_above_mount_do_not_matter() {
        // A dot-prefixed mount name (tempfile::tempdir()'s default) used
        // to make everything under it look like it had a hidden ancestor.
        // Only components *below* mount are checked now.
        let mount = Path::new("/private/var/folders/xy/T/.tmpABC123");
        assert!(!is_denied_path(&mount.join("Pictures/img.jpg"), mount, None));
    }

    #[test]
    fn mount_relative_system_is_denied_for_any_mount_location() {
        // Not the /Volumes/<name> convention — proves the rule is purely
        // mount-relative, not tied to any particular real-path shape.
        let mount = Path::new("/some/arbitrary/place/my-mount");
        assert!(is_denied_path(&mount.join("System/CoreServices"), mount, None));
    }

    #[test]
    fn mount_non_system_top_level_dir_is_allowed() {
        let mount = Path::new("/Volumes/Backup");
        assert!(!is_denied_path(&mount.join("Pictures"), mount, None));
    }

    #[test]
    fn home_library_is_denied() {
        // Use a home that does *not* match the generic `Users/<name>/Library`
        // pattern, so only the home-specific rule is under test.
        let mount = Path::new("/Volumes/Backup");
        let home = mount.join("HomeStandIn");
        assert!(is_denied_path(&home.join("Library"), mount, Some(&home)));
        assert!(is_denied_path(&home.join("Library/Caches/x"), mount, Some(&home)));
    }

    #[test]
    fn home_library_is_case_insensitive() {
        let mount = Path::new("/Volumes/Backup");
        let home = mount.join("HomeStandIn");
        assert!(is_denied_path(
            &mount.join("HomeStandIn/LIBRARY/foo"),
            mount,
            Some(&home)
        ));
    }

    #[test]
    fn home_pictures_is_allowed() {
        let mount = Path::new("/Volumes/Backup");
        let home = mount.join("HomeStandIn");
        assert!(!is_denied_path(
            &home.join("Pictures/img.jpg"),
            mount,
            Some(&home)
        ));
    }

    #[test]
    fn without_home_supplied_the_home_specific_path_is_allowed() {
        let mount = Path::new("/Volumes/Backup");
        let home = mount.join("HomeStandIn");
        assert!(!is_denied_path(&home.join("Library/x"), mount, None));
    }

    #[test]
    fn directory_names_anywhere_are_denied() {
        let mount = Path::new("/Volumes/Backup");
        for rel in [
            "Work/node_modules/x.png",
            "$RECYCLE.BIN/x",
            "System Volume Information/x",
            ".git/x",
            ".Trashes/x",
            ".Spotlight-V100/x",
            ".fseventsd/x",
            "SomeApp/Caches/a.jpg",
        ] {
            let abs = mount.join(rel);
            assert!(is_denied_path(&abs, mount, None), "expected {abs:?} denied");
        }
    }

    #[test]
    fn hidden_directories_and_files_are_denied() {
        let mount = Path::new("/Volumes/Backup");
        assert!(is_denied_path(&mount.join(".hidden/b.jpg"), mount, None));
        assert!(is_denied_path(&mount.join(".dotfile.jpg"), mount, None));
    }

    #[test]
    fn package_suffixes_deny_their_contents() {
        let mount = Path::new("/Volumes/Backup");
        for rel in [
            "Foo.app/Contents/x.jpg",
            "Trip.photoslibrary/data",
            "Trip.aplibrary/data",
            "Catalog.lrcat",
            "Catalog.lrdata/x",
            "Foo.framework/x",
            "Foo.bundle/x",
        ] {
            let abs = mount.join(rel);
            assert!(is_denied_path(&abs, mount, None), "expected {abs:?} denied");
        }
    }

    #[test]
    fn package_suffixes_are_case_insensitive() {
        let mount = Path::new("/Volumes/Backup");
        assert!(is_denied_path(&mount.join("Foo.APP/Contents/x.jpg"), mount, None));
    }

    #[test]
    fn plain_folders_like_pictures_are_allowed() {
        let mount = Path::new("/Volumes/Backup");
        assert!(!is_denied_path(&mount.join("Pictures/img.jpg"), mount, None));
        assert!(!is_denied_path(&mount.join("DCIM/100APPLE/img.jpg"), mount, None));
    }

    #[test]
    fn is_denied_dir_is_an_alias_for_is_denied_path() {
        let mount = Path::new("/Volumes/Backup");
        let home = mount.join("HomeStandIn");
        for rel in ["System/Library", "Pictures", "HomeStandIn/Library"] {
            let abs = mount.join(rel);
            assert_eq!(
                is_denied_dir(&abs, mount, Some(&home)),
                is_denied_path(&abs, mount, Some(&home))
            );
        }
    }

    #[test]
    fn relative_paths_fail_closed() {
        let mount = Path::new("/Volumes/Backup");
        assert!(is_denied_path(Path::new("Library/Preferences"), mount, None));
        assert!(is_denied_path(Path::new("Pictures/img.jpg"), mount, None));
    }

    #[test]
    fn parent_dir_components_fail_closed() {
        assert!(is_denied_path(
            Path::new("/Users/me/Pictures/../../../System/x"),
            Path::new("/"),
            None
        ));
        // Even one that "resolves" to somewhere harmless must still be
        // denied — the point is refusing to reason about `..` at all.
        let mount = Path::new("/Volumes/Backup");
        assert!(is_denied_path(&mount.join("Pics/../Pics/x.jpg"), mount, None));
    }

    #[test]
    fn abs_outside_mount_fails_closed() {
        let mount = Path::new("/Volumes/Backup");
        assert!(is_denied_path(
            Path::new("/Volumes/Other/Pictures/x.jpg"),
            mount,
            None
        ));
    }

    #[test]
    fn any_users_library_is_denied_regardless_of_caller_home() {
        let mount = Path::new("/");
        assert!(is_denied_path(Path::new("/Users/bob/Library/x"), mount, None));
        assert!(is_denied_path(
            Path::new("/Users/bob/Library"),
            mount,
            Some(Path::new("/Users/ahmed"))
        ));
        assert!(is_denied_path(Path::new("/USERS/bob/LIBRARY/x"), mount, None));
    }

    #[test]
    fn users_non_library_top_level_dir_is_allowed() {
        assert!(!is_denied_path(
            Path::new("/Users/bob/Pictures/x.jpg"),
            Path::new("/"),
            None
        ));
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
