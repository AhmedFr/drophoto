import type { ToolHealth } from "@/lib/api/settings";

/** Data for the Settings "Maintenance" group's `ToolsSection`. */
export type UseToolHealthDataResult = {
  /** Startup snapshot of where exiftool/ffmpeg were found — `null` until the `tool_health` query resolves. */
  tools: ToolHealth | null;
  toolsLoading: boolean;
  toolsError: string | null;
};
