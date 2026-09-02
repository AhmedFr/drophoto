import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { toolHealth, type ToolHealth } from "@/lib/api/settings";

/**
 * Renderless, mounted exactly once in `AppShell` (alongside
 * `UpdateNotifier`, whose startup-check shape this copies) — warns once
 * per app run when an external tool's version sits below its security
 * floor (issue #29: `exiftool`/`ffmpeg` parse untrusted media off
 * attached drives, and outdated builds have known RCEs from crafted
 * files, e.g. exiftool CVE-2021-22204). The toast's action navigates to
 * `/settings`, where `ToolsSection` shows the full detail and the
 * `brew upgrade` remediation — this component never blocks anything:
 * scans still run, matching the warn-only decision in the spec.
 *
 * A failed `tool_health` query is swallowed silently: Settings' own
 * `toolsError` state is where that failure surfaces, and a startup nag
 * about a health *query* would drown the actual signal. A *missing* tool
 * isn't toasted either — it already breaks loudly in `scan_errors` and
 * ToolsSection's red state; the outdated case is the one failure mode
 * that is otherwise silent.
 */
// A plain (non-literal) `string` — same widened-path reasoning as
// `UpdateNotifier`'s SETTINGS_PATH (the route tree only types `string`).
const SETTINGS_PATH: string = "/settings";

/** The `"name version"` labels of every outdated tool, in display order. */
function outdatedLabels(health: ToolHealth): string[] {
  return (["exiftool", "ffmpeg"] as const)
    .filter((name) => health[name].outdated)
    .map((name) => `${name} ${health[name].version}`);
}

export function ToolHealthNotifier() {
  const navigate = useNavigate();
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    toolHealth()
      .then((health) => {
        const labels = outdatedLabels(health);
        if (labels.length === 0) return;
        const verb = labels.length === 1 ? "is" : "are";
        toast.warning(
          `${labels.join(" and ")} ${verb} outdated and unsafe on untrusted files — see Settings → Tools`,
          { action: { label: "View", onClick: () => navigate({ to: SETTINGS_PATH }) } },
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
