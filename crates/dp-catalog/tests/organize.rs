use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{
    DriveRole, MediaKind, NewDrive, NewMedia, NewSource, OrganizeItemRow, OrganizeRule, PlanStatus,
};

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1000,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: Some(100),
        height: Some(200),
        duration_ms: None,
        taken_at: None,
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat: None,
        lon: None,
        organized_at: None,
        mtime: None,
        source_id: None,
    }
}

/// [`nm`], but attributed to `source_id` — `unorganized_summary`'s
/// aggregate counts (unlike `total`) only ever include rows with a
/// source, so most of this file's fixtures need one.
fn nm_with_source(drive_id: i64, rel_path: &str, hash: &str, source_id: i64) -> NewMedia {
    NewMedia {
        source_id: Some(source_id),
        ..nm(drive_id, rel_path, hash)
    }
}

async fn drive(c: &SqliteCatalog) -> i64 {
    c.register_drive(NewDrive {
        name: "A".into(),
        mount_path: "/Volumes/A".into(),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
    })
    .await
    .unwrap()
    .id
}

/// Creates and returns the id of a freshly enabled [`Source`](dp_core::Source)
/// for `drive_id`, so fixture media can be attributed to a real source row
/// (the `source_id` foreign key is enforced).
async fn source(c: &SqliteCatalog, drive_id: i64) -> i64 {
    c.upsert_source(NewSource {
        drive_id,
        rel_path: "".into(),
    })
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn get_rule_returns_default_then_saved() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let default = c.get_rule(drive_id).await.unwrap();
    assert_eq!(default, OrganizeRule::default_for(drive_id));

    let custom = OrganizeRule {
        drive_id,
        root: "sorted".into(),
        folder_tpl: "{{yyyy}}".into(),
        file_tpl: "{{stem}}".into(),
        keep_pairs: false,
    };
    c.save_rule(&custom).await.unwrap();
    let saved = c.get_rule(drive_id).await.unwrap();
    assert_eq!(saved, custom);
}

#[tokio::test]
async fn list_unorganized_excludes_organized_and_root_prefixed() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    c.upsert_media(nm_with_source(drive_id, "plain.jpg", "h-plain", source_id))
        .await
        .unwrap();
    let organized_id = c
        .upsert_media(nm_with_source(drive_id, "organized.jpg", "h-org", source_id))
        .await
        .unwrap();
    c.mark_media_organized(organized_id, "archive/organized.jpg")
        .await
        .unwrap();
    c.upsert_media(nm_with_source(drive_id, "archive/x.jpg", "h-archive", source_id))
        .await
        .unwrap();

    let rows = c.list_unorganized(drive_id, "archive").await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].rel_path, "plain.jpg");
}

/// The planner never even sees a legacy row (`source_id IS NULL`) —
/// `list_unorganized` excludes it outright, rather than relying solely
/// on `PlanInput::require_source` to catch it downstream.
#[tokio::test]
async fn list_unorganized_excludes_rows_with_no_source() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    c.upsert_media(nm_with_source(drive_id, "has-source.jpg", "h-has", source_id))
        .await
        .unwrap();
    c.upsert_media(nm(drive_id, "legacy.jpg", "h-legacy"))
        .await
        .unwrap();

    let rows = c.list_unorganized(drive_id, "archive").await.unwrap();
    assert_eq!(
        rows.iter().map(|r| r.rel_path.as_str()).collect::<Vec<_>>(),
        ["has-source.jpg"]
    );
}

#[tokio::test]
async fn unorganized_summary_counts_bytes_kinds_and_range() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;
    let earlier: DateTime<Utc> = "2024-01-01T00:00:00Z".parse().unwrap();
    let later: DateTime<Utc> = "2024-06-01T00:00:00Z".parse().unwrap();

    let mut photo = nm_with_source(drive_id, "a.jpg", "h-a", source_id);
    photo.size = 100;
    photo.taken_at = Some(earlier);
    c.upsert_media(photo).await.unwrap();

    let mut video = nm_with_source(drive_id, "b.mp4", "h-b", source_id);
    video.size = 200;
    video.kind = MediaKind::Video;
    video.ext = "mp4".into();
    video.taken_at = Some(later);
    c.upsert_media(video).await.unwrap();

    // Already organized — excluded from the summary.
    let organized_id = c
        .upsert_media(nm_with_source(drive_id, "c.jpg", "h-c", source_id))
        .await
        .unwrap();
    c.mark_media_organized(organized_id, "archive/c.jpg")
        .await
        .unwrap();

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.drive_id, drive_id);
    assert_eq!(summary.count, 2);
    assert_eq!(summary.bytes, 300);
    assert_eq!(summary.photos, 1);
    assert_eq!(summary.videos, 1);
    assert_eq!(summary.earliest, Some(earlier));
    assert_eq!(summary.latest, Some(later));
    assert_eq!(summary.legacy, 0, "every row here has a source");
}

