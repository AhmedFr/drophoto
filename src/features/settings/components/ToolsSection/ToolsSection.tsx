import type { ToolsSectionProps } from "./ToolsSection.types";

/** One external tool's display row: its name, what breaks without it, and the brew formula that installs it. */
type ToolRow = {
  name: "exiftool" | "ffmpeg";
  /** Resolved absolute path, or `null` when the tool wasn't found anywhere. */
  path: string | null;
  /** What stops working while the tool is missing — shown in the red state. */
  missingConsequence: string;
};

/**
 * Settings' external-tools health panel. drophoto shells out to `exiftool`
 * (photo/video metadata, tag sidecars) and `ffmpeg` (video thumbnails and
 * durations); a bundled, Finder-launched app doesn't inherit the
 * terminal's `PATH`, so these are resolved at startup across `$PATH` plus
 * the Homebrew/MacPorts install dirs (see `dp_metadata::resolve_tool`).
 * This panel shows where each landed — or, in red, what's broken and the
 * `brew install` one-liner that fixes it. The snapshot is from app launch:
 * installing a tool while the app runs needs a relaunch to register.
 */
export function ToolsSection({ tools, loading, error }: ToolsSectionProps) {
  const rows: ToolRow[] | null = tools
    ? [
        {
          name: "exiftool",
          path: tools.exiftool,
          missingConsequence: "photo metadata and tag sidecars won't be read or written",
        },
        {
          name: "ffmpeg",
          path: tools.ffmpeg,
          missingConsequence: "video thumbnails and durations won't be generated",
        },
      ]
    : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">TOOLS</span>
      </div>

      {error && <p className="px-6 pb-2 font-mono text-[11px] text-red-400">{error}</p>}

      {loading && !rows ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Checking tools…</p>
      ) : rows ? (
        <ul className="flex flex-col gap-1.5 px-6 pb-6">
          {rows.map((row) => (
            <li key={row.name} className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] text-foreground">{row.name}</span>
              {row.path ? (
                <span className="truncate font-mono text-[10px] text-muted-foreground" title={row.path}>
                  found at {row.path}
                </span>
              ) : (
                <span className="font-mono text-[10px] text-red-400">
                  missing — {row.missingConsequence}; install with{" "}
                  <span className="select-all">brew install {row.name}</span>, then relaunch drophoto
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Tool status unavailable.</p>
      )}
    </div>
  );
}
