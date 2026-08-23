use std::collections::HashSet;

use chrono::{DateTime, Utc};
use dp_core::{MediaKind, MediaRow, OrganizeRule, PlanStatus};
use dp_organize::{plan, HandlebarsTemplate, PlanInput};

fn row(id: i64, rel_path: &str, hash: &str, taken_at: Option<&str>) -> MediaRow {
    MediaRow {
        id,
        drive_id: 1,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 100,
        kind: MediaKind::Photo,
        ext: rel_path.rsplit('.').next().unwrap_or("jpg").into(),
        width: None,
        height: None,
        duration_ms: None,
        taken_at: taken_at.map(|t| t.parse().unwrap()),
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat: None,
        lon: None,
        missing_at: None,
        organized_at: None,
        source_id: None,
    }
}

fn rule(drive_id: i64) -> OrganizeRule {
    OrganizeRule::default_for(drive_id)
}

fn no_mtime(_: &MediaRow) -> Option<DateTime<Utc>> {
    None
}

#[test]
fn plans_paths_from_taken_at() {
    let rule = rule(1);
    let rows = vec![row(1, "IMG_0001.jpg", "h1", Some("2025-09-12T14:03:21Z"))];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].media_id, 1);
    assert_eq!(items[0].old_rel_path, "IMG_0001.jpg");
    assert_eq!(items[0].new_rel_path, "archive/2025/Q3/2025-09-12_IMG_0001.jpg");
    assert_eq!(items[0].status, PlanStatus::Planned);
    assert_eq!(items[0].reason, None);
}

#[test]
fn falls_back_to_mtime_then_now() {
    let rule = rule(1);
    let rows = vec![row(1, "a.jpg", "h1", None), row(2, "b.jpg", "h2", None)];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let now: DateTime<Utc> = "2026-01-01T00:00:00Z".parse().unwrap();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now,
    };

    let mtime = |r: &MediaRow| -> Option<DateTime<Utc>> {
        if r.id == 1 {
            Some("2024-05-06T00:00:00Z".parse().unwrap())
        } else {
            None
        }
    };

    let items = plan(&input, &HandlebarsTemplate, &mtime).unwrap();

    assert_eq!(items[0].new_rel_path, "archive/2024/Q2/2024-05-06_a.jpg");
    assert_eq!(items[1].new_rel_path, "archive/2026/Q1/2026-01-01_b.jpg");
}

#[test]
fn marks_duplicates() {
    let mut rule = rule(1);
    rule.keep_pairs = false;
    let rows = vec![row(1, "dup.jpg", "h-dup", Some("2025-01-01T00:00:00Z"))];
    let mut organized_hashes = HashSet::new();
    organized_hashes.insert("h-dup".to_string());
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items[0].status, PlanStatus::SkippedDup);
    assert_eq!(items[0].new_rel_path, "dup.jpg");
}

#[test]
fn suffixes_collisions() {
    let mut rule = rule(1);
    rule.folder_tpl = "flat".into();
    rule.file_tpl = "same-name".into();
    rule.keep_pairs = false;
    let rows = vec![
        row(1, "a.jpg", "h1", Some("2025-01-01T00:00:00Z")),
        row(2, "b.jpg", "h2", Some("2025-06-01T00:00:00Z")),
    ];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items[0].new_rel_path, "archive/flat/same-name.jpg");
    assert_eq!(items[1].new_rel_path, "archive/flat/same-name_1.jpg");
    assert_eq!(items[0].status, PlanStatus::Planned);
    assert_eq!(items[1].status, PlanStatus::Planned);
}

#[test]
fn collision_with_existing_paths() {
    let mut rule = rule(1);
    rule.folder_tpl = "flat".into();
    rule.file_tpl = "same-name".into();
    rule.keep_pairs = false;
    let rows = vec![row(1, "a.jpg", "h1", Some("2025-01-01T00:00:00Z"))];
    let organized_hashes = HashSet::new();
    let mut existing_paths = HashSet::new();
    existing_paths.insert("archive/flat/same-name.jpg".to_string());
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items[0].new_rel_path, "archive/flat/same-name_1.jpg");
    assert_eq!(items[0].status, PlanStatus::Planned);
}

