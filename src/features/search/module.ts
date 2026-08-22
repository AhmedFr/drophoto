import { Search } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { SearchPage } from "./SearchPage";
export const searchModule: FeatureModule = {
  id: "search",
  title: "Search",
  path: "/search",
  icon: Search,
  order: 5,
  Page: SearchPage,
};
