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

#[tokio::test]
async fn list_tags_with_counts_orders_by_name_and_counts_links() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();

    c.tag_media(&[a, b], &["Trip".into()], &[]).await.unwrap();
    c.tag_media(&[a], &["beach".into()], &[]).await.unwrap();
    // An unlinked tag still shows up, with a zero count.
    c.tag_media(&[a], &["Unused".into()], &[]).await.unwrap();
    c.tag_media(
        &[a],
        &[],
        &[c.list_tags()
            .await
            .unwrap()
            .iter()
            .find(|t| t.name == "Unused")
            .unwrap()
            .id],
    )
    .await
    .unwrap();

    let with_counts = c.list_tags_with_counts().await.unwrap();
    let names: Vec<&str> = with_counts.iter().map(|t| t.tag.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["beach", "Trip", "Unused"],
        "ordered by name, case-insensitively"
    );

    let counts: std::collections::HashMap<&str, u64> = with_counts
        .iter()
        .map(|t| (t.tag.name.as_str(), t.count))
        .collect();
    assert_eq!(counts["Trip"], 2);
    assert_eq!(counts["beach"], 1);
    assert_eq!(counts["Unused"], 0);
}

#[tokio::test]
async fn rename_tag_retitles_and_marks_every_linked_row_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
    let other = c
        .upsert_media(nm(drive_id, "other.jpg", "h-other"))
        .await
        .unwrap();

    c.tag_media(&[a, b], &["Trip".into()], &[]).await.unwrap();
    c.tag_media(&[other], &["Other".into()], &[]).await.unwrap();
    let trip_id = c
        .list_tags()
        .await
        .unwrap()
        .iter()
        .find(|t| t.name == "Trip")
        .unwrap()
        .id;
    c.clear_sidecar_pending(a).await.unwrap();
    c.clear_sidecar_pending(b).await.unwrap();
    c.clear_sidecar_pending(other).await.unwrap();

    c.rename_tag(trip_id, "Vacation").await.unwrap();

    let names: Vec<String> = c.list_tags().await.unwrap().into_iter().map(|t| t.name).collect();
    assert!(names.contains(&"Vacation".to_string()));
    assert!(!names.contains(&"Trip".to_string()));

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    let mut pending_ids: Vec<i64> = pending.iter().map(|r| r.id).collect();
    pending_ids.sort();
    assert_eq!(
        pending_ids,
        vec![a, b],
        "only rows linked to the renamed tag are affected"
    );
}

#[tokio::test]
async fn rename_tag_to_its_own_current_name_is_a_no_op() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    let trip_id = c.list_tags().await.unwrap()[0].id;
    c.clear_sidecar_pending(a).await.unwrap();

    c.rename_tag(trip_id, "Trip").await.unwrap();

    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());
}

/// Renaming a tag to a name that collides (case-insensitively) with a
/// *different* existing tag merges the renamed tag into that one instead
/// of erroring — see `rename_tag`'s doc comment.
#[tokio::test]
async fn rename_tag_colliding_with_another_tag_merges_into_it() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    c.tag_media(&[b], &["Vacation".into()], &[]).await.unwrap();
    let trip_id = c
        .list_tags()
        .await
        .unwrap()
        .iter()
        .find(|t| t.name == "Trip")
        .unwrap()
        .id;
    c.clear_sidecar_pending(a).await.unwrap();
    c.clear_sidecar_pending(b).await.unwrap();

    // Case-insensitive collision: renaming "Trip" to "vacation" (different
    // case) still merges into the existing "Vacation" tag.
    c.rename_tag(trip_id, "vacation").await.unwrap();

    let tags = c.list_tags().await.unwrap();
    assert_eq!(tags.len(), 1, "the two tags merged into one");
    assert_eq!(
        tags[0].name, "Vacation",
        "the surviving name is the collided-with tag's, not the rename target's casing"
    );

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    assert_eq!(for_a.len(), 1);
    assert_eq!(for_a[0].1.name, "Vacation");

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    let mut pending_ids: Vec<i64> = pending.iter().map(|r| r.id).collect();
    pending_ids.sort();
    assert_eq!(pending_ids, vec![a]);
}

#[tokio::test]
async fn rename_tag_missing_id_is_a_no_op() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    c.rename_tag(999_999, "whatever").await.unwrap();
}

