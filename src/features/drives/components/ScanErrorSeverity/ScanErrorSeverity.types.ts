/** How urgent a `scan_errors` `code` reads to the user — see `severityForCode`. */
export type ScanErrorSeverityLevel = "critical" | "error" | "warning" | "info";

/** One `code`'s resolved severity: its level plus the Tailwind classes `ScanErrorsDialog`'s
 * code chips and `ScanProgress`'s hover-card dots render it with. */
export type ScanErrorSeverityInfo = {
  level: ScanErrorSeverityLevel;
  /** Human-readable label, e.g. for the hover card's "2 critical" rows. */
  label: string;
  /** Text-color class for a code chip. */
  textClass: string;
  /** Background-color class for a hover-card repartition dot. */
  dotClass: string;
};
