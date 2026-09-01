import { useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getCurrentVersion,
  relaunchApp,
} from "@/lib/api/updater";
import type { UpdaterStatus, UseUpdaterResult } from "./useUpdater.types";

type State = {
  status: UpdaterStatus;
  version: string | null;
  notes: string | null;
  percent: number;
  error: string | null;
};

const INITIAL_STATE: State = { status: "idle", version: null, notes: null, percent: 0, error: null };

/** `Error`'s own message, or a fixed fallback for a non-`Error` rejection (a plugin call is never expected to reject with anything else, but `unknown` is `unknown`). */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Couldn't check for updates.";
}

/**
 * Drives the `UpdatesSection` UI: an auto-check on mount (once — guarded by
 * `hasAutoChecked`, so React 18 Strict Mode's double-invoke of effects
 * doesn't fire `checkForUpdate()` twice), plus `check`/`install`/`relaunch`
 * for the manual re-check and install-flow buttons. See `UpdaterStatus` for
 * the full state machine.
 *
 * This is a *separate* consumer of `src/lib/api/updater` from the
 * startup-toast check in `UpdateNotifier` — the two are independent by
 * design (see that component's docs): this hook only ever runs while
 * `UpdatesSection` is mounted (i.e. the Settings page is open), while the
 * toast check runs once for the app's whole session regardless of what
 * page is on screen.
 */
export function useUpdater(): UseUpdaterResult {
  const [state, setState] = useState<State>(INITIAL_STATE);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const hasAutoChecked = useRef(false);

  const runCheck = () => {
    setState((s) => ({ ...s, status: "checking", error: null }));
    checkForUpdate()
      .then((info) => {
        if (info) {
          setState({ status: "available", version: info.version, notes: info.notes, percent: 0, error: null });
        } else {
          setState({ status: "upToDate", version: null, notes: null, percent: 0, error: null });
        }
      })
      .catch((e: unknown) => {
        setState({ status: "error", version: null, notes: null, percent: 0, error: errorMessage(e) });
      });
  };

  useEffect(() => {
    if (hasAutoChecked.current) return;
    hasAutoChecked.current = true;
    runCheck();
    getCurrentVersion().then(setCurrentVersion);
  }, []);

  const install = () => {
    setState((s) => ({ ...s, status: "downloading", percent: 0, error: null }));
    downloadAndInstallUpdate((percent) => {
      setState((s) => (s.status === "downloading" ? { ...s, percent } : s));
    })
      .then(() => {
        setState((s) => ({ ...s, status: "readyToRelaunch", percent: 100 }));
      })
      .catch((e: unknown) => {
        setState((s) => ({ ...s, status: "error", error: errorMessage(e) }));
      });
  };

  const relaunch = () => {
    relaunchApp().catch(() => {});
  };

  return {
    status: state.status,
    currentVersion,
    version: state.version,
    notes: state.notes,
    percent: state.percent,
    error: state.error,
    check: runCheck,
    install,
    relaunch,
  };
}
