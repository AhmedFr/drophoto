import type { StorageUsage } from "@/lib/api/settings";

export type StorageSectionProps = {
  /** `null` while the first `storage_usage` call hasn't resolved yet. */
  usage: StorageUsage | null;
  /** Whether the *first* load is still in flight — shows a loading line instead of the breakdown. */
  loading: boolean;
  /** Set when `storage_usage` rejected; shown alongside the (possibly stale) last-known `usage`. */
  error: string | null;
  /** Whether a REFRESH-triggered reload is in flight — disables the button and relabels it. */
  refreshing: boolean;
  onRefresh: () => void;
};
