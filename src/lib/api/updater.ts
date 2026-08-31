import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** The one fact `useUpdater` (and the startup silent check) needs about an available update. */
export type UpdateInfo = { version: string; notes: string | null };

/**
 * The `Update` resource returned by the last `checkForUpdate()` call that
 * actually found one — `downloadAndInstallUpdate` reuses it rather than
 * calling `check()` a second time, since the plugin's `Update` object
 * (not `UpdateInfo`) is what carries the downloadable artifact. Module-level
 * because there's exactly one update check in flight for the whole app at
 * once; a fresh `checkForUpdate()` call always replaces it.
 */
let pendingUpdate: Update | null = null;

/**
 * Checks the configured endpoint for a newer release. Resolves `null` both
 * when the app is already current and when the check itself fails (e.g. the
 * updater `pubkey` is still the `UPDATER_PUBKEY_TBD` placeholder, which the
 * plugin rejects) — callers can't tell those two apart from this call alone,
 * which is intentional: neither is worth more than a quiet "can't tell right
 * now" in the UI (see `useUpdater`'s `error` state, driven separately).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  // Best-effort: releases the previous check's Rust-side resource (if any)
  // now that it's about to be replaced and unreachable — a re-check (the
  // manual "Check for updates" button, or the startup check racing a
  // Settings-page mount) would otherwise leak one `Update` handle per call.
  // Never worth failing the new check over.
  pendingUpdate?.close().catch(() => {});
  pendingUpdate = update;
  if (!update) return null;
  return { version: update.version, notes: update.body ?? null };
}

/**
 * Downloads and installs the update found by the most recent
 * `checkForUpdate()` call, reporting whole-percent progress as bytes arrive.
 * Throws if no update is pending (callers only reach this from the
 * `available` state, which implies one is).
 */
export async function downloadAndInstallUpdate(onProgress: (percent: number) => void): Promise<void> {
  const update = pendingUpdate;
  if (!update) throw new Error("No update available to install.");

  let contentLength = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      contentLength = event.data.contentLength ?? 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0);
    } else if (event.event === "Finished") {
      onProgress(100);
    }
  });
}

/** Exits and relaunches the app — call once `downloadAndInstallUpdate` resolves. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}

/** The running app's own version, e.g. `"0.3.0"` — shown as `Current: v0.3.0` in `UpdatesSection`. */
export async function getCurrentVersion(): Promise<string> {
  return getVersion();
}
