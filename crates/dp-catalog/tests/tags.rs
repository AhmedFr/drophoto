use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, NewSource};

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1234,
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

async fn drive(c: &SqliteCatalog) -> i64 {
    c.register_drive(NewDrive {
        name: "A".into(),
        mount_path: "/Volumes/A".into(),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
        volume_uuid: None,
        volume_label: None,
    })
    .await
    .unwrap()
    .id
}

/// A drive plus a registered source — needed to exercise `reconcile_missing`
/// (which, per `MINOR-3`, only ever touches rows attributed to a source).
async fn drive_with_source(c: &SqliteCatalog) -> (i64, i64) {
    let drive_id = drive(c).await;
    let source_id = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "".into(),
        })
        .await
        .unwrap()
        .id;
    (drive_id, source_id)
}

/// Same shape as [`nm`], but attributed to `source_id` so
/// `reconcile_missing` can mark it missing.
fn nm_with_source(drive_id: i64, rel_path: &str, hash: &str, source_id: i64) -> NewMedia {
    NewMedia {
        source_id: Some(source_id),
        ..nm(drive_id, rel_path, hash)
    }
}

#[tokio::test]
async fn tag_media_creates_links_and_marks_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();

    c.tag_media(&[a, b], &["Trip".into(), "beach".into()], &[])
        .await
        .unwrap();

    let tags = c.list_tags().await.unwrap();
    assert_eq!(tags.len(), 2);

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    let names: Vec<&str> = for_a.iter().map(|(_, t)| t.name.as_str()).collect();
    assert_eq!(names, vec!["beach", "Trip"]);

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    assert_eq!(pending.len(), 2);
}

#[tokio::test]
async fn tag_media_is_name_case_insensitive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Beach".into()], &[]).await.unwrap();
    c.tag_media(&[a], &["beach".into()], &[]).await.unwrap();

    let tags = c.list_tags().await.unwrap();
    assert_eq!(tags.len(), 1);

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    assert_eq!(for_a.len(), 1);
}

#[tokio::test]
async fn tag_media_remove_unlinks_and_marks_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    let tag_id = c.list_tags().await.unwrap()[0].id;

    c.clear_sidecar_pending(a).await.unwrap();

    c.tag_media(&[a], &[], &[tag_id]).await.unwrap();

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    assert!(for_a.is_empty());

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, a);
}

#[tokio::test]
async fn tag_media_noop_does_not_mark_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    c.clear_sidecar_pending(a).await.unwrap();

    // Adding an already-linked tag is a no-op.
    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());

    // Removing a tag id that was never linked is a no-op.
    c.tag_media(&[a], &[], &[999_999]).await.unwrap();
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn clear_sidecar_pending_clears_one_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    assert_eq!(c.list_sidecar_pending(drive_id).await.unwrap().len(), 1);

    c.clear_sidecar_pending(a).await.unwrap();
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn tags_for_media_empty_ids_returns_empty() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let result = c.tags_for_media(&[]).await.unwrap();
    assert!(result.is_empty());
}

#[tokio::test]
async fn tag_names_for_media_orders_by_name() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.tag_media(&[a], &["Trip".into(), "beach".into()], &[])
        .await
        .unwrap();

    let names = c.tag_names_for_media(a).await.unwrap();
    assert_eq!(names, vec!["beach", "Trip"]);
}

#[tokio::test]
async fn mark_sidecar_pending_sets_the_flag() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.mark_sidecar_pending(a).await.unwrap();

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, a);
}

#[tokio::test]
async fn has_sidecar_pending_reports_whether_any_row_is_flagged() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h1")).await.unwrap();

    assert!(!c.has_sidecar_pending(drive_id).await.unwrap());

    c.tag_media(&[a], &["x".into()], &[]).await.unwrap();
    assert!(c.has_sidecar_pending(drive_id).await.unwrap());

    c.clear_sidecar_pending(a).await.unwrap();
    assert!(!c.has_sidecar_pending(drive_id).await.unwrap());
}

#[tokio::test]
async fn list_tagged_media_returns_only_rows_with_at_least_one_tag() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
    c.upsert_media(nm(drive_id, "c.jpg", "h-c")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    c.tag_media(&[b], &["Trip".into(), "beach".into()], &[])
        .await
        .unwrap();

    let tagged = c.list_tagged_media(drive_id).await.unwrap();
    let mut ids: Vec<i64> = tagged.iter().map(|r| r.id).collect();
    ids.sort();
    // `b` has two tags but must appear exactly once.
    assert_eq!(ids, vec![a, b]);
}

#[tokio::test]
async fn list_tagged_media_is_scoped_to_one_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let other_id = c
        .register_drive(NewDrive {
            name: "B".into(),
            mount_path: "/Volumes/B".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
            volume_uuid: None,
            volume_label: None,
        })
        .await
        .unwrap()
        .id;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h1")).await.unwrap();
    c.tag_media(&[a], &["x".into()], &[]).await.unwrap();

    assert_eq!(c.list_tagged_media(drive_id).await.unwrap().len(), 1);
    assert!(c.list_tagged_media(other_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn sidecar_health_counts_tagged_and_pending_independently() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
    c.upsert_media(nm(drive_id, "c.jpg", "h-c")).await.unwrap();

    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 0);
    assert_eq!(health.pending, 0);

    c.tag_media(&[a, b], &["Trip".into()], &[]).await.unwrap();
    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 2);
    assert_eq!(health.pending, 2);

    // A row can be tagged with its sidecar already written — `pending`
    // must drop while `tagged` stays put.
    c.clear_sidecar_pending(a).await.unwrap();
    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 2);
    assert_eq!(health.pending, 1);

    // `mark_sidecar_pending` (e.g. from `check_sidecar_files` finding a
    // missing `.xmp`) bumps `pending` without touching `tagged`.
    c.mark_sidecar_pending(a).await.unwrap();
    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 2);
    assert_eq!(health.pending, 2);
}

