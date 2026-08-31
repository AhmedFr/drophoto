import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format/bytes";
import type { StorageUsage } from "@/lib/api/settings";
import type { StorageSectionProps } from "./StorageSection.types";

/** One breakdown-bar segment / row: a label, its byte total, and a fixed swatch color. */
type Segment = { label: string; bytes: number; color: string };

/** The three tracked buckets, in the fixed order they're always drawn/listed. Exported for the test's own segment-order assertions. */
export function segments(usage: StorageUsage): Segment[] {
  return [
    { label: "Thumbnails (400px)", bytes: usage.thumbs_400_bytes, color: "bg-primary" },
    { label: "Previews", bytes: usage.previews_bytes, color: "bg-primary/50" },
    { label: "Catalog database", bytes: usage.catalog_bytes, color: "bg-primary/25" },
  ];
}

/** Each segment's share of `total`, as a percentage width (0-100). `0` for every segment when `total` is `0` — an empty store draws no bar rather than dividing by zero. */
export function segmentWidthPct(bytes: number, total: number): number {
  if (total <= 0) return 0;
  return (bytes / total) * 100;
}

export function StorageSection({ usage, loading, error, refreshing, onRefresh }: StorageSectionProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">STORAGE</span>
        <span className="flex-1" />
        <Button variant="outline" size="xs" onClick={onRefresh} disabled={loading || refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error && <p className="px-6 pb-2 font-mono text-[11px] text-red-400">{error}</p>}

      {loading && !usage ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Computing storage usage…</p>
      ) : usage ? (
        <div className="flex flex-col gap-3 px-6 pb-6">
          <div
            className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`Storage breakdown: ${formatBytes(usage.total_bytes)} total`}
          >
            {segments(usage).map((segment) => {
              const pct = segmentWidthPct(segment.bytes, usage.total_bytes);
              if (pct <= 0) return null;
              return (
                <div
                  key={segment.label}
                  className={segment.color}
                  style={{ width: `${pct}%` }}
                  title={`${segment.label}: ${formatBytes(segment.bytes)}`}
                />
              );
            })}
          </div>

          <ul className="flex flex-col">
            {segments(usage).map((segment) => (
              <li
                key={segment.label}
                className="flex items-center gap-2 border-b border-border py-2 last:border-b-0"
              >
                <span className={`size-2 shrink-0 rounded-full ${segment.color}`} aria-hidden="true" />
                <span className="text-[12px]">{segment.label}</span>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-muted-foreground">{formatBytes(segment.bytes)}</span>
              </li>
            ))}
          </ul>

          <p className="font-mono text-[10px] text-faint">
            {`${formatBytes(usage.total_bytes)} total · ${usage.file_count.toLocaleString()} files`}
          </p>
        </div>
      ) : (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Storage usage unavailable.</p>
      )}
    </div>
  );
}
