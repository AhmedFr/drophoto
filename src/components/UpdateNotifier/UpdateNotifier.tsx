import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { checkForUpdate } from "@/lib/api/updater";

/**
 * Renderless, mounted exactly once in `AppShell` (alongside
 * `JobEventsBridge`) — the app's *startup* update check: fires
 * `checkForUpdate()` once when the app first mounts, regardless of which
 * page is on screen, and shows exactly one toast for the whole session if
 * a newer release is found. Clicking the toast's action navigates to
 * `/settings`, where `UpdatesSection` (backed by its own `useUpdater()`
 * call) is the actual install surface — this component never downloads or
 * installs anything itself.
 *
 * This is deliberately a *separate* consumer of `src/lib/api/updater` from
 * `useUpdater` (see that hook's docs): `useUpdater`'s own auto-check only
 * runs while the Settings page happens to be mounted, so it can't be relied
 * on to ever fire for a user who never opens Settings. Two independent
 * checks costs nothing — `check_for_update` is a single cheap network call
 * with no server-side state to desync.
 *
 * The `pubkey` in `tauri.conf.json` is still the `UPDATER_PUBKEY_TBD`
 * placeholder as of this task (the finalize task swaps in the real key
 * after keygen), which makes the plugin's `check()` call reject rather
 * than resolve — so a rejection here is swallowed silently rather than
 * toasted or thrown: nothing on startup should crash or nag the user over
 * an update check that can't work yet. `UpdatesSection`'s own `error`
 * state is where a failed check surfaces (quietly) once the user actually
 * opens Settings.
 */
// A plain (non-literal) `string`, matching the widened `to` type
// `FeatureModule.path` already uses throughout `src/app` — the route tree
// built from `FEATURES.map(...)` only ever types as `string` paths (see
// `router.tsx`), so a `"/settings"` literal here would type-check against
// nothing but the router's own root ("/" | "." | "..") and fail to compile.
const SETTINGS_PATH: string = "/settings";

export function UpdateNotifier() {
  const navigate = useNavigate();
  const hasChecked = useRef(false);

  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;

    checkForUpdate()
      .then((info) => {
        if (!info) return;
        toast(`Update available — v${info.version}`, {
          action: { label: "View", onClick: () => navigate({ to: SETTINGS_PATH }) },
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
