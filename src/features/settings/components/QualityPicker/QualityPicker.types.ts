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
  /** Durable — derived by the caller as `settings.preview_edge < PREVIEW_EDGES.max`, not a one-shot flag from a command response. Shows the regenerate-previews prompt whenever the persisted setting is below max. */
  regenApplicable: boolean;
  /** Whether a `regen-*` job is currently running — disables the regenerate-previews button and relabels it. */
  regenRunning: boolean;
  onRegen: () => void;
};

export type QualityStep = { quality: PreviewQuality; edge: number; label: string };
