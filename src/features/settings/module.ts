import { Settings } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { SettingsPage } from "./SettingsPage";
import { SETTINGS_ROUTES } from "./settings.routes";
export const settingsModule: FeatureModule = {
  id: "settings",
  title: "Settings",
  path: "/settings",
  icon: Settings,
  order: 8,
  Page: SettingsPage,
  children: SETTINGS_ROUTES,
};
