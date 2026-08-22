import type { Volume } from "@/lib/api/volumes";

export type VolumeListProps = {
  volumes: Volume[];
  onRegister?: (v: Volume) => void;
};