#[test]
fn pairs_share_stem_and_folder() {
    let mut rule = rule(1);
    rule.keep_pairs = true;
    // Straddles midnight: the pair's timestamps fall on different
    // calendar days, so grouping by the *earliest* date (not just "some"
    // shared date) is actually exercised — using either row's own date
    // independently would put them in different day-stamped files.
    let rows = vec![
        row(1, "cards/DSCF0912.RAF", "h-raf", Some("2025-09-12T23:59:58Z")),
        row(2, "cards/DSCF0912.JPG", "h-jpg", Some("2025-09-13T00:00:02Z")),
    ];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items[0].new_rel_path, "archive/2025/Q3/2025-09-12_DSCF0912.raf");
    assert_eq!(items[1].new_rel_path, "archive/2025/Q3/2025-09-12_DSCF0912.jpg");
    assert_eq!(items[0].status, PlanStatus::Planned);
    assert_eq!(items[1].status, PlanStatus::Planned);
}

#[test]
fn already_in_place_is_skipped() {
    let mut rule = rule(1);
    rule.root = "archive".into();
    rule.folder_tpl = "{{yyyy}}/Q{{q}}".into();
    rule.file_tpl = "{{stem}}".into();
    rule.keep_pairs = false;
    let rows = vec![row(
        1,
        "archive/2025/Q3/IMG_0001.jpg",
        "h1",
        Some("2025-09-12T14:03:21Z"),
    )];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items[0].status, PlanStatus::SkippedCollision);
    assert_eq!(items[0].reason.as_deref(), Some("already in place"));
    assert_eq!(items[0].new_rel_path, items[0].old_rel_path);
}

/// Regression test for a CRITICAL bug: two rows grouped into the same
/// `keep_pairs` unit whose computed targets are equal *case-insensitively*
/// (but not case-sensitively) used to make the old suffix-the-whole-group
/// algorithm loop forever, since bumping a *shared* suffix never breaks a
/// tie between two candidates that are identical up to case. `plan()` must
/// terminate and hand back two distinct (case-insensitively) paths.
#[test]
fn disambiguates_case_insensitive_collisions_within_a_pair() {
    let mut rule = rule(1);
    rule.keep_pairs = true;
    let rows = vec![
        row(1, "cards/Photo.jpg", "h1", Some("2025-09-12T14:03:21Z")),
        row(2, "cards/photo.JPG", "h2", Some("2025-09-12T14:03:21Z")),
    ];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items.len(), 2);
    assert_eq!(items[0].status, PlanStatus::Planned);
    assert_eq!(items[1].status, PlanStatus::Planned);
    assert_ne!(
        items[0].new_rel_path.to_lowercase(),
        items[1].new_rel_path.to_lowercase(),
        "the two members must land at distinct (even case-insensitively) paths"
    );
    assert_eq!(items[0].new_rel_path, "archive/2025/Q3/2025-09-12_Photo.jpg");
    assert_eq!(items[1].new_rel_path, "archive/2025/Q3/2025-09-12_photo_1.jpg");
}

/// Regression test for the same CRITICAL bug, via a duplicated catalog row
/// (identical `rel_path` appearing twice, e.g. a catalog inconsistency)
/// rather than a case-variant filename. `organized_hashes` doesn't catch
/// this (different hashes), so both rows reach collision handling with
/// fully identical candidates and must still be disambiguated without
/// looping.
#[test]
fn disambiguates_duplicate_rows_within_a_pair() {
    let mut rule = rule(1);
    rule.keep_pairs = true;
    let rows = vec![
        row(1, "cards/DSCF1000.RAF", "h1", Some("2025-09-12T14:03:21Z")),
        row(2, "cards/DSCF1000.RAF", "h2", Some("2025-09-12T14:03:21Z")),
    ];
    let organized_hashes = HashSet::new();
    let existing_paths = HashSet::new();
    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: "2026-01-01T00:00:00Z".parse().unwrap(),
    };

    let items = plan(&input, &HandlebarsTemplate, &no_mtime).unwrap();

    assert_eq!(items.len(), 2);
    assert_eq!(items[0].status, PlanStatus::Planned);
    assert_eq!(items[1].status, PlanStatus::Planned);
    assert_ne!(items[0].new_rel_path, items[1].new_rel_path);
    assert_eq!(items[0].new_rel_path, "archive/2025/Q3/2025-09-12_DSCF1000.raf");
    assert_eq!(items[1].new_rel_path, "archive/2025/Q3/2025-09-12_DSCF1000_1.raf");
}
