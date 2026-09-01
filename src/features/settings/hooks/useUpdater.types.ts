/**
 * `useUpdater`'s state machine:
 *  - `idle` — before the auto-check on mount has resolved.
 *  - `checking` — a `checkForUpdate()` call is in flight (the mount
 *    auto-check, or a manual re-check from `check()`).
 *  - `upToDate` — the last check found nothing newer.
 *  - `available` — the last check found a newer release; `version`/`notes`
 *    carry it.
 *  - `downloading` — `install()` is in flight; `percent` tracks progress.
 *  - `readyToRelaunch` — the update downloaded and installed; only
 *    `relaunch()` is left.
 *  - `error` — the last check or install rejected; `message` carries why
 *    (this covers the placeholder-`pubkey` case too — see
 *    `src/lib/api/updater.ts`).
 */
export type UpdaterStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "readyToRelaunch"
  | "error";

export type UseUpdaterResult = {
  status: UpdaterStatus;
  /** The running app's own version, once `getCurrentVersion()` resolves; `null` until then. */
  currentVersion: string | null;
  /** Set only in `available`/`downloading`/`readyToRelaunch`. */
  version: string | null;
  notes: string | null;
  /** Set only in `downloading`, `0`-`100`. */
  percent: number;
  /** Set only in `error`. */
  error: string | null;
  /** Re-runs the check; safe to call from any state. */
  check: () => void;
  /** Downloads and installs the pending update; only meaningful from `available`. */
  install: () => void;
  /** Relaunches the app; only meaningful from `readyToRelaunch`. */
  relaunch: () => void;
};
