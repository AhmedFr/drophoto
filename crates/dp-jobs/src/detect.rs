//! Shallow media-folder detection: walks a mount looking for folders worth
//! offering as an import source, skipping anything on the safety
//! deny-list ([`dp_core::denylist`]).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use dp_core::denylist::{is_denied_name, is_denied_path};
use dp_core::{DetectedFolder, DpError, DpResult, MediaKind};
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

/// A folder is rolled up into an ancestor once that ancestor's subtree
/// holds at least this many media files.
const AGGREGATE_THRESHOLD: u64 = 20;

/// rel_path (case-insensitive) values that are always suggested,
/// regardless of media count.
const SUGGESTED_NAMES: &[&str] = &["dcim", "pictures", "desktop", "downloads"];

/// Folder names that act as rollup boundaries: aggregation never picks a
/// target shallower than one of these, so e.g. a `Pictures` folder is
/// always reported as itself (or rolled up no further than itself), never
/// silently absorbed into some ancestor above it. Case-insensitive.
const ROLLUP_BOUNDARY_NAMES: &[&str] = &["pictures", "desktop", "downloads", "dcim", "photos", "camera"];

/// Walks `mount` (up to `max_depth` levels deep), skipping anything on the
/// safety deny-list, and returns the folders worth offering as import
/// sources: folders that directly contain media are rolled up into the
/// shallowest ancestor whose subtree holds >= 20 media files, and reported
/// individually otherwise. `bytes` on each result is the sum of
/// `symlink_metadata().len()` for every media file counted toward it.
/// Sorted by `media_count` descending, then path.
///
/// `mount` is canonicalized before walking (failure -> `DpError::Io`), both
/// to resolve symlinks consistently and so the deny-list's `..`-rejection
/// can't be bypassed by a non-canonical starting point.
///
/// `home` is the caller's resolved `$HOME` (or `None` if it couldn't be
/// determined), used for the `home/Library` deny rule; resolving it from
/// the environment is the caller's job (e.g. the command layer, which
/// should `tracing::warn!` when it's absent).
///
/// Synchronous — callers running inside an async context should wrap this
/// in `spawn_blocking`, as [`crate::scan`]'s walk does.
///
/// If `cancel` is triggered mid-walk, returns `Ok` with whatever was
/// counted before the walk stopped (no partial-result flag; callers that
/// care use a timeout on top of this).
pub fn detect_folders(
    mount: &Path,
    max_depth: usize,
    home: Option<&Path>,
    cancel: &CancellationToken,
) -> DpResult<Vec<DetectedFolder>> {
    let mount = std::fs::canonicalize(mount).map_err(|e| DpError::Io {
        message: format!("failed to canonicalize mount path: {e}"),
        path: Some(mount.display().to_string()),
    })?;

    // Media file count/bytes directly inside each directory (not
    // including subdirectories).
    let mut direct: HashMap<PathBuf, (u64, u64)> = HashMap::new();

    let walker = WalkDir::new(&mount)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            // Fast, entry-local checks first — these cover the vast
            // majority of denied directories (hidden, housekeeping names,
            // package suffixes, and the common "external volume mounted
            // at an arbitrary path, with its own System folder" case)
            // without re-walking every ancestor component back to the
            // filesystem root for each entry.
            if is_denied_name(&name) {
                return false;
            }
            if e.depth() == 1 && name.eq_ignore_ascii_case("System") {
                return false;
            }
            // Remaining rules (absolute system prefixes, `/Users/*/Library`,
            // `home/Library`, `/Volumes/*/System`) need full-path context.
            !is_denied_path(e.path(), home)
        });

    for entry in walker {
        if cancel.is_cancelled() {
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        // Check the entry's type before doing any stat work below.
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if MediaKind::from_ext(ext).is_none() {
            continue;
        }
        // Only a regular file counts — re-stat via `symlink_metadata` (not
        // `entry.metadata()`, which under `follow_links(false)` already
        // reports symlink type, but we want an explicit, cheap-to-audit
        // guard here) and skip anything that fails to stat or isn't a
        // plain file.
        let Ok(meta) = std::fs::symlink_metadata(path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Some(dir) = path.parent() else { continue };
        let slot = direct.entry(dir.to_path_buf()).or_insert((0, 0));
        slot.0 += 1;
        slot.1 += meta.len();
    }

    Ok(roll_up(&mount, direct))
}

/// Depth of `path` relative to `mount` (number of path components below
/// `mount`); `mount` itself is depth 0.
fn rel_depth(path: &Path, mount: &Path) -> usize {
    path.strip_prefix(mount)
        .map(|r| r.components().count())
        .unwrap_or(0)
}

/// `path` truncated to `depth` components below `mount` (depth 0 == `mount`
/// itself).
fn ancestor_at_depth(path: &Path, mount: &Path, depth: usize) -> PathBuf {
    let Ok(rel) = path.strip_prefix(mount) else {
        return path.to_path_buf();
    };
    let mut out = mount.to_path_buf();
    for comp in rel.components().take(depth) {
        out.push(comp);
    }
    out
}

/// `path` relative to `mount`, forward-slash joined; `""` for `mount`
/// itself.
fn rel_path_string(path: &Path, mount: &Path) -> String {
    let Ok(rel) = path.strip_prefix(mount) else {
        return String::new();
    };
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The shallowest depth (relative to `mount`, 1-based) that aggregation is
/// allowed to consider for `dir`: the depth of the deepest "rollup
/// boundary" among `dir`'s ancestors (inclusive of `dir` itself), or `1`
/// if none of them are boundaries.
///
/// A boundary is either a [`ROLLUP_BOUNDARY_NAMES`] folder (`Pictures`,
/// `DCIM`, ...) or a `Users/<name>` directory (depth 2, directly under a
/// top-level `Users` folder) — both represent "obviously a specific,
/// meaningful folder" that a shallower ancestor should never silently
/// swallow.
fn boundary_min_depth(dir: &Path, mount: &Path) -> usize {
    let Ok(rel) = dir.strip_prefix(mount) else {
        return 1;
    };
    let names: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();

    let mut min_depth = 1usize;
    for (i, name) in names.iter().enumerate() {
        let depth = i + 1;
        let is_well_known = ROLLUP_BOUNDARY_NAMES.contains(&name.as_str());
        let is_users_child = depth == 2 && names[0] == "users";
        if is_well_known || is_users_child {
            min_depth = min_depth.max(depth);
        }
    }
    min_depth
}

/// Rolls per-directory direct counts up into shallowest-qualifying
/// ancestors and produces the final, sorted [`DetectedFolder`] list. See
/// module docs / task brief for the aggregation rule.
fn roll_up(mount: &Path, direct: HashMap<PathBuf, (u64, u64)>) -> Vec<DetectedFolder> {
    // subtree[a] = sum of direct[] for every directory `d` such that `a`
    // is an ancestor of (or equal to) `d`, *and* `a`'s depth is not
    // shallower than `d`'s own rollup boundary — i.e. a boundary directory
    // never contributes its count to an ancestor above the boundary. This
    // is what makes e.g. `Users/alice/Pictures` un-absorbable into
    // `Users/alice` or `Users`.
    let mut subtree: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    for (dir, &(count, bytes)) in &direct {
        let depth = rel_depth(dir, mount);
        if depth == 0 {
            continue;
        }
        let min_depth = boundary_min_depth(dir, mount);
        for d in min_depth..=depth {
            let ancestor = ancestor_at_depth(dir, mount, d);
            let slot = subtree.entry(ancestor).or_insert((0, 0));
            slot.0 += count;
            slot.1 += bytes;
        }
    }

    let total_media: u64 = direct.values().map(|&(c, _)| c).sum();

    // rel_path -> (media_count, bytes); keyed by rel_path string (rather
    // than PathBuf) purely so the root ("") and named folders share one
    // map cleanly.
    let mut reported: HashMap<String, (u64, u64)> = HashMap::new();

    for dir in direct.keys() {
        let depth = rel_depth(dir, mount);
        if depth == 0 {
            // Mount root itself: always reported individually, at its own
            // direct count — never an aggregation target.
            let (c, b) = direct.get(dir).copied().unwrap_or_default();
            reported.insert(String::new(), (c, b));
            continue;
        }

        let min_depth = boundary_min_depth(dir, mount);
        let mut target: Option<(PathBuf, u64, u64)> = None;
        for d in min_depth..=depth {
            let ancestor = ancestor_at_depth(dir, mount, d);
            if let Some(&(count, bytes)) = subtree.get(&ancestor) {
                if count >= AGGREGATE_THRESHOLD {
                    target = Some((ancestor, count, bytes));
                    break;
                }
            }
        }

        match target {
            Some((ancestor, c, b)) => {
                reported.insert(rel_path_string(&ancestor, mount), (c, b));
            }
            None => {
                let (c, b) = direct.get(dir).copied().unwrap_or_default();
                reported.insert(rel_path_string(dir, mount), (c, b));
            }
        }
    }

    let root_suggested_ratio = {
        if total_media == 0 {
            0.0
        } else {
            let root_direct = direct.get(mount).map(|&(c, _)| c).unwrap_or(0);
            let dcim_like: u64 = subtree
                .iter()
                .filter(|(p, _)| rel_depth(p, mount) == 1)
                .filter(|(p, _)| {
                    p.file_name()
                        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("DCIM"))
                        .unwrap_or(false)
                })
                .map(|(_, &(c, _))| c)
                .sum();
            (root_direct + dcim_like) as f64 / total_media as f64
        }
    };

    let mount_is_fs_root = mount == Path::new("/");

    let mut folders: Vec<DetectedFolder> = reported
        .into_iter()
        .map(|(rel_path, (media_count, bytes))| {
            let suggested = if rel_path.is_empty() {
                !mount_is_fs_root && root_suggested_ratio >= 0.6
            } else {
                media_count >= AGGREGATE_THRESHOLD || is_suggested_name(&rel_path)
            };
            DetectedFolder {
                rel_path,
                media_count,
                bytes,
                suggested,
            }
        })
        .collect();

    folders.sort_by(|a, b| {
        b.media_count
            .cmp(&a.media_count)
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    folders
}

/// Whether `rel_path`'s last component is a well-known "obviously media"
/// folder name (`DCIM`, `Pictures`, `Desktop`, `Downloads`), matched
/// case-insensitively regardless of nesting (e.g. `Users/alice/Pictures`).
fn is_suggested_name(rel_path: &str) -> bool {
    rel_path
        .rsplit('/')
        .next()
        .map(|last| SUGGESTED_NAMES.iter().any(|n| last.eq_ignore_ascii_case(n)))
        .unwrap_or(false)
}
