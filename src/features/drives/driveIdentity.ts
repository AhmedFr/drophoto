import type { Drive } from "@/lib/api/drives";
import type { Volume } from "@/lib/api/volumes";

/**
 * Whether `volume` is already claimed by a registered drive — by uuid, by
 * its own display name, or by its current mount_path — mirroring the
 * backend's `relink_drive` refusal check (`volume_claimed_by_another_drive`
 * in `src-tauri/src/commands/drives.rs`, including its re-review-round-2
 * mount_path arm and its `exclude_drive_id`). Used to filter the RELINK
 * dialog's candidate list down to volumes that wouldn't just be refused by
 * the command anyway, so the user never picks an option guaranteed to
 * fail. The mount_path check covers the same narrow just-reconnected
 * window the backend's does: a drive matched only via `resolve_presence`'s
 * prior-mount-path tier is online at that path before its uuid/label are
 * backfilled for that tick.
 *
 * `excludeDriveId`, when given, mirrors the backend's `exclude_drive_id`:
 * the drive actually being relinked never disqualifies its own candidate
 * volumes (e.g. a match on its own still-recorded `mount_path`). Optional
 * because `driveIdentity`'s other reasonable use (asking "is this volume
 * claimed by *any* drive?", with no specific drive to exempt) has no drive
 * to exclude.
 */
export function isVolumeClaimedByAnotherDrive(
  volume: Volume,
  drives: Drive[],
  excludeDriveId?: number,
): boolean {
  return drives.some(
    (d) =>
      d.id !== excludeDriveId &&
      ((volume.uuid != null && d.volume_uuid === volume.uuid) ||
        (d.volume_label != null && d.volume_label === volume.name) ||
        (d.mount_path != null && d.mount_path === volume.mount_path)),
  );
}
