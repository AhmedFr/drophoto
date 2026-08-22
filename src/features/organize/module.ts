import { FolderInput } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { OrganizePage } from "./OrganizePage";
export const organizeModule: FeatureModule = {
  id: "organize",
  title: "Organize",
  path: "/organize",
  icon: FolderInput,
  order: 4,
  Page: OrganizePage,
};
