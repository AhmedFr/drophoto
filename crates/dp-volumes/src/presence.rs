use dp_core::{Drive, Volume};

/// Where `drive` should say it lives right now, per [`resolve_presence`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresenceMatch {
    pub drive_id: i64,
    pub mount_path: Option<String>,
    pub free_bytes: Option<u64>,
    /// The matched volume's `VolumeUUID`, when the match found one — for
    /// self-healing a legacy drive row whose own `volume_uuid` is still
    /// `NULL` (see the presence-watcher's backfill call). `None` when
    /// unmatched, or when the matched volume itself has no readable UUID.
    pub volume_uuid: Option<String>,
    /// The matched volume's own display name, when matched — see
    /// [`Drive::volume_label`](dp_core::Drive::volume_label). `None` when
    /// unmatched.
    pub volume_label: Option<String>,
}

impl PresenceMatch {
    fn unplugged(drive_id: i64) -> Self {
        Self {
            drive_id,
            mount_path: None,
            free_bytes: None,
            volume_uuid: None,
            volume_label: None,
        }
    }

    fn matched(drive_id: i64, v: &Volume) -> Self {
        Self {
            drive_id,
            mount_path: Some(v.mount_path.clone()),
            free_bytes: Some(v.free_bytes),
            volume_uuid: v.uuid.clone(),
            volume_label: Some(v.name.clone()),
        }
    }
}

/// Matches each `drive` against the currently-mounted `volumes`, returning
/// where each one should say it lives right now.
///
/// Resolution runs in four **global** passes, strongest evidence first —
/// every drive gets a chance to match at a tier before any drive is
/// allowed to match at the next, weaker one. A drive whose row already
/// holds a `volume_uuid` participates in tier 1 **only**: label and mount
/// path are renamable/coincidental, so falling through would let a
/// look-alike volume be silently adopted as the trusted drive (issue
/// #30); such a drive is reported unplugged instead when its uuid isn't
/// mounted. The weaker tiers exist for legacy rows with no recorded uuid:
/// 1. `drive.volume_uuid == volume.uuid` (both `Some`) — the strongest
///    signal, since a volume's Apple `VolumeUUID` survives both a rename
///    and a remount at a different path.
/// 2. `drive.volume_label == volume.name` — the volume's own display name
///    at last match, independent of the user-chosen `drive.name` shown in
///    the UI (this is the bug this order fixes: a drive renamed at
///    registration used to only ever match on `drive.name`, so
///    reconnecting it looked like a brand-new volume).
/// 3. Legacy `drive.name == volume.name`, **only when `drive.volume_label`
///    is `None`** — kept for a drive registered before `volume_label`
///    existed and never since matched. A drive that already has a known
///    `volume_label` must never fall through to this tier: if its own
///    volume is absent, matching some unrelated mounted volume that
///    happens to share the user's chosen display name (e.g. a drive named
///    "Backup" binding to an unrelated "Backup"-named Time Machine volume)
///    would silently attach the wrong physical drive.
/// 4. `drive.mount_path == volume.mount_path` — the drive's previously
///    known mount point, for a drive whose name (chosen or volume) no
///    longer matches anything, e.g. the volume was renamed at the OS
///    level.
///
/// Running the passes globally (rather than resolving one drive through
/// every tier before moving to the next) means the outcome never depends
/// on `drives`' order: a drive holding the correct `volume_uuid` always
/// wins its volume even if a different drive would otherwise have claimed
/// it by a weaker tier first. A volume already claimed by any drive at an
/// earlier tier (or earlier in the same tier) can never match a second
/// drive — each volume is claimed by at most one drive. A drive with no
/// matching volume at any tier is reported unplugged.
pub fn resolve_presence(drives: &[Drive], volumes: &[Volume]) -> Vec<PresenceMatch> {
    let mut claimed = vec![false; volumes.len()];
    let mut resolved: Vec<Option<PresenceMatch>> = vec![None; drives.len()];

    resolve_tier(drives, volumes, &mut claimed, &mut resolved, find_by_uuid);
    resolve_tier(drives, volumes, &mut claimed, &mut resolved, |d, vs, c| {
        // Tiers 2-4 are all gated on the drive having NO stored
        // `volume_uuid` (issue #30): once a uuid is recorded, it is the
        // drive's identity, and a same-label volume carrying a different
        // (or unreadable) uuid is an impostor — adopting it would let
        // scans ingest its files under the trusted drive's identity and
        // let organize jobs move originals onto it. A uuid-holding drive
        // whose volume's uuid is momentarily unreadable shows unplugged
        // for that tick instead, which is the fail-safe direction.
        if d.volume_uuid.is_some() {
            None
        } else {
            find_by_name(d.volume_label.as_deref(), vs, c)
        }
    });
    resolve_tier(drives, volumes, &mut claimed, &mut resolved, |d, vs, c| {
        // Gated on `volume_label` being unset — see tier 3's doc comment
        // above. A drive with a known label must never fall back to
        // matching an unrelated same-named volume. (The uuid gate is
        // implied: a stored uuid always comes with a stored label.)
        if d.volume_uuid.is_some() || d.volume_label.is_some() {
            None
        } else {
            find_by_name(Some(d.name.as_str()), vs, c)
        }
    });
    resolve_tier(drives, volumes, &mut claimed, &mut resolved, |d, vs, c| {
        // Same uuid gate as tier 2 — an unrelated volume mounted at the
        // drive's old `/Volumes/<name>` path is not the drive.
        if d.volume_uuid.is_some() {
            None
        } else {
            find_by_mount_path(d, vs, c)
        }
    });

    drives
        .iter()
        .zip(resolved)
        .map(|(d, m)| m.unwrap_or_else(|| PresenceMatch::unplugged(d.id)))
        .collect()
}

