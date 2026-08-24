import { Settings } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { SettingsPage } from "./SettingsPage";
export const settingsModule: FeatureModule = {
  id: "settings",
  title: "Settings",
  path: "/settings",
  icon: Settings,
  order: 8,
  Page: SettingsPage,
};
