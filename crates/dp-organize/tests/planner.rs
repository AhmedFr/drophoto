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
    let rows = vec![
        row(1, "cards/DSCF0912.RAF", "h-raf", Some("2025-09-12T14:03:21Z")),
        row(2, "cards/DSCF0912.JPG", "h-jpg", Some("2025-09-12T14:03:23Z")),
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