/// Runs one matching tier across every not-yet-resolved drive, in order,
/// claiming a volume as soon as `find` locates one for a drive — this is
/// what makes a whole tier "global": every drive gets a chance to match
/// with `find` before [`resolve_presence`] moves on to the next, weaker
/// tier, so a stronger-tier match elsewhere can never be pre-empted by a
/// weaker-tier match resolved earlier only because of list order.
fn resolve_tier(
    drives: &[Drive],
    volumes: &[Volume],
    claimed: &mut [bool],
    resolved: &mut [Option<PresenceMatch>],
    find: impl Fn(&Drive, &[Volume], &[bool]) -> Option<usize>,
) {
    for (i, drive) in drives.iter().enumerate() {
        if resolved[i].is_some() {
            continue;
        }
        if let Some(idx) = find(drive, volumes, claimed) {
            claimed[idx] = true;
            resolved[i] = Some(PresenceMatch::matched(drive.id, &volumes[idx]));
        }
    }
}

fn find_by_uuid(drive: &Drive, volumes: &[Volume], claimed: &[bool]) -> Option<usize> {
    let drive_uuid = drive.volume_uuid.as_deref()?;
    volumes
        .iter()
        .enumerate()
        .find(|(i, v)| !claimed[*i] && v.uuid.as_deref() == Some(drive_uuid))
        .map(|(i, _)| i)
}

fn find_by_name(name: Option<&str>, volumes: &[Volume], claimed: &[bool]) -> Option<usize> {
    let name = name?;
    volumes
        .iter()
        .enumerate()
        .find(|(i, v)| !claimed[*i] && v.name == name)
        .map(|(i, _)| i)
}

