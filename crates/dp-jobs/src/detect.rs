//! Shallow media-folder detection: walks a mount looking for folders worth
//! offering as an import source, skipping anything on the safety
//! deny-list ([`dp_core::denylist`]).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use dp_core::denylist::is_denied_path;
use dp_core::{DetectedFolder, DpResult, MediaKind};
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

/// A folder is rolled up into an ancestor once that ancestor's subtree
/// holds at least this many media files.
const AGGREGATE_THRESHOLD: u64 = 20;

/// rel_path (case-insensitive) values that are always suggested,
/// regardless of media count.
const SUGGESTED_NAMES: &[&str] = &["dcim", "pictures", "desktop", "downloads"];

/// Walks `mount` (up to `max_depth` levels deep), skipping anything on the
/// safety deny-list, and returns the folders worth offering as import
/// sources: folders that directly contain media are rolled up into the
/// shallowest ancestor whose subtree holds >= 20 media files, and reported
/// individually otherwise. Sorted by `media_count` descending, then path.
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
    cancel: &CancellationToken,
) -> DpResult<Vec<DetectedFolder>> {
    let home = std::env::var_os("HOME").map(PathBuf::from);

    // Media file count/bytes directly inside each directory (not
    // including subdirectories).
    let mut direct: HashMap<PathBuf, (u64, u64)> = HashMap::new();

    let walker = WalkDir::new(mount)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !is_denied_path(e.path(), home.as_deref()));

    for entry in walker {
        if cancel.is_cancelled() {
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if MediaKind::from_ext(ext).is_none() {
            continue;
        }
        let Some(dir) = path.parent() else { continue };
        let entry = direct.entry(dir.to_path_buf()).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += meta.len();
    }

    Ok(roll_up(mount, direct))
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

/// Rolls per-directory direct counts up into shallowest-qualifying
/// ancestors and produces the final, sorted [`DetectedFolder`] list. See
/// module docs / task brief for the aggregation rule.
fn roll_up(mount: &Path, direct: HashMap<PathBuf, (u64, u64)>) -> Vec<DetectedFolder> {
    // subtree[d] = sum of direct[] for d and every descendant directory
    // that holds media. Built by, for each directory with direct media,
    // adding its counts into every one of its ancestors (mount included).
    let mut subtree: HashMap<PathBuf, (u64, u64)> = HashMap::new();
    for (dir, &(count, bytes)) in &direct {
        let mut ancestor = PathBuf::new();
        for comp in dir.components() {
            ancestor.push(comp);
            let entry = subtree.entry(ancestor.clone()).or_insert((0, 0));
            entry.0 += count;
            entry.1 += bytes;
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
            let (c, b) = direct[dir];
            reported.insert(String::new(), (c, b));
            continue;
        }

        let mut target: Option<PathBuf> = None;
        for d in 1..=depth {
            let ancestor = ancestor_at_depth(dir, mount, d);
            if let Some(&(count, _)) = subtree.get(&ancestor) {
                if count >= AGGREGATE_THRESHOLD {
                    target = Some(ancestor);
                    break;
                }
            }
        }

        match target {
            Some(ancestor) => {
                let (c, b) = subtree[&ancestor];
                reported.insert(rel_path_string(&ancestor, mount), (c, b));
            }
            None => {
                let (c, b) = direct[dir];
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
