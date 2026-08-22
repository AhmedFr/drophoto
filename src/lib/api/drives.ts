import { invokeApi } from "./client";

export type DriveRole = "source" | "archive";

export type Drive = {
  id: number;
  name: string;
  volume_uuid: string | null;
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
};

export const registerDrive = (input: RegisterDriveInput) =>
  invokeApi<Drive>("register_drive", { input });

export const listDrives = () => invokeApi<Drive[]>("list_drives");
