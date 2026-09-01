import type { ToolHealth } from "@/lib/api/settings";

export type ToolsSectionProps = {
  /** Startup snapshot of where exiftool/ffmpeg were found; `null` while the query is still loading. */
  tools: ToolHealth | null;
  loading: boolean;
  /** The `tool_health` query's rejection message, if it failed — shown instead of the neutral unavailable state. */
  error: string | null;
};