fn find_by_mount_path(drive: &Drive, volumes: &[Volume], claimed: &[bool]) -> Option<usize> {
    let mp = drive.mount_path.as_deref()?;
    volumes
        .iter()
        .enumerate()
        .find(|(i, v)| !claimed[*i] && v.mount_path == mp)
        .map(|(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dp_core::DriveRole;

    fn drive(id: i64, name: &str, mount_path: Option<&str>) -> Drive {
        Drive {
            id,
            name: name.to_string(),
            volume_uuid: None,
            volume_label: None,
            mount_path: mount_path.map(str::to_string),
            role: DriveRole::Source,
            capacity: 100,
            free: 10,
            last_seen_at: None,
            online: mount_path.is_some(),
        }
    }

    fn volume(name: &str, mount_path: &str, free_bytes: u64) -> Volume {
        Volume {
            name: name.to_string(),
            mount_path: mount_path.to_string(),
            total_bytes: 1_000,
            free_bytes,
            is_removable: true,
            uuid: None,
        }
    }

    fn volume_with_uuid(name: &str, mount_path: &str, free_bytes: u64, uuid: &str) -> Volume {
        Volume {
            uuid: Some(uuid.to_string()),
            ..volume(name, mount_path, free_bytes)
        }
    }

    #[test]
    fn matches_by_legacy_name_even_when_mount_path_changed() {
        let drives = vec![drive(1, "Kodachrome", Some("/Volumes/Old"))];
        let volumes = vec![volume("Kodachrome", "/Volumes/New", 42)];

        let got = resolve_presence(&drives, &volumes);

        assert_eq!(got[0].mount_path, Some("/Volumes/New".to_string()));
        assert_eq!(got[0].free_bytes, Some(42));
        assert_eq!(got[0].volume_label, Some("Kodachrome".to_string()));
    }

    #[test]
    fn falls_back_to_matching_by_prior_mount_path() {
        let drives = vec![drive(1, "Renamed Drive", Some("/Volumes/Kodachrome"))];
        let volumes = vec![volume("Kodachrome", "/Volumes/Kodachrome", 7)];

        let got = resolve_presence(&drives, &volumes);

        assert_eq!(got[0].mount_path, Some("/Volumes/Kodachrome".to_string()));
        assert_eq!(got[0].free_bytes, Some(7));
    }

    #[test]
    fn unplugged_drive_resolves_to_none() {
        let drives = vec![drive(1, "Kodachrome", Some("/Volumes/Kodachrome"))];
        let volumes: Vec<Volume> = vec![];

        let got = resolve_presence(&drives, &volumes);

        assert_eq!(
            got,
            vec![PresenceMatch {
                drive_id: 1,
                mount_path: None,
                free_bytes: None,
                volume_uuid: None,
                volume_label: None,
            }]
        );
    }

    /// The field-report bug this task fixes: a drive registered as
    /// "Backup" (the user's chosen name) whose underlying volume is
    /// actually named "Kodachrome" — `resolve_presence` must match on the
    /// stored `volume_label`, not the user-facing `name`, even though the
    /// user-facing name doesn't equal anything mounted.
    #[test]
    fn matches_a_renamed_drive_by_its_stored_volume_label_not_its_display_name() {
        let mut d = drive(1, "Backup", Some("/Volumes/Old"));
        d.volume_label = Some("Kodachrome".to_string());
        let volumes = vec![volume("Kodachrome", "/Volumes/Kodachrome", 99)];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(got[0].mount_path, Some("/Volumes/Kodachrome".to_string()));
        assert_eq!(got[0].free_bytes, Some(99));
    }

    #[test]
    fn uuid_match_beats_a_label_match() {
        let mut d = drive(1, "Backup", None);
        d.volume_uuid = Some("uuid-1".to_string());
        d.volume_label = Some("Wrong Label".to_string());
        // Two volumes: one matches the stale label, the other the uuid —
        // uuid must win even though it's listed second.
        let volumes = vec![
            volume("Wrong Label", "/Volumes/WrongLabel", 1),
            volume_with_uuid("Kodachrome", "/Volumes/Kodachrome", 2, "uuid-1"),
        ];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(got[0].mount_path, Some("/Volumes/Kodachrome".to_string()));
        assert_eq!(got[0].volume_uuid, Some("uuid-1".to_string()));
    }

    /// Two drives whose volumes share the same display name (e.g. two SD
    /// cards both still named "Untitled") must not both claim the first
    /// matching volume — each mounted volume can only satisfy one drive.
    #[test]
    fn two_same_label_volumes_do_not_double_claim() {
        let mut d1 = drive(1, "Card A", None);
        d1.volume_label = Some("Untitled".to_string());
        let mut d2 = drive(2, "Card B", None);
        d2.volume_label = Some("Untitled".to_string());
        let volumes = vec![
            volume("Untitled", "/Volumes/Untitled", 1),
            volume("Untitled", "/Volumes/Untitled 1", 2),
        ];

        let got = resolve_presence(&[d1, d2], &volumes);

        let mounts: Vec<_> = got.iter().map(|m| m.mount_path.clone()).collect();
        assert_eq!(
            mounts,
            vec![
                Some("/Volumes/Untitled".to_string()),
                Some("/Volumes/Untitled 1".to_string()),
            ]
        );
    }

    /// A single volume can never satisfy two drives — the second drive
    /// competing for an already-claimed volume is reported unplugged
    /// rather than double-matched.
    #[test]
    fn an_already_claimed_volume_never_matches_a_second_drive() {
        let mut d1 = drive(1, "Card A", None);
        d1.volume_label = Some("Untitled".to_string());
        let mut d2 = drive(2, "Card B", None);
        d2.volume_label = Some("Untitled".to_string());
        let volumes = vec![volume("Untitled", "/Volumes/Untitled", 1)];

        let got = resolve_presence(&[d1, d2], &volumes);

        assert_eq!(got[0].mount_path, Some("/Volumes/Untitled".to_string()));
        assert_eq!(got[1].mount_path, None);
    }

    /// A legacy drive (no `volume_uuid`/`volume_label` ever recorded)
    /// still matches by its display name once reconnected, and the match
    /// carries the volume's real identity so the presence watcher can
    /// self-heal the row.
    #[test]
    fn legacy_drive_match_carries_identity_for_self_healing() {
        let d = drive(1, "Kodachrome", None);
        let volumes = vec![volume_with_uuid(
            "Kodachrome",
            "/Volumes/Kodachrome",
            5,
            "uuid-legacy",
        )];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(got[0].volume_uuid, Some("uuid-legacy".to_string()));
        assert_eq!(got[0].volume_label, Some("Kodachrome".to_string()));
    }

    /// Review finding 2, gated side: a drive with a KNOWN `volume_label`
    /// must never fall through to the legacy name tier and bind an
    /// unrelated volume that merely happens to share the user's display
    /// name — e.g. a drive named "Backup" (whose own volume, labeled
    /// "MyBackupDrive", is absent) must not silently attach to an
    /// unrelated Time Machine volume that is actually named "Backup".
    #[test]
    fn a_drive_with_a_known_label_never_falls_back_to_matching_by_display_name() {
        let mut d = drive(1, "Backup", None);
        d.volume_label = Some("MyBackupDrive".to_string());
        // No volume named "MyBackupDrive" is mounted — only an unrelated
        // volume that happens to share the drive's *display* name.
        let volumes = vec![volume("Backup", "/Volumes/Backup", 1)];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(
            got[0].mount_path, None,
            "must stay unplugged, not bind the wrong volume"
        );
    }

    /// Review finding 2, ungated side: a drive with NO known `volume_label`
    /// (never matched since the column existed) still falls back to
    /// legacy `name == volume.name` matching, same as before this gate was
    /// added — `matches_by_legacy_name_even_when_mount_path_changed`
    /// above already covers this, but this test makes the "ungated" half
    /// explicit next to the gated one.
    #[test]
    fn a_drive_with_no_known_label_still_matches_by_legacy_display_name() {
        let d = drive(1, "Kodachrome", None);
        let volumes = vec![volume("Kodachrome", "/Volumes/Kodachrome", 1)];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(got[0].mount_path, Some("/Volumes/Kodachrome".to_string()));
    }

    /// Security (issue #30): a drive whose row holds a `volume_uuid` must
    /// never be adopted by a look-alike volume via the label tier — a
    /// physically attached volume sharing the label but carrying a
    /// different uuid is an impostor, not the drive.
    #[test]
    fn a_uuid_holding_drive_never_matches_a_same_label_volume_with_a_different_uuid() {
        let mut d = drive(1, "Kodachrome", None);
        d.volume_uuid = Some("uuid-real".to_string());
        d.volume_label = Some("Kodachrome".to_string());
        let volumes = vec![volume_with_uuid(
            "Kodachrome",
            "/Volumes/Kodachrome",
            1,
            "uuid-impostor",
        )];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(
            got[0].mount_path, None,
            "must stay unplugged, not adopt the impostor volume"
        );
    }

    /// Security (issue #30): same as above but the look-alike volume has
    /// no readable uuid at all (exFAT/FAT32, or a transient `diskutil`
    /// failure) — still not enough to claim a drive whose true identity
    /// is a recorded uuid.
    #[test]
    fn a_uuid_holding_drive_never_matches_a_same_label_volume_with_no_uuid() {
        let mut d = drive(1, "Kodachrome", None);
        d.volume_uuid = Some("uuid-real".to_string());
        d.volume_label = Some("Kodachrome".to_string());
        let volumes = vec![volume("Kodachrome", "/Volumes/Kodachrome", 1)];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(got[0].mount_path, None);
    }

    /// Security (issue #30): the mount-path tier is gated the same way —
    /// a different volume mounted at the drive's old `/Volumes/<name>`
    /// path must not be adopted just for landing on that path.
    #[test]
    fn a_uuid_holding_drive_never_matches_by_its_old_mount_path() {
        let mut d = drive(1, "Kodachrome", Some("/Volumes/Kodachrome"));
        d.volume_uuid = Some("uuid-real".to_string());
        d.volume_label = Some("Kodachrome".to_string());
        let volumes = vec![volume_with_uuid(
            "Other Label",
            "/Volumes/Kodachrome",
            1,
            "uuid-impostor",
        )];

        let got = resolve_presence(&[d], &volumes);

        assert_eq!(got[0].mount_path, None);
    }

    /// Review finding 3 — the "steal" scenario: drive "Aaa" only has a
    /// (stale) label match, drive "Bbb" holds the volume's actual uuid.
    /// Even though "Aaa" is resolved first in `drives`, "Bbb" — the
    /// stronger claim — must win the volume; "Aaa" must be left unplugged
    /// rather than stealing it via a weaker tier resolved earlier.
    #[test]
    fn a_stronger_tier_match_can_never_be_stolen_by_a_weaker_tier_resolved_earlier() {
        let mut aaa = drive(1, "Aaa", None);
        aaa.volume_label = Some("Untitled".to_string());
        let mut bbb = drive(2, "Bbb", None);
        bbb.volume_uuid = Some("U".to_string());

        let volumes = vec![volume_with_uuid("Untitled", "/Volumes/Untitled", 1, "U")];

        let got = resolve_presence(&[aaa, bbb], &volumes);

        assert_eq!(
            got[0].mount_path, None,
            "Aaa (weaker tier) must not steal the volume"
        );
        assert_eq!(
            got[1].mount_path,
            Some("/Volumes/Untitled".to_string()),
            "Bbb (uuid owner) must win it"
        );
    }
}
