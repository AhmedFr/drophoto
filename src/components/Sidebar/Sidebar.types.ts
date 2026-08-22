import type { FeatureModule } from "@/app/registry";
export type SidebarProps = {
  items: FeatureModule[];
  activeId: string;
  onNavigate: (path: string) => void;
};
