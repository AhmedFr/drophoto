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
}

/// Matches each `drive` against the currently-mounted `volumes`, returning
/// where each one should say it lives right now.
///
/// A drive is matched to a volume by, in order (first match wins):
/// 1. `drive.volume_uuid == volume.uuid` (both `Some`) — the strongest
///    signal, since a volume's Apple `VolumeUUID` survives both a rename
///    and a remount at a different path.
/// 2. `drive.volume_label == volume.name` — the volume's own display name
///    at last match, independent of the user-chosen `drive.name` shown in
///    the UI (this is the bug this order fixes: a drive renamed at
///    registration used to only ever match on `drive.name`, so
///    reconnecting it looked like a brand-new volume).
/// 3. Legacy `drive.name == volume.name` — kept for a drive registered
///    before `volume_label` existed and never since matched (so it has
///    no `volume_label` to match tier 2 against) *and* whose display name
///    still happens to equal the volume's.
/// 4. `drive.mount_path == volume.mount_path` — the drive's previously
///    known mount point, for a drive whose name (chosen or volume) no
///    longer matches anything, e.g. the volume was renamed at the OS
///    level.
///
/// A volume already claimed by an earlier drive in `drives` can never
/// match a second one — each volume is claimed by at most one drive.
/// A drive with no matching volume is reported unplugged.
pub fn resolve_presence(drives: &[Drive], volumes: &[Volume]) -> Vec<PresenceMatch> {
    let mut claimed = vec![false; volumes.len()];

    drives
        .iter()
        .map(|drive| {
            let idx = find_by_uuid(drive, volumes, &claimed)
                .or_else(|| find_by_name(drive.volume_label.as_deref(), volumes, &claimed))
                .or_else(|| find_by_name(Some(drive.name.as_str()), volumes, &claimed))
                .or_else(|| find_by_mount_path(drive, volumes, &claimed));

            match idx {
                Some(i) => {
                    claimed[i] = true;
                    let v = &volumes[i];
                    PresenceMatch {
                        drive_id: drive.id,
                        mount_path: Some(v.mount_path.clone()),
                        free_bytes: Some(v.free_bytes),
                        volume_uuid: v.uuid.clone(),
                        volume_label: Some(v.name.clone()),
                    }
                }
                None => PresenceMatch::unplugged(drive.id),
            }
        })
        .collect()
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
}
