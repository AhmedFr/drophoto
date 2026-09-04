import { buildRegistry } from "./registry";
import { dashboardModule } from "@/features/dashboard";
import { drivesModule } from "@/features/drives";
import { galleryModule } from "@/features/gallery";
import { organizeModule } from "@/features/organize";
import { placesModule } from "@/features/places";
import { tagsModule } from "@/features/tags";
import { settingsModule } from "@/features/settings";
export const FEATURES = buildRegistry([
  dashboardModule,
  drivesModule,
  galleryModule,
  organizeModule,
  tagsModule,
  settingsModule,
  placesModule,
]);
