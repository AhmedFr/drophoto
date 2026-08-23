import { invokeApi } from "./client";

export type Source = {
  id: number;
  drive_id: number;
  rel_path: string;
  enabled: boolean;
};

export type DetectedFolder = {
  rel_path: string;
  media_count: number;
  bytes: number;
  suggested: boolean;
};

export const detectSources = (driveId: number) =>
  invokeApi<DetectedFolder[]>("detect_sources", { driveId });

export const listSources = (driveId: number) => invokeApi<Source[]>("list_sources", { driveId });

export const saveSources = (driveId: number, relPaths: string[]) =>
  invokeApi<void>("save_sources", { driveId, relPaths });

export const setSourceEnabled = (sourceId: number, enabled: boolean) =>
  invokeApi<void>("set_source_enabled", { sourceId, enabled });
