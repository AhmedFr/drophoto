import type { PreviewQuality } from "@/lib/api/settings";

export type QualityPickerProps = {
  /** The currently persisted `preview_edge` — used both to pre-select the radio and to decide staged-vs-current copy/direction. */
  currentEdge: number;
  /** Current on-disk preview bytes (`storage_usage().previews_bytes`), the base the size estimate scales from. `null` while storage usage hasn't loaded yet — estimates are hidden until it has. */
  previewsBytes: number | null;
  /** Whether `set_preview_quality` is in flight — disables the picker and the Apply button. */
  applying: boolean;
  /** Called with the newly staged edge (px) when Apply is clicked. */
  onApply: (edge: number) => void;
  /** Whether the last `set_preview_quality` call reported a regen is applicable (a downscale with cached previews to shrink) — shows the regenerate-previews prompt. */
  regenApplicable: boolean;
  /** Whether a `regen-*` job is currently running — disables the regenerate-previews button and relabels it. */
  regenRunning: boolean;
  onRegen: () => void;
};

export type QualityStep = { quality: PreviewQuality; edge: number; label: string };