#[tokio::test]
async fn sidecar_health_is_scoped_to_one_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let other_id = c
        .register_drive(NewDrive {
            name: "B".into(),
            mount_path: "/Volumes/B".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
            volume_uuid: None,
            volume_label: None,
        })
        .await
        .unwrap()
        .id;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h1")).await.unwrap();
    c.tag_media(&[a], &["x".into()], &[]).await.unwrap();

    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 1);
    assert_eq!(health.pending, 1);

    let other_health = c.sidecar_health(other_id).await.unwrap();
    assert_eq!(other_health.tagged, 0);
    assert_eq!(other_health.pending, 0);
}

#[tokio::test]
async fn has_sidecar_pending_is_scoped_to_one_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let other_id = c
        .register_drive(NewDrive {
            name: "B".into(),
            mount_path: "/Volumes/B".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
            volume_uuid: None,
            volume_label: None,
        })
        .await
        .unwrap()
        .id;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h1")).await.unwrap();
    c.tag_media(&[a], &["x".into()], &[]).await.unwrap();

    assert!(c.has_sidecar_pending(drive_id).await.unwrap());
    assert!(!c.has_sidecar_pending(other_id).await.unwrap());
}

/// MAJOR-1/MINOR-1: a photo deleted outside drophoto takes its `.xmp` with
/// it — the row is marked `missing_at` by `reconcile_missing`, and has no
/// sidecar that can ever be verified or written. `list_tagged_media` is
/// what `check_sidecar_files` sweeps, so a missing row must never appear
/// in it (that's what previously wedged `sidecar_pending` on permanently).
#[tokio::test]
async fn list_tagged_media_excludes_rows_marked_missing() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let present = c
        .upsert_media(nm_with_source(drive_id, "present.jpg", "h-present", source_id))
        .await
        .unwrap();
    let gone = c
        .upsert_media(nm_with_source(drive_id, "gone.jpg", "h-gone", source_id))
        .await
        .unwrap();
    c.tag_media(&[present, gone], &["Trip".into()], &[])
        .await
        .unwrap();

    // The last scan didn't see gone.jpg — mark it missing exactly the way
    // a real scan's reconcile step would.
    c.reconcile_missing(drive_id, source_id, &["present.jpg".to_string()])
        .await
        .unwrap();

    let tagged = c.list_tagged_media(drive_id).await.unwrap();
    let ids: Vec<i64> = tagged.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![present], "the missing row must be excluded");
}

/// Same seam, `sidecar_health`'s counts: a missing row must count toward
/// neither `tagged` nor `pending`, or the two numbers stop agreeing (and
/// the panel reports a repair queue that can never drain).
#[tokio::test]
async fn sidecar_health_excludes_rows_marked_missing() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let present = c
        .upsert_media(nm_with_source(drive_id, "present.jpg", "h-present", source_id))
        .await
        .unwrap();
    let gone = c
        .upsert_media(nm_with_source(drive_id, "gone.jpg", "h-gone", source_id))
        .await
        .unwrap();
    c.tag_media(&[present, gone], &["Trip".into()], &[])
        .await
        .unwrap();

    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 2);
    assert_eq!(health.pending, 2);

    c.reconcile_missing(drive_id, source_id, &["present.jpg".to_string()])
        .await
        .unwrap();

    let health = c.sidecar_health(drive_id).await.unwrap();
    assert_eq!(health.tagged, 1, "the missing row must drop out of tagged");
    assert_eq!(health.pending, 1, "the missing row must drop out of pending");
}

/// `has_sidecar_pending` gates `start_sidecar_sync_all` (fired on every app
/// launch and after every tag edit) — if it stayed `true` for a row whose
/// file is gone, that sweep would spawn a guaranteed-to-fail job forever.
#[tokio::test]
async fn has_sidecar_pending_ignores_rows_marked_missing() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let gone = c
        .upsert_media(nm_with_source(drive_id, "gone.jpg", "h-gone", source_id))
        .await
        .unwrap();
    c.tag_media(&[gone], &["Trip".into()], &[]).await.unwrap();
    assert!(c.has_sidecar_pending(drive_id).await.unwrap());

    // gone.jpg vanishes and the next scan marks it missing; its
    // `sidecar_pending` flag is deliberately left set by `sidecar_sync`
    // (nothing else can ever clear it), so the exclusion has to happen on
    // the read side.
    c.reconcile_missing(drive_id, source_id, &[]).await.unwrap();

    assert!(
        !c.has_sidecar_pending(drive_id).await.unwrap(),
        "a missing row's stuck pending flag must not keep re-triggering the sweep"
    );
}
