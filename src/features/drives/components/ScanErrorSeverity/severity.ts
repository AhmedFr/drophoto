import type { ScanErrorSeverityInfo, ScanErrorSeverityLevel } from "./ScanErrorSeverity.types";

/**
 * Every `scan_errors` `code` this app currently records, mapped to a
 * severity — the single source of truth (frontend-only; the backend just
 * stores the stable code strings, see `dp_jobs::error_code`) for how
 * urgent a code reads. A code missing from this map (a future addition,
 * or a stray value) falls back to `"error"` in [`severityForCode`] rather
 * than silently reading as the mildest level.
 */
const SEVERITY_BY_CODE: Record<string, ScanErrorSeverityLevel> = {
  db: "critical",
  io: "error",
  not_found: "error",
  sidecar: "warning",
  unsupported: "info",
};

const SEVERITY_STYLE: Record<ScanErrorSeverityLevel, Omit<ScanErrorSeverityInfo, "level">> = {
  critical: { label: "critical", textClass: "text-red-400", dotClass: "bg-red-400" },
  error: { label: "error", textClass: "text-orange-400", dotClass: "bg-orange-400" },
  warning: { label: "warning", textClass: "text-yellow-400", dotClass: "bg-yellow-400" },
  info: { label: "info", textClass: "text-faint", dotClass: "bg-faint" },
};

/**
 * Resolves a `scan_errors` `code` to its severity and display styling.
 * Renders `ScanErrorsDialog`'s per-row code chips and (grouped, via
 * `scanErrorCodeCounts`) `ScanProgress`'s failed-count hover-card
 * repartition and `ScanErrorsDialog`'s header counts.
 */
export function severityForCode(code: string): ScanErrorSeverityInfo {
  const level = SEVERITY_BY_CODE[code] ?? "error";
  return { level, ...SEVERITY_STYLE[level] };
}

/**
 * The display styling (label + Tailwind classes) for a severity level on
 * its own — for callers that group `scan_errors` by severity first (e.g.
 * `ScanErrorsDialog`'s header, `ScanProgress`'s hover-card repartition)
 * rather than looking a single code up via [`severityForCode`].
 */
export function styleForLevel(level: ScanErrorSeverityLevel): Omit<ScanErrorSeverityInfo, "level"> {
  return SEVERITY_STYLE[level];
}
