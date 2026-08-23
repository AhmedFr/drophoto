//! The pure organize planner: turns a set of media rows into a list of
//! planned moves, without touching the filesystem or the catalog.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use dp_core::{DpError, DpResult, MediaRow, OrganizePlanItem, OrganizeRule, PlanStatus};

use crate::template::{NamingTemplate, TemplateVars};

/// Hard cap on how many `_n` suffixes we'll try before giving up on a
/// name. Guards against ever looping forever when a collision can't be
/// resolved (it always can be, in practice, well before this).
const MAX_SUFFIX: usize = 10_000;

/// Everything the planner needs to compute a plan for one drive's
/// organize rule.
pub struct PlanInput<'a> {
    pub rule: &'a OrganizeRule,
    pub rows: &'a [MediaRow],
    /// Hashes already present among organized media — matching rows are
    /// skipped as duplicates rather than moved again.
    pub organized_hashes: &'a HashSet<String>,
    /// Relative paths already present on disk/catalog under `rule.root`,
    /// used for collision detection alongside paths planned earlier in
    /// this same run.
    ///
    /// This must include the *current* rel_path of every file that
    /// already occupies space under `rule.root` but isn't itself present
    /// in `rows` — most notably, media that's already organized and
    /// therefore isn't being (re-)planned in this call. The planner only
    /// learns a row's own current path automatically when that row is
    /// included in `rows` (and turns out to be skipped, as a duplicate or
    /// as already-in-place); the current paths of rows the caller leaves
    /// out of `rows` entirely must be supplied here, or a newly-planned
    /// file could collide with one of them without the planner ever
    /// noticing.
    pub existing_paths: &'a HashSet<String>,
    /// When set, a row with no [`MediaRow::source_id`] — scanned before
    /// sources existed, or otherwise unattributed — is never planned for
    /// a move: it's recorded `SkippedCollision` with reason "not covered
    /// by a source" instead. This is the planner's half of organize
    /// safety: only files scanned under a confirmed, user-visible source
    /// are ever candidates for being moved.
    pub require_source: bool,
    pub now: DateTime<Utc>,
}

/// A row's rendered folder/file/ext, before any collision suffix is
/// applied.
struct Candidate {
    folder: String,
    file: String,
    ext: String,
}

/// The per-row-independent context [`plan_unit`] and [`find_group_suffix`]
/// need, bundled so `plan()` doesn't have to thread half of [`PlanInput`]
/// through as separate arguments.
struct PlanCtx<'a> {
    rule: &'a OrganizeRule,
    rows: &'a [MediaRow],
    candidates: &'a [Candidate],
    organized_hashes: &'a HashSet<String>,
    require_source: bool,
}

/// Computes an organize plan for `input.rows`, in input order.
///
/// Date resolution per row: `taken_at`, falling back to `mtime(row)`,
/// falling back to `input.now`. When `rule.keep_pairs` is set, rows that
/// share a parent directory and a (case-insensitive) filename stem are
/// grouped and use the earliest date among the group, so they land in
/// the same folder with the same file stem.
pub fn plan(
    input: &PlanInput,
    tpl: &dyn NamingTemplate,
    mtime: &dyn Fn(&MediaRow) -> Option<DateTime<Utc>>,
) -> DpResult<Vec<OrganizePlanItem>> {
    let rule = input.rule;
    let rows = input.rows;

    let own_dates: Vec<DateTime<Utc>> = rows
        .iter()
        .map(|row| row.taken_at.or_else(|| mtime(row)).unwrap_or(input.now))
        .collect();

    let effective_dates = if rule.keep_pairs {
        group_min_dates(rows, &own_dates)?
    } else {
        own_dates
    };

    let mut candidates = Vec::with_capacity(rows.len());
    for (row, date) in rows.iter().zip(effective_dates.iter()) {
        let vars = TemplateVars {
            taken: *date,
            stem: row_stem(row),
            ext: row.ext.to_ascii_lowercase(),
        };
        let folder = tpl.render(&rule.folder_tpl, &vars)?;
        let file = tpl.render(&rule.file_tpl, &vars)?;
        candidates.push(Candidate {
            folder,
            file,
            ext: vars.ext,
        });
    }

    let units: Vec<Vec<usize>> = if rule.keep_pairs {
        group_indices(rows)
    } else {
        (0..rows.len()).map(|i| vec![i]).collect()
    };

    let mut results: Vec<Option<OrganizePlanItem>> = (0..rows.len()).map(|_| None).collect();
    let mut taken: HashSet<String> = input.existing_paths.iter().map(|p| p.to_lowercase()).collect();

    let ctx = PlanCtx {
        rule,
        rows,
        candidates: &candidates,
        organized_hashes: input.organized_hashes,
        require_source: input.require_source,
    };

    for unit in units {
        plan_unit(&ctx, &unit, &mut taken, &mut results)?;
    }

    results
        .into_iter()
        .enumerate()
        .map(|(i, item)| {
            item.ok_or_else(|| DpError::Db {
                message: format!("planner failed to assign a plan item for row index {i}"),
            })
        })
        .collect()
}