#[tokio::test]
async fn root_prefix_check_is_immune_to_like_underscore_wildcard() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    // `_` is a single-character LIKE wildcard — "my_archive/%" would also
    // match "myXarchive/...". The prefix check must treat it literally.
    c.upsert_media(nm_with_source(drive_id, "my_archive/x.jpg", "h-under", source_id))
        .await
        .unwrap();
    c.upsert_media(nm_with_source(drive_id, "myXarchive/y.jpg", "h-x", source_id))
        .await
        .unwrap();

    let rows = c.list_unorganized(drive_id, "my_archive").await.unwrap();
    assert_eq!(
        rows.iter().map(|r| r.rel_path.as_str()).collect::<Vec<_>>(),
        ["myXarchive/y.jpg"]
    );

    let summary = c.unorganized_summary(drive_id, "my_archive").await.unwrap();
    assert_eq!(summary.count, 1);
}

#[tokio::test]
async fn root_prefix_check_is_immune_to_like_percent_wildcard() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    // `%` is a multi-character LIKE wildcard — "100%/%" would also match
    // "100abc/...". The prefix check must treat it literally.
    c.upsert_media(nm_with_source(drive_id, "100%/z.jpg", "h-percent", source_id))
        .await
        .unwrap();
    c.upsert_media(nm_with_source(drive_id, "100abc/w.jpg", "h-abc", source_id))
        .await
        .unwrap();

    let rows = c.list_unorganized(drive_id, "100%").await.unwrap();
    assert_eq!(
        rows.iter().map(|r| r.rel_path.as_str()).collect::<Vec<_>>(),
        ["100abc/w.jpg"]
    );

    let summary = c.unorganized_summary(drive_id, "100%").await.unwrap();
    assert_eq!(summary.count, 1);
}

#[tokio::test]
async fn organized_hashes_only_returns_organized() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let organized_id = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
    c.mark_media_organized(organized_id, "archive/b.jpg")
        .await
        .unwrap();

    let found = c
        .organized_hashes(&["h-a".to_string(), "h-b".to_string(), "h-missing".to_string()])
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert!(found.contains("h-b"));
}

#[tokio::test]
async fn list_rel_paths_returns_all_paths_for_drive_regardless_of_organized_state() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let other_drive_id = c
        .register_drive(NewDrive {
            name: "B".into(),
            mount_path: "/Volumes/B".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
        })
        .await
        .unwrap()
        .id;

    c.upsert_media(nm(drive_id, "plain.jpg", "h-plain"))
        .await
        .unwrap();
    let organized_id = c
        .upsert_media(nm(drive_id, "organized.jpg", "h-org"))
        .await
        .unwrap();
    c.mark_media_organized(organized_id, "archive/organized.jpg")
        .await
        .unwrap();
    c.upsert_media(nm(other_drive_id, "elsewhere.jpg", "h-other"))
        .await
        .unwrap();

    let mut paths = c.list_rel_paths(drive_id).await.unwrap();
    paths.sort();
    assert_eq!(paths, ["archive/organized.jpg", "plain.jpg"]);
}

#[tokio::test]
async fn job_lifecycle() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let media_id1 = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let media_id2 = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();

    let job_id = c.create_organize_job(drive_id, 2).await.unwrap();
    c.insert_organize_item(&OrganizeItemRow {
        id: 0,
        job_id,
        media_id: media_id1,
        old_rel_path: "a.jpg".into(),
        new_rel_path: "archive/a.jpg".into(),
        status: PlanStatus::Moved,
        error: None,
    })
    .await
    .unwrap();
    c.insert_organize_item(&OrganizeItemRow {
        id: 0,
        job_id,
        media_id: media_id2,
        old_rel_path: "b.jpg".into(),
        new_rel_path: "archive/b.jpg".into(),
        status: PlanStatus::Failed,
        error: Some("boom".into()),
    })
    .await
    .unwrap();
    c.finish_organize_job(job_id, "done", 1, 0, 1).await.unwrap();

    let job_id2 = c.create_organize_job(drive_id, 0).await.unwrap();
    c.finish_organize_job(job_id2, "done", 0, 0, 0).await.unwrap();

    let jobs = c.list_organize_jobs(10).await.unwrap();
    assert_eq!(jobs.len(), 2);
    assert_eq!(
        jobs.iter().map(|j| j.id).collect::<Vec<_>>(),
        [job_id2, job_id],
        "list_organize_jobs must return the newest job first"
    );
    let job = jobs.iter().find(|j| j.id == job_id).unwrap();
    assert_eq!(job.drive_name, "A");
    assert_eq!(job.status, "done");
    assert_eq!(job.planned, 2);
    assert_eq!(job.moved, 1);
    assert_eq!(job.skipped, 0);
    assert_eq!(job.failed, 1);
    assert!(job.finished_at.is_some());

    let items = c.list_organize_items(job_id, 10).await.unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].status, PlanStatus::Moved);
    assert_eq!(items[1].status, PlanStatus::Failed);
    assert_eq!(items[1].error.as_deref(), Some("boom"));
}

