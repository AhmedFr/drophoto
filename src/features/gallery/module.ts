import { Image } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { GalleryPage } from "./GalleryPage";
export const galleryModule: FeatureModule = {
  id: "gallery",
  title: "Gallery",
  path: "/gallery",
  icon: Image,
  order: 3,
  Page: GalleryPage,
};
