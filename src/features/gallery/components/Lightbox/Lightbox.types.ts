import type { MediaItem } from "@/lib/api/media";

export type LightboxProps = {
  items: MediaItem[];
  index: number;
  onClose(): void;
  onPrev(): void;
  onNext(): void;
  onNearEnd?(): void;
};
