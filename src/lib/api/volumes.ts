import { invokeApi } from "./client";

export type Volume = {
  name: string;
  mount_path: string;
  total_bytes: number;
  free_bytes: number;
  is_removable: boolean;
};

export const listVolumes = () => invokeApi<Volume[]>("list_volumes");