/// Plans one collision unit (a single row, or a keep_pairs group), and
/// writes the resulting items into `results` at their original indices.
fn plan_unit(
    ctx: &PlanCtx,
    unit: &[usize],
    taken: &mut HashSet<String>,
    results: &mut [Option<OrganizePlanItem>],
) -> DpResult<()> {
    let PlanCtx {
        rule,
        rows,
        candidates,
        organized_hashes,
        require_source,
    } = *ctx;
    let mut movable: Vec<usize> = Vec::new();

    for &idx in unit {
        let row = &rows[idx];

        if require_source && row.source_id.is_none() {
            results[idx] = Some(OrganizePlanItem {
                media_id: row.id,
                old_rel_path: row.rel_path.clone(),
                new_rel_path: row.rel_path.clone(),
                status: PlanStatus::SkippedCollision,
                reason: Some("not covered by a source".into()),
            });
            taken.insert(row.rel_path.to_lowercase());
            continue;
        }

        if organized_hashes.contains(&row.hash) {
            results[idx] = Some(OrganizePlanItem {
                media_id: row.id,
                old_rel_path: row.rel_path.clone(),
                new_rel_path: row.rel_path.clone(),
                status: PlanStatus::SkippedDup,
                reason: Some(format!("duplicate of hash {}", row.hash)),
            });
            taken.insert(row.rel_path.to_lowercase());
            continue;
        }

        let candidate_path = build_path(
            &rule.root,
            &candidates[idx].folder,
            &candidates[idx].file,
            &candidates[idx].ext,
        );

        // Case-insensitive: macOS's default filesystem is case-insensitive,
        // so a candidate that differs from the current path only by case
        // is already "in place" for our purposes.
        if candidate_path.to_lowercase() == row.rel_path.to_lowercase() {
            results[idx] = Some(OrganizePlanItem {
                media_id: row.id,
                old_rel_path: row.rel_path.clone(),
                new_rel_path: row.rel_path.clone(),
                status: PlanStatus::SkippedCollision,
                reason: Some("already in place".into()),
            });
            taken.insert(row.rel_path.to_lowercase());
            continue;
        }

        movable.push(idx);
    }

    if movable.is_empty() {
        return Ok(());
    }

    // A collision suffix applies to the whole unit together (so a kept
    // pair moves in lockstep): find the smallest suffix at which none of
    // the unit's members collide with anything already taken.
    let group_suffix = find_group_suffix(rule, rows, candidates, &movable, taken)?;

    // Within that shared baseline, commit members one at a time. This
    // naturally — and, crucially, *terminatingly* — disambiguates the
    // rare case where two members of the same unit produce identical (or
    // case-insensitively identical) candidates: the second member sees
    // the first's freshly-committed path in `taken` and keeps bumping its
    // own suffix until it finds a free one, rather than both members
    // forever bumping the same shared suffix in lockstep.
    for &idx in &movable {
        let row = &rows[idx];
        let mut n = group_suffix;
        loop {
            if n > MAX_SUFFIX {
                return Err(DpError::Unsupported {
                    message: format!("could not find a free name for media {}", row.id),
                    path: None,
                });
            }
            let file = suffixed_file(&candidates[idx].file, n);
            let path = build_path(&rule.root, &candidates[idx].folder, &file, &candidates[idx].ext);
            let lowered = path.to_lowercase();
            if !taken.contains(&lowered) {
                taken.insert(lowered);
                results[idx] = Some(OrganizePlanItem {
                    media_id: row.id,
                    old_rel_path: row.rel_path.clone(),
                    new_rel_path: path,
                    status: PlanStatus::Planned,
                    reason: None,
                });
                break;
            }
            n += 1;
        }
    }

    Ok(())
}