#[tokio::test]
async fn merge_tags_relinks_media_and_drops_emptied_tags() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
    // `both` already carries the merge target, to prove no duplicate link
    // (and no crash) results.
    let both = c.upsert_media(nm(drive_id, "both.jpg", "h-both")).await.unwrap();
    let untouched = c
        .upsert_media(nm(drive_id, "untouched.jpg", "h-untouched"))
        .await
        .unwrap();

    c.tag_media(&[a], &["Beach".into()], &[]).await.unwrap();
    c.tag_media(&[b], &["Sand".into()], &[]).await.unwrap();
    c.tag_media(&[both], &["Beach".into(), "Sand".into()], &[])
        .await
        .unwrap();
    c.tag_media(&[untouched], &["Other".into()], &[]).await.unwrap();

    let tags = c.list_tags().await.unwrap();
    let beach_id = tags.iter().find(|t| t.name == "Beach").unwrap().id;
    let sand_id = tags.iter().find(|t| t.name == "Sand").unwrap().id;

    c.clear_sidecar_pending(a).await.unwrap();
    c.clear_sidecar_pending(b).await.unwrap();
    c.clear_sidecar_pending(both).await.unwrap();
    c.clear_sidecar_pending(untouched).await.unwrap();

    c.merge_tags(&[sand_id], beach_id).await.unwrap();

    let remaining_names: Vec<String> = c.list_tags().await.unwrap().into_iter().map(|t| t.name).collect();
    assert!(remaining_names.contains(&"Beach".to_string()));
    assert!(
        !remaining_names.contains(&"Sand".to_string()),
        "the merged-from tag is dropped"
    );

    for id in [a, b, both] {
        let names: Vec<String> = c
            .tags_for_media(&[id])
            .await
            .unwrap()
            .into_iter()
            .map(|(_, t)| t.name)
            .collect();
        assert_eq!(
            names,
            vec!["Beach".to_string()],
            "media {id} should carry only Beach after the merge"
        );
    }

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    let mut pending_ids: Vec<i64> = pending.iter().map(|r| r.id).collect();
    pending_ids.sort();
    // `a` was only ever linked to Beach (the merge target), never Sand, so
    // merging Sand into Beach never touches it — only rows that were
    // actually linked to the merged-from tag are affected.
    let mut expected = vec![b, both];
    expected.sort();
    assert_eq!(
        pending_ids, expected,
        "untouched (and a, never linked to Sand) must not be marked pending"
    );
}

#[tokio::test]
async fn merge_tags_ignores_a_from_id_equal_to_into_id() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    let trip_id = c.list_tags().await.unwrap()[0].id;
    c.clear_sidecar_pending(a).await.unwrap();

    c.merge_tags(&[trip_id], trip_id).await.unwrap();

    assert_eq!(c.list_tags().await.unwrap().len(), 1);
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn merge_tags_empty_from_ids_is_a_no_op() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    c.merge_tags(&[], 1).await.unwrap();
}

#[tokio::test]
async fn delete_tag_removes_the_tag_and_its_links() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
    let untouched = c
        .upsert_media(nm(drive_id, "untouched.jpg", "h-untouched"))
        .await
        .unwrap();

    c.tag_media(&[a, b], &["Trip".into()], &[]).await.unwrap();
    c.tag_media(&[untouched], &["Other".into()], &[]).await.unwrap();
    let trip_id = c
        .list_tags()
        .await
        .unwrap()
        .iter()
        .find(|t| t.name == "Trip")
        .unwrap()
        .id;
    c.clear_sidecar_pending(a).await.unwrap();
    c.clear_sidecar_pending(b).await.unwrap();
    c.clear_sidecar_pending(untouched).await.unwrap();

    c.delete_tag(trip_id).await.unwrap();

    let names: Vec<String> = c.list_tags().await.unwrap().into_iter().map(|t| t.name).collect();
    assert!(!names.contains(&"Trip".to_string()));
    assert!(c.tags_for_media(&[a]).await.unwrap().is_empty());
    assert!(c.tags_for_media(&[b]).await.unwrap().is_empty());
    assert_eq!(
        c.tags_for_media(&[untouched]).await.unwrap().len(),
        1,
        "untouched keeps its own tag"
    );

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    let mut pending_ids: Vec<i64> = pending.iter().map(|r| r.id).collect();
    pending_ids.sort();
    assert_eq!(pending_ids, vec![a, b]);
}

#[tokio::test]
async fn delete_tag_missing_id_is_a_no_op() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    c.delete_tag(999_999).await.unwrap();
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
