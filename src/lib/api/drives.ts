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
export const countDriveMedia = (driveId: number) => invokeApi<number>("count_drive_media", { driveId });
