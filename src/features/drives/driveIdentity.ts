import type { Drive } from "@/lib/api/drives";
import type { Volume } from "@/lib/api/volumes";

/**
 * Whether `volume` is already claimed by a registered drive — by uuid or
 * by its own display name — mirroring the backend's `relink_drive`
 * refusal check (`volume_claimed_by_another_drive` in
 * `src-tauri/src/commands/drives.rs`). Used to filter the RELINK dialog's
 * candidate list down to volumes that wouldn't just be refused by the
 * command anyway, so the user never picks an option guaranteed to fail.
 */
export function isVolumeClaimedByAnotherDrive(volume: Volume, drives: Drive[]): boolean {
  return drives.some(
    (d) =>
      (volume.uuid != null && d.volume_uuid === volume.uuid) ||
      (d.volume_label != null && d.volume_label === volume.name),
  );
}
