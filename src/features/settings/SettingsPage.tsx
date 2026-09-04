import { SettingsLayout } from "./components/SettingsLayout";

/**
 * The route component mounted at `/settings` (and, via its own
 * `<Outlet/>`, every path nested under it) — just `SettingsLayout`, kept
 * as its own named export/file since that's what `settingsModule.Page`
 * (and this file's existing test suite) points at.
 */
export function SettingsPage() {
  return <SettingsLayout />;
}
