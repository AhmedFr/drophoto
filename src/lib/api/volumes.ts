import { invokeApi } from "./client";

export type Volume = {
  name: string;
  mount_path: string;
  total_bytes: number;
  free_bytes: number;
  is_removable: boolean;
  /** The volume's Apple `VolumeUUID` (macOS only) — `null` on every other platform, or when it couldn't be read. */
  uuid: string | null;
};

export const listVolumes = () => invokeApi<Volume[]>("list_volumes");
