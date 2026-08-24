import { MapPin } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { PlacesPage } from "./PlacesPage";
export const placesModule: FeatureModule = {
  id: "places",
  title: "Places",
  path: "/places",
  icon: MapPin,
  order: 8,
  Page: PlacesPage,
};
