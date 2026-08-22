//! The pure organize planner: turns a set of media rows into a list of
//! planned moves, without touching the filesystem or the catalog.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use chrono::{DateTime, Utc};
use dp_core::{DpResult, MediaRow, OrganizePlanItem, OrganizeRule, PlanStatus};

use crate::template::{NamingTemplate, TemplateVars};

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
    pub existing_paths: &'a HashSet<String>,
    pub now: DateTime<Utc>,
}

/// A row's rendered folder/file/ext, before any collision suffix is
/// applied.
struct Candidate {
    folder: String,
    file: String,
    ext: String,
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
        group_min_dates(rows, &own_dates)
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

    for unit in units {
        plan_unit(
            rule,
            rows,
            &candidates,
            &unit,
            input.organized_hashes,
            &mut taken,
            &mut results,
        );
    }

    Ok(results
        .into_iter()
        .map(|item| item.expect("every row is assigned exactly one plan item"))
        .collect())
}

/// Plans one collision unit (a single row, or a keep_pairs group), and
/// writes the resulting items into `results` at their original indices.
fn plan_unit(
    rule: &OrganizeRule,
    rows: &[MediaRow],
    candidates: &[Candidate],
    unit: &[usize],
    organized_hashes: &HashSet<String>,
    taken: &mut HashSet<String>,
    results: &mut [Option<OrganizePlanItem>],
) {
    let mut movable: Vec<usize> = Vec::new();

    for &idx in unit {
        let row = &rows[idx];

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

        if candidate_path == row.rel_path {
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
        return;
    }

    let mut suffix = 0usize;
    loop {
        let attempt: Vec<String> = movable
            .iter()
            .map(|&idx| {
                let file = if suffix == 0 {
                    candidates[idx].file.clone()
                } else {
                    format!("{}_{}", candidates[idx].file, suffix)
                };
                build_path(&rule.root, &candidates[idx].folder, &file, &candidates[idx].ext)
            })
            .collect();

        let mut lowered: Vec<String> = attempt.iter().map(|p| p.to_lowercase()).collect();
        let collides_with_taken = lowered.iter().any(|p| taken.contains(p));
        lowered.sort();
        let collides_within_batch = lowered.windows(2).any(|w| w[0] == w[1]);

        if !collides_with_taken && !collides_within_batch {
            for (&idx, path) in movable.iter().zip(attempt) {
                let row = &rows[idx];
                taken.insert(path.to_lowercase());
                results[idx] = Some(OrganizePlanItem {
                    media_id: row.id,
                    old_rel_path: row.rel_path.clone(),
                    new_rel_path: path,
                    status: PlanStatus::Planned,
                    reason: None,
                });
            }
            return;
        }

        suffix += 1;
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
fn group_min_dates(rows: &[MediaRow], own_dates: &[DateTime<Utc>]) -> Vec<DateTime<Utc>> {
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

    rows.iter().map(|row| group_min[&row_group_key(row)]).collect()
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