/// The smallest suffix `n` such that none of `movable`'s candidates at
/// that suffix collide with `taken`. Only considers external collisions
/// — members colliding with *each other* are resolved afterwards, per
/// member, by the caller.
fn find_group_suffix(
    rule: &OrganizeRule,
    rows: &[MediaRow],
    candidates: &[Candidate],
    movable: &[usize],
    taken: &HashSet<String>,
) -> DpResult<usize> {
    let mut n = 0usize;
    loop {
        if n > MAX_SUFFIX {
            let media_ids: Vec<i64> = movable.iter().map(|&idx| rows[idx].id).collect();
            return Err(DpError::Unsupported {
                message: format!("could not find a free name for media {media_ids:?}"),
                path: None,
            });
        }
        let all_free = movable.iter().all(|&idx| {
            let file = suffixed_file(&candidates[idx].file, n);
            let path = build_path(&rule.root, &candidates[idx].folder, &file, &candidates[idx].ext);
            !taken.contains(&path.to_lowercase())
        });
        if all_free {
            return Ok(n);
        }
        n += 1;
    }
}

fn suffixed_file(file: &str, n: usize) -> String {
    if n == 0 {
        file.to_string()
    } else {
        format!("{file}_{n}")
    }
}

fn build_path(root: &str, folder: &str, file: &str, ext: &str) -> String {
    format!("{root}/{folder}/{file}.{ext}")
}

/// The filename stem (without extension), preserving original case.
fn row_stem(row: &MediaRow) -> String {
    Path::new(&row.rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The (parent dir, lowercase stem) key used to group `keep_pairs` rows.
fn row_group_key(row: &MediaRow) -> (String, String) {
    let path = Path::new(&row.rel_path);
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    (parent, stem)
}

/// For each row, the earliest `own_dates` value among all rows sharing
/// its group key.
fn group_min_dates(rows: &[MediaRow], own_dates: &[DateTime<Utc>]) -> DpResult<Vec<DateTime<Utc>>> {
    let mut group_min: HashMap<(String, String), DateTime<Utc>> = HashMap::new();
    for (row, date) in rows.iter().zip(own_dates.iter()) {
        let key = row_group_key(row);
        group_min
            .entry(key)
            .and_modify(|d| {
                if date < d {
                    *d = *date;
                }
            })
            .or_insert(*date);
    }

    rows.iter()
        .map(|row| {
            let key = row_group_key(row);
            group_min.get(&key).copied().ok_or_else(|| DpError::Db {
                message: "planner group lookup failed unexpectedly".into(),
            })
        })
        .collect()
}

/// Groups row indices by [`row_group_key`], preserving the order each
/// group is first encountered in.
fn group_indices(rows: &[MediaRow]) -> Vec<Vec<usize>> {
    let mut index_of_group: HashMap<(String, String), usize> = HashMap::new();
    let mut groups: Vec<Vec<usize>> = Vec::new();

    for (i, row) in rows.iter().enumerate() {
        let key = row_group_key(row);
        match index_of_group.get(&key) {
            Some(&gi) => groups[gi].push(i),
            None => {
                index_of_group.insert(key, groups.len());
                groups.push(vec![i]);
            }
        }
    }

    groups
}
