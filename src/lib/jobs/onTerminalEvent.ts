import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { JobEvent } from "@/lib/api/scan";

/** Every query key a completed scan/organize/revert job could have changed the data behind. */
const INVALIDATE_KEYS: readonly (readonly string[])[] = [
  ["media"],
  ["media-count"],
  // A scan can mark rows missing or clear that mark (`reconcile_missing`),
  // which shifts both the toolbar's global "Missing (N)" chip count and
  // `DriveCard`'s per-drive "Remove missing…" count (`["missing-count",
  // "drive", driveId]`, matched by this prefix) — without this, either
  // count would only catch up on the next refocus or remount.
  ["missing-count"],
  ["jobs"],
  ["unorganized"],
  ["drives"],
  // A scan's failures land in `scan_errors`, and `DriveCard` gates its
  // "Errors…" dropdown item on this count — without refreshing it here, a
  // just-finished scan's new failures stay invisible in the dropdown until
  // a refocus or remount.
  ["scan-error-count"],
  // The row list `ScanErrorsDialog` pages through (`["scan-errors",
  // driveId]`) — matched by this prefix. Without it, reopening the dialog
  // after a second scan shows a freshly-invalidated header count next to
  // stale cached rows.
  ["scan-errors"],
  // The severity repartition `ScanErrorsDialog`'s header and
  // `ScanProgress`'s failed-count hover card both read (`["scan-error-code-
  // counts", driveId]`) — without this, a second scan's fresh failures
  // wouldn't shift either one's per-severity counts until a refocus or
  // remount, same reasoning as `["scan-error-count"]` above.
  ["scan-error-code-counts"],
];

/**
 * Handles one job's terminal `JobEvent` — `finished` or `cancelled` — from
 * `JobEventsBridge`'s single global listener: invalidates every query a
 * completed job could have changed, and shows exactly one toast for it.
 * `started`/`progress`/`item_error` events are no-ops; only a job's own
 * terminal event should invalidate or toast, never a per-item one.
 *
 * A sidecar sync, geocode sweep, or preview-regen sweep (`job_id` prefixed
 * `"sidecar-"`, `"geocode-"`, or `"regen-"`) is handled first and quite
 * differently, because all three are background sweeps nobody explicitly
 * asked for in the moment (even the regen sweep, though the user did
 * trigger it, is a long-running maintenance pass, not something with a
 * result to review). A sidecar sync writes `.xmp` files on disk, clears a
 * flag no query here reads, and can import externally-edited subjects
 * into the catalog, and either can shift a drive's tagged/pending
 * counts — so only the tag and sidecar-health queries are refreshed. A
 * geocode sweep assigns `place_id`s — so only the place, search, and media
 * queries are refreshed. A regen sweep only ever rewrites cached preview
 * bytes in place (same hash, same dimensions on disk elsewhere) — so only
 * the storage-usage query (Settings' storage panel) is refreshed. Either
 * way, refetching the whole gallery after every sweep would be pure churn
 * and is skipped. All three are silent on success, so none interrupts
 * whatever the user's actually doing; a failure still surfaces as the
 * usual error toast, the one outcome worth knowing about unprompted.
 */
export function onTerminalEvent(event: JobEvent, queryClient: QueryClient, label: string): void {
  if (event.kind !== "finished" && event.kind !== "cancelled") return;

  const isSidecarSync = event.job_id.startsWith("sidecar-");
  const isGeocode = event.job_id.startsWith("geocode-");
  const isRegen = event.job_id.startsWith("regen-");
  const isScan = event.job_id.startsWith("scan-");

  if (isSidecarSync) {
    // The sweep can import externally-added subjects into the catalog
    // (see `merged_names` in dp-jobs), so the tag queries — and only
    // those — are refreshed; the gallery grid itself is untouched. Every
    // written/cleared row also shifts the SIDECARS panel's per-drive
    // tagged/pending counts (`["sidecar-health", driveId]`, matched by
    // this prefix), so that's refreshed too.
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["media-tags"] });
    queryClient.invalidateQueries({ queryKey: ["sidecar-health"] });
    if (event.failed === 0) return;
  } else if (isGeocode) {
    // The sweep only ever assigns `place_id`s (never touches tags or
    // anything else), so just the place, search, and media queries are
    // refreshed.
    queryClient.invalidateQueries({ queryKey: ["places"] });
    queryClient.invalidateQueries({ queryKey: ["search"] });
    queryClient.invalidateQueries({ queryKey: ["media"] });
    if (event.failed === 0) return;
  } else if (isRegen) {
    // Only cached preview bytes on disk changed — nothing the gallery,
    // tag, or place queries read.
    queryClient.invalidateQueries({ queryKey: ["storage-usage"] });
    if (event.failed === 0) return;
  } else {
    for (const queryKey of INVALIDATE_KEYS) {
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
    }
  }

  if (event.kind === "cancelled") {
    toast(`${label} cancelled — ${event.ok} file${event.ok === 1 ? "" : "s"} done`);
    return;
  }

  const total = event.ok + event.skipped;
  if (event.failed === 0) {
    toast.success(`${label} finished — ${total} file${total === 1 ? "" : "s"}`);
  } else {
    const errorWord = `error${event.failed === 1 ? "" : "s"}`;
    // A scan's failures land in that drive's `scan_errors` table, browsable
    // via `ScanErrorsDialog` — point the toast at it instead of leaving
    // "a huge amount of errors but no reason, no place to check the
    // errors" (Task 5b.4's field report). Organize/revert (and the
    // sidecar/geocode/regen sweeps, handled above) have no such browser.
    if (isScan) {
      toast.error(
        `${label} finished with ${event.failed} ${errorWord} — see the drive's Errors list`,
      );
    } else {
      toast.error(`${label} finished with ${event.failed} ${errorWord}`);
    }
  }
}
