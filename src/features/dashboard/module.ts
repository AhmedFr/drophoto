import { LayoutDashboard } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { DashboardPage } from "./DashboardPage";
export const dashboardModule: FeatureModule = {
  id: "dashboard",
  title: "Dashboard",
  path: "/",
  icon: LayoutDashboard,
  order: 1,
  Page: DashboardPage,
};
