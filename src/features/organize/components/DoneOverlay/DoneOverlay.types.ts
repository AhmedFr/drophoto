export type DoneOverlayProps = {
  moved: number;
  skipped: number;
  failed: number;
  /** The active drive's `file_tpl`, shown as "Renamed to {fileTpl}". */
  fileTpl: string;
  /** Destination folders the run filed photos into; only the first three are shown. */
  folders: string[];
  /** Shown next to "Filed into…" while `folders` is still the pre-run plan, not the confirmed result. */
  foldersHint?: string | null;
};
