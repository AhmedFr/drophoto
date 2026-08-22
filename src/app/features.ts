import { buildRegistry } from "./registry";
import { dashboardModule } from "@/features/dashboard";
import { drivesModule } from "@/features/drives";
import { galleryModule } from "@/features/gallery";
import { organizeModule } from "@/features/organize";
import { searchModule } from "@/features/search";
import { tagsModule } from "@/features/tags";
import { settingsModule } from "@/features/settings";
export const FEATURES = buildRegistry([
  dashboardModule,
  drivesModule,
  galleryModule,
  organizeModule,
  searchModule,
  tagsModule,
  settingsModule,
]);
