import type { ToolStatus } from "@/lib/api/settings";
import type { ToolsSectionProps } from "./ToolsSection.types";

/** One external tool's display row: its status, what breaks without it, and the version floor it must meet. */
type ToolRow = {
  name: "exiftool" | "ffmpeg";
  status: ToolStatus;
  /** What stops working while the tool is missing — shown in the red state. */
  missingConsequence: string;
  /**
   * The tool's security floor, shared *by value* with
   * `dp_metadata::MIN_EXIFTOOL`/`MIN_FFMPEG` (which compute the `outdated`
   * flag) — keep both in sync. Only rendered in the warning copy; the
   * comparison itself happens on the Rust side.
   */
  securityFloor: string;
};

/**
 * Settings' external-tools health panel. drophoto shells out to `exiftool`
 * (photo/video metadata, tag sidecars) and `ffmpeg` (video thumbnails and
 * durations); a bundled, Finder-launched app doesn't inherit the
 * terminal's `PATH`, so these are resolved at startup across `$PATH` plus
 * the Homebrew/MacPorts install dirs (see `dp_metadata::resolve_tool`),
 * and their versions are probed against per-tool security floors — both
 * tools parse untrusted media off attached drives, and outdated builds
 * have known RCEs from crafted files (issue #29). This panel shows where
 * each landed and, in amber, the upgrade one-liner when a version sits
 * below its floor — or, in red, what's broken and the `brew install`
 * one-liner that fixes a missing tool. The snapshot is from app launch:
 * installing or upgrading a tool while the app runs needs a relaunch to
 * register.
 */
export function ToolsSection({ tools, loading, error }: ToolsSectionProps) {
  const rows: ToolRow[] | null = tools
    ? [
        {
          name: "exiftool",
          status: tools.exiftool,
          missingConsequence: "photo metadata and tag sidecars won't be read or written",
          securityFloor: "12.24",
        },
        {
          name: "ffmpeg",
          status: tools.ffmpeg,
          missingConsequence: "video thumbnails and durations won't be generated",
          securityFloor: "6.0",
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
              <ToolReadout row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Tool status unavailable.</p>
      )}
    </div>
  );
}

/** The per-tool status readout: missing (red), outdated (amber), or found (muted, with version when known). */
function ToolReadout({ row }: { row: ToolRow }) {
  const { path, version, outdated } = row.status;

  if (path === null) {
    return (
      <span className="font-mono text-[10px] text-red-400">
        missing — {row.missingConsequence}; install with{" "}
        <span className="select-all">brew install {row.name}</span>, then relaunch drophoto
      </span>
    );
  }

  if (outdated) {
    return (
      <span className="font-mono text-[10px] text-amber-400">
        v{version} is below the security floor ({row.securityFloor}) — versions this old have known
        vulnerabilities parsing untrusted files; update with{" "}
        <span className="select-all">brew upgrade {row.name}</span>, then relaunch drophoto
      </span>
    );
  }

  return (
    <span className="truncate font-mono text-[10px] text-muted-foreground" title={path}>
      found at {path} · {version ? `v${version}` : "version unknown"}
    </span>
  );
}
