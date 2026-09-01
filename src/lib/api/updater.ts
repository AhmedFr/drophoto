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
 * Set for the duration of `downloadAndInstallUpdate`. Guards against the
 * scenario where remounting `useUpdater` (e.g. navigating away from
 * Settings and back) fires a fresh `checkForUpdate()` while a download
 * started from the *previous* mount is still streaming: without this flag,
 * that re-check would `close()` the very `Update` resource the download is
 * reading from and abort an otherwise-healthy install.
 */
let isDownloading = false;

/**
 * Checks the configured endpoint for a newer release. Resolves `null` when
 * the app is already current; propagates a rejection when the check itself
 * fails (e.g. the updater `pubkey` is still the `UPDATER_PUBKEY_TBD`
 * placeholder, which the plugin rejects) — callers map that into their own
 * error state rather than this function swallowing it (see `useUpdater`'s
 * `error` state; `UpdateNotifier` swallows it itself, deliberately, since a
 * startup check has nowhere to surface an error).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  // Best-effort: releases the previous check's Rust-side resource (if any)
  // now that it's about to be replaced and unreachable — a re-check (the
  // manual "Check for updates" button, or the startup check racing a
  // Settings-page mount) would otherwise leak one `Update` handle per call.
  // Never worth failing the new check over. Skipped while a download is in
  // flight (see `isDownloading`) — that same resource may be the one being
  // downloaded right now.
  if (!isDownloading) {
    pendingUpdate?.close().catch(() => {});
  }
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

  isDownloading = true;
  try {
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
  } finally {
    isDownloading = false;
  }
}

/** Exits and relaunches the app — call once `downloadAndInstallUpdate` resolves. */
export async function relaunchApp(): Promise<void> {
  await relaunch();
}

/** The running app's own version, e.g. `"0.3.0"` — shown as `Current: v0.3.0` in `UpdatesSection`. */
export async function getCurrentVersion(): Promise<string> {
  return getVersion();
}
