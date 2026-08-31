use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewJobRun, NewMedia, NewSource, OrganizeItemRow, PlanStatus};

fn nd(name: &str) -> NewDrive {
    NewDrive {
        name: name.into(),
        mount_path: format!("/Volumes/{name}"),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
        volume_uuid: None,
        volume_label: None,
    }
}

async fn drive(c: &SqliteCatalog, name: &str) -> i64 {
    c.register_drive(nd(name)).await.unwrap().id
}

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1000,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: None,
        height: None,
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

fn ts(s: &str) -> DateTime<Utc> {
    format!("{s}Z").parse().expect("fixed test timestamp must parse")
}

fn run(job_id: &str, drive_id: Option<i64>) -> NewJobRun {
    NewJobRun {
        job_id: job_id.into(),
        kind: "scan".into(),
        drive_id,
        status: "done".into(),
        ok: 1,
        failed: 0,
        skipped: 0,
        bytes_read: 0,
        bytes_written: 0,
        cpu_ms: 0,
        started_at: ts("2026-01-01T10:00:00"),
        finished_at: ts("2026-01-01T10:05:00"),
    }
}

/// The full cascade: registers a drive with a source, media (tagged, one
/// found via FTS), an organize job with an item, and a job_runs row, then
/// forgets the drive and asserts every one of those rows is gone — while
/// a second, untouched drive's rows (including its own media that happens
/// to share the forgotten drive's hash, to prove content-addressed
/// dedup-by-hash never gets confused with drive scoping) all survive.
#[tokio::test]
async fn forget_drive_cascades_every_referencing_row_in_one_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c, "Gone").await;
    let other_drive_id = drive(&c, "Stays").await;

    let source = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();

    let media_id = c
        .upsert_media(nm(drive_id, "a.jpg", "hash-shared"))
        .await
        .unwrap();
    // "Trip" is tagged on both drives' media (shared); "Solo" only ever
    // exists on the forgotten drive's media.
    c.tag_media(&[media_id], &["Trip".into(), "Solo".into()], &[])
        .await
        .unwrap();

    // A media row on the surviving drive, same hash — proves the cascade
    // is scoped by drive_id, not by content hash.
    let other_media_id = c
        .upsert_media(nm(other_drive_id, "b.jpg", "hash-shared"))
        .await
        .unwrap();
    c.tag_media(&[other_media_id], &["Trip".into()], &[])
        .await
        .unwrap();

    let job_id = c.create_organize_job(drive_id, 1).await.unwrap();
    c.insert_organize_item(&OrganizeItemRow {
        id: 0,
        job_id,
        media_id,
        old_rel_path: "a.jpg".into(),
        new_rel_path: "sorted/a.jpg".into(),
        status: PlanStatus::Moved,
        error: None,
    })
    .await
    .unwrap();

    c.record_job_run(run("scan-1", Some(drive_id))).await.unwrap();
    // A global job run (no drive_id) must never be touched by any drive's
    // forget.
    c.record_job_run(run("geocode-1", None)).await.unwrap();

    c.record_scan_error(drive_id, "broken.jpg", "hash_mismatch", "checksum mismatch")
        .await
        .unwrap();
    c.record_scan_error(other_drive_id, "fine.jpg", "hash_mismatch", "unrelated")
        .await
        .unwrap();

    let found = c.search_media("Solo", 10).await.unwrap();
    assert_eq!(
        found.len(),
        1,
        "sanity: media must be FTS-searchable before forgetting"
    );

    c.forget_drive(drive_id).await.unwrap();

    // The drive row itself is gone.
    let drives = c.list_drives().await.unwrap();
    assert_eq!(drives.len(), 1);
    assert_eq!(drives[0].id, other_drive_id);

    // Its source is gone.
    assert!(c.list_sources(drive_id).await.unwrap().is_empty());

    // Its media (and tags, via ON DELETE CASCADE) is gone.
    assert_eq!(c.count_media(Some(drive_id)).await.unwrap(), 0);
    let tags_for_gone = c.tags_for_media(&[media_id]).await.unwrap();
    assert!(tags_for_gone.is_empty());

    // Review finding 12: a tag used only by the forgotten drive's media
    // ("Solo") is pruned entirely; a tag shared with another drive's media
    // ("Trip") survives, since it's still referenced by `other_media_id`.
    let remaining_tag_names: Vec<String> = c.list_tags().await.unwrap().into_iter().map(|t| t.name).collect();
    assert!(!remaining_tag_names.contains(&"Solo".to_string()));
    assert!(remaining_tag_names.contains(&"Trip".to_string()));
    let other_tags = c.tags_for_media(&[other_media_id]).await.unwrap();
    assert_eq!(other_tags.len(), 1);
    assert_eq!(other_tags[0].1.name, "Trip");

    // Its organize job/item are gone.
    assert!(c.get_organize_job(job_id).await.unwrap().is_none());
    assert!(c.list_organize_items(job_id, 10).await.unwrap().is_empty());

    // Its job_runs row is gone; the global one and the other drive's data
    // survive untouched.
    let runs = c.list_job_runs(10).await.unwrap();
    assert!(runs.iter().all(|r| r.job_id != "scan-1"));
    assert!(runs.iter().any(|r| r.job_id == "geocode-1"));

    // FTS no longer surfaces the forgotten media ("Solo") but still finds
    // the surviving drive's own "Trip"-tagged media.
    let found_after = c.search_media("Solo", 10).await.unwrap();
    assert!(found_after.is_empty());
    let trip_after = c.search_media("Trip", 10).await.unwrap();
    assert_eq!(trip_after.len(), 1);

    // Its scan_errors are gone (drive ids are reused — no AUTOINCREMENT —
    // so leaving these behind could one day misattribute a stale error to
    // a brand-new drive); the other drive's own scan error survives.
    assert_eq!(c.count_scan_errors(drive_id).await.unwrap(), 0);
    assert_eq!(c.count_scan_errors(other_drive_id).await.unwrap(), 1);

    // The other drive's own row, source, and media are all untouched.
    assert_eq!(source.drive_id, drive_id); // sanity on the fixture itself
    assert_eq!(c.count_media(Some(other_drive_id)).await.unwrap(), 1);
    let (other_row, _) = c.get_media_with_drive(other_media_id).await.unwrap();
    assert_eq!(other_row.id, other_media_id);
}

#[tokio::test]
async fn forget_drive_on_an_already_gone_id_is_a_no_op() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    assert!(c.forget_drive(999_999).await.is_ok());
}

#[tokio::test]
async fn forget_drive_works_for_a_drive_with_no_media_or_jobs_at_all() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c, "Empty").await;

    c.forget_drive(drive_id).await.unwrap();

    assert!(c.list_drives().await.unwrap().is_empty());
}
