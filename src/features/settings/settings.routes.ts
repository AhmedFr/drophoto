import type { FeatureRoute } from "@/app/registry";
import { GeneralSettingsPage } from "./GeneralSettingsPage";
import { LibrarySettingsPage } from "./LibrarySettingsPage";
import { MaintenanceSettingsPage } from "./MaintenanceSettingsPage";
import { DangerZoneSettingsPage } from "./DangerZoneSettingsPage";

/**
 * Settings' grouped sub-pages, in sidebar/sub-nav order. Shared by
 * `module.ts` (as `settingsModule.children`, for routing) and
 * `SettingsLayout` (as its left sub-nav's items) — one source of truth
 * for both. General's `path` deliberately equals the module's own
 * `/settings` (see `FeatureRoute`'s doc comment): it's the group that
 * renders at Settings' bare path, not a distinct URL.
 */
export const SETTINGS_ROUTES: FeatureRoute[] = [
  { id: "settings-general", title: "General", path: "/settings", Page: GeneralSettingsPage },
  { id: "settings-library", title: "Library", path: "/settings/library", Page: LibrarySettingsPage },
  { id: "settings-maintenance", title: "Maintenance", path: "/settings/maintenance", Page: MaintenanceSettingsPage },
  { id: "settings-danger", title: "Danger zone", path: "/settings/danger", Page: DangerZoneSettingsPage },
];
