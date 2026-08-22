use dp_core::{Drive, Volume};

/// Matches each `drive` against the currently-mounted `volumes`, returning
/// `(drive.id, mount_path, free_bytes)` triples describing where that drive
/// should say it lives right now.
///
/// A drive is matched to a volume by `volume.name == drive.name` first,
/// falling back to `volume.mount_path == drive.mount_path` (the drive's
/// previously-known mount point) when no volume shares its name. A drive
/// with no matching volume is reported unplugged: `(id, None, None)`.
pub fn resolve_presence(drives: &[Drive], volumes: &[Volume]) -> Vec<(i64, Option<String>, Option<u64>)> {
    drives
        .iter()
        .map(|drive| {
            let matched = volumes.iter().find(|v| v.name == drive.name).or_else(|| {
                drive
                    .mount_path
                    .as_deref()
                    .and_then(|mp| volumes.iter().find(|v| v.mount_path == mp))
            });
            match matched {
                Some(v) => (drive.id, Some(v.mount_path.clone()), Some(v.free_bytes)),
                None => (drive.id, None, None),
            }
        })
        .collect()
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
        }
    }

    #[test]
    fn matches_by_name_even_when_mount_path_changed() {
        let drives = vec![drive(1, "Kodachrome", Some("/Volumes/Old"))];
        let volumes = vec![volume("Kodachrome", "/Volumes/New", 42)];

        let got = resolve_presence(&drives, &volumes);

        assert_eq!(got, vec![(1, Some("/Volumes/New".to_string()), Some(42))]);
    }

    #[test]
    fn falls_back_to_matching_by_prior_mount_path() {
        let drives = vec![drive(1, "Renamed Drive", Some("/Volumes/Kodachrome"))];
        let volumes = vec![volume("Kodachrome", "/Volumes/Kodachrome", 7)];

        let got = resolve_presence(&drives, &volumes);

        assert_eq!(got, vec![(1, Some("/Volumes/Kodachrome".to_string()), Some(7))]);
    }

    #[test]
    fn unplugged_drive_resolves_to_none() {
        let drives = vec![drive(1, "Kodachrome", Some("/Volumes/Kodachrome"))];
        let volumes: Vec<Volume> = vec![];

        let got = resolve_presence(&drives, &volumes);

        assert_eq!(got, vec![(1, None, None)]);
    }
}
