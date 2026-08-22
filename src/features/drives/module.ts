import { HardDrive } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { DrivesPage } from "./DrivesPage";
export const drivesModule: FeatureModule = {
  id: "drives",
  title: "Drives",
  path: "/drives",
  icon: HardDrive,
  order: 2,
  Page: DrivesPage,
};