#[tokio::test]
async fn mark_media_organized_sets_path_and_timestamp() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let media_id = c
        .upsert_media(nm(drive_id, "inbox/beforestem.jpg", "h-a"))
        .await
        .unwrap();

    c.mark_media_organized(media_id, "archive/afterstem.jpg")
        .await
        .unwrap();

    let (row, _) = c.get_media_with_drive(media_id).await.unwrap();
    assert_eq!(row.rel_path, "archive/afterstem.jpg");
    assert!(row.organized_at.is_some());

    // I1: the FTS index must follow the rename — searchable by the new
    // stem, no longer by the old one.
    let by_new_stem = c.search_media("afterstem", 10).await.unwrap();
    assert_eq!(by_new_stem.len(), 1);
    assert_eq!(by_new_stem[0].0.id, media_id);
    assert!(c.search_media("beforestem", 10).await.unwrap().is_empty());
}

/// I1: `mark_media_reverted` restores `rel_path`, and the FTS index must
/// follow that rename back too — searchable by the restored stem, no
/// longer by the organized one.
#[tokio::test]
async fn mark_media_reverted_updates_the_fts_index() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let media_id = c
        .upsert_media(nm(drive_id, "inbox/origstem.jpg", "h-a"))
        .await
        .unwrap();
    c.mark_media_organized(media_id, "archive/organizedstem.jpg")
        .await
        .unwrap();
    assert_eq!(c.search_media("organizedstem", 10).await.unwrap().len(), 1);

    c.mark_media_reverted(media_id, "inbox/origstem.jpg")
        .await
        .unwrap();

    let (row, _) = c.get_media_with_drive(media_id).await.unwrap();
    assert_eq!(row.rel_path, "inbox/origstem.jpg");
    assert!(row.organized_at.is_none());

    let by_orig_stem = c.search_media("origstem", 10).await.unwrap();
    assert_eq!(by_orig_stem.len(), 1);
    assert_eq!(by_orig_stem[0].0.id, media_id);
    assert!(c.search_media("organizedstem", 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn unorganized_summary_reports_the_drive_total_alongside_the_unorganized_count() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    c.upsert_media(nm_with_source(drive_id, "a.jpg", "h-a", source_id))
        .await
        .unwrap();
    let organized_id = c
        .upsert_media(nm_with_source(drive_id, "b.jpg", "h-b", source_id))
        .await
        .unwrap();
    c.mark_media_organized(organized_id, "archive/b.jpg")
        .await
        .unwrap();

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.count, 1, "only the unorganized row counts here");
    assert_eq!(summary.total, 2, "total counts every row on the drive");
}

/// A row scanned before sources existed (`source_id IS NULL`) can never be
/// organized — the planner refuses it via `PlanInput::require_source` — so
/// it must not inflate `count`, even though it's still unorganized and
/// outside the root. `total` is unaffected: it counts every row on the
/// drive regardless of source attribution.
#[tokio::test]
async fn unorganized_summary_excludes_legacy_rows_from_count_but_not_total() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    c.upsert_media(nm_with_source(drive_id, "a.jpg", "h-a", source_id))
        .await
        .unwrap();
    // Legacy: unorganized, outside the root, but no source attribution.
    c.upsert_media(nm(drive_id, "legacy.jpg", "h-legacy"))
        .await
        .unwrap();

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.count, 1, "the legacy row must not count as organizable");
    assert_eq!(summary.total, 2, "total still counts every row on the drive");
}

