import { Tag } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { TagsPage } from "./TagsPage";
export const tagsModule: FeatureModule = {
  id: "tags",
  title: "Tags",
  path: "/tags",
  icon: Tag,
  order: 6,
  Page: TagsPage,
};
