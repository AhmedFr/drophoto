import { invokeApi } from "./client";

export type DriveRole = "source" | "archive";

export type Drive = {
  id: number;
  name: string;
  volume_uuid: string | null;
  /** The mounted volume's own display name as of the last presence match — independent of `name`. */
  volume_label: string | null;
  mount_path: string | null;
  role: DriveRole;
  capacity: number;
  free: number;
  last_seen_at: string | null;
  online: boolean;
};

export type RegisterDriveInput = {
  name: string;
  mount_path: string;
  role: DriveRole;
  capacity: number;
  free: number;
  /** The volume's own uuid/name at registration time, captured independently of `name` — see `Drive.volume_label`. */
  volume_uuid?: string | null;
  volume_label?: string | null;
};

export const registerDrive = (input: RegisterDriveInput) =>
  invokeApi<Drive>("register_drive", { input });

export const listDrives = () => invokeApi<Drive[]>("list_drives");

/** Permanently deletes `driveId` and everything in the catalog that references it (see `forget_drive`). Never touches the filesystem. */
export const forgetDrive = (driveId: number) => invokeApi<void>("forget_drive", { driveId });

/** How many media rows `driveId` currently has — for the FORGET confirmation dialog's "removes N photos" message. */
export const countDriveMedia = (driveId: number) =>
  invokeApi<number>("count_drive_media", { driveId });

/** How many of `driveId`'s media rows are currently marked missing (`missing_at` set) — gates the "Remove missing… (N)" item in the drive actions dropdown. */
export const countMissingMedia = (driveId: number) =>
  invokeApi<number>("count_missing_media", { driveId });

/**
 * Permanently deletes every catalog row on `driveId` currently marked
 * missing — the "Remove missing…" danger-zone action. Catalog rows only:
 * never touches the filesystem (the whole point is these files are
 * already gone from disk), and thumbnails stay in the shared thumb store,
 * same as `forgetDrive`. Returns how many rows were actually removed.
 */
export const removeMissingMedia = (driveId: number) =>
  invokeApi<number>("remove_missing_media", { driveId });

/**
 * Adopts the mounted volume at `mountPath` into `driveId`, overwriting its
 * stored identity and bringing it online — the RELINK action on an
 * offline `DriveCard`, for a drive whose stored identity no longer
 * matches anything currently mounted. Preserves the drive's id (and every
 * media/source/tag/organize-history row that references it), unlike
 * Forget + re-register.
 */
export const relinkDrive = (driveId: number, mountPath: string) =>
  invokeApi<void>("relink_drive", { driveId, mountPath });