/// `legacy` counts a drive's source-less rows so a caller doesn't need a
/// second round-trip to know how many need a re-scan before they can
/// ever be organized.
#[tokio::test]
async fn unorganized_summary_reports_the_legacy_count() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source_id = source(&c, drive_id).await;

    c.upsert_media(nm_with_source(drive_id, "a.jpg", "h-a", source_id))
        .await
        .unwrap();
    c.upsert_media(nm(drive_id, "legacy-1.jpg", "h-legacy-1"))
        .await
        .unwrap();
    c.upsert_media(nm(drive_id, "legacy-2.jpg", "h-legacy-2"))
        .await
        .unwrap();

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.legacy, 2);
}

/// `legacy` reuses the exact "organizable" predicate (unorganized,
/// outside root) minus the source requirement — a source-less row that's
/// *already organized* doesn't need a re-scan to be resolved, so it must
/// not count.
#[tokio::test]
async fn unorganized_summary_legacy_excludes_an_already_organized_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let organized_id = c
        .upsert_media(nm(drive_id, "legacy-organized.jpg", "h-legacy-organized"))
        .await
        .unwrap();
    c.mark_media_organized(organized_id, "archive/legacy-organized.jpg")
        .await
        .unwrap();

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.legacy, 0);
}

/// Same predicate, other half: a source-less row already sitting under
/// the rule's root doesn't need a re-scan either, so it must not count
/// as `legacy`.
#[tokio::test]
async fn unorganized_summary_legacy_excludes_a_row_already_under_root() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    c.upsert_media(nm(drive_id, "archive/legacy-in-place.jpg", "h-legacy-in-place"))
        .await
        .unwrap();

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.legacy, 0);
}

#[tokio::test]
async fn unorganized_summary_total_is_zero_for_a_never_scanned_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let summary = c.unorganized_summary(drive_id, "archive").await.unwrap();
    assert_eq!(summary.count, 0);
    assert_eq!(summary.total, 0);
}

/// A process killed mid-organize leaves its `organize_jobs` row stuck
/// `"running"` forever — nothing is left alive to finish it. Opening
/// the (file-backed) catalog again reconciles those rows to `"failed"`.
#[tokio::test]
async fn reopening_a_file_catalog_fails_jobs_left_running_by_a_dead_process() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("catalog.db");

    let job_id = {
        let c = SqliteCatalog::open(&db_path).await.unwrap();
        let drive_id = drive(&c).await;
        let job_id = c.create_organize_job(drive_id, 3).await.unwrap();

        let row = c
            .list_organize_jobs(10)
            .await
            .unwrap()
            .into_iter()
            .find(|j| j.id == job_id)
            .unwrap();
        assert_eq!(row.status, "running");
        assert!(row.finished_at.is_none());
        job_id
    };

    let reopened = SqliteCatalog::open(&db_path).await.unwrap();
    let row = reopened
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == job_id)
        .unwrap();
    assert_eq!(row.status, "failed");
    assert!(
        row.finished_at.is_some(),
        "a reconciled row must be stamped finished"
    );
}

/// Reconciliation must not touch rows that already reached a terminal
/// state — a `"done"` run stays done across a restart.
#[tokio::test]
async fn reopening_a_file_catalog_leaves_finished_jobs_alone() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("catalog.db");

    let job_id = {
        let c = SqliteCatalog::open(&db_path).await.unwrap();
        let drive_id = drive(&c).await;
        let job_id = c.create_organize_job(drive_id, 3).await.unwrap();
        c.finish_organize_job(job_id, "done", 3, 0, 0).await.unwrap();
        job_id
    };

    let reopened = SqliteCatalog::open(&db_path).await.unwrap();
    let row = reopened
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == job_id)
        .unwrap();
    assert_eq!(row.status, "done");
    assert_eq!(row.moved, 3);
}

/// `has_sources` is what tells the UI a scan would walk anything at all:
/// with no enabled source, "SCAN NOW" can only ever find zero photos, so
/// the user has to be sent to set sources up instead.
#[tokio::test]
async fn unorganized_summary_reports_whether_the_drive_has_an_enabled_source() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    assert!(
        !c.unorganized_summary(drive_id, "archive")
            .await
            .unwrap()
            .has_sources
    );

    let source_id = source(&c, drive_id).await;
    assert!(
        c.unorganized_summary(drive_id, "archive")
            .await
            .unwrap()
            .has_sources
    );

    // A source that exists but is switched off is no source at all.
    c.set_source_enabled(source_id, false).await.unwrap();
    assert!(
        !c.unorganized_summary(drive_id, "archive")
            .await
            .unwrap()
            .has_sources
    );
}
