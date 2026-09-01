import type { UseUpdaterResult } from "@/features/settings/hooks/useUpdater.types";

/** Every field `UpdatesSection` needs is already on `useUpdater()`'s return value — typed straight from it rather than duplicating the shape. */
export type UpdatesSectionProps = UseUpdaterResult;
