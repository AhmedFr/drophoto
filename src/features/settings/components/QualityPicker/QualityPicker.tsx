import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatBytes } from "@/lib/format/bytes";
import { PREVIEW_EDGES } from "@/lib/api/settings";
import type { QualityPickerProps, QualityStep } from "./QualityPicker.types";

const STEPS: QualityStep[] = [
  { quality: "compact", edge: PREVIEW_EDGES.compact, label: "Compact" },
  { quality: "balanced", edge: PREVIEW_EDGES.balanced, label: "Balanced" },
  { quality: "max", edge: PREVIEW_EDGES.max, label: "Max" },
];

/**
 * Estimated total preview-cache size at `edge`, scaled from the CURRENT
 * `previewsBytes` by `(edge / currentEdge) ** 2` — pixel count (and so,
 * roughly, encoded size) scales with the square of the edge. Anchored on
 * `currentEdge` (the edge `previewsBytes` was actually measured at), not
 * on max: anchoring on max would make every row wrong except while the
 * user happens to already be at max (e.g. it would claim Max costs the
 * same as the current cache while sitting at Compact, and show 0.16× of
 * an already-compact cache for Compact itself).
 *
 * The ratio is clamped to `<= 1`: raising quality can't be "predicted" to
 * grow the cache — a lower-edge preview has already thrown away detail
 * that only a full rescan against the originals can restore (see
 * `ScanJob::with_full`), so an upscale step shows the same total as
 * today's cache rather than a fabricated larger number.
 *
 * A rough estimate either way, not an exact prediction: the actual bytes
 * after a regen also depend on image content and WebP's own encoding
 * behavior.
 */
export function estimatedPreviewBytes(edge: number, currentEdge: number, previewsBytes: number): number {
  const ratio = Math.min(edge / currentEdge, 1);
  return Math.round(previewsBytes * ratio * ratio);
}

export function QualityPicker({
  currentEdge,
  previewsBytes,
  applying,
  onApply,
  regenApplicable,
  regenRunning,
  onRegen,
}: QualityPickerProps) {
  const [staged, setStaged] = useState(currentEdge);
  // Adjusting state during render (React's documented pattern for "reset
  // state when a prop changes") rather than in an effect — e.g. after
  // Apply succeeds and the settings query refetches with the new
  // `preview_edge`, or if something else (another window, a future
  // settings sync) changed it. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevCurrentEdge, setPrevCurrentEdge] = useState(currentEdge);
  if (currentEdge !== prevCurrentEdge) {
    setPrevCurrentEdge(currentEdge);
    setStaged(currentEdge);
  }

  const isDowngrade = staged < currentEdge;
  const isUpgrade = staged > currentEdge;
  const isStaged = staged !== currentEdge;

  return (
    <div className="flex flex-col gap-3 px-6 pb-6">
      <div className="font-mono text-[9px] tracking-[2px] text-faint">PREVIEW QUALITY</div>

      <RadioGroup
        value={String(staged)}
        onValueChange={(value) => setStaged(Number(value))}
        className="flex flex-col gap-2"
        aria-label="Preview quality"
      >
        {STEPS.map((step) => (
          <label
            key={step.quality}
            htmlFor={`preview-quality-${step.quality}`}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem
              id={`preview-quality-${step.quality}`}
              value={String(step.edge)}
              disabled={applying}
            />
            <span className="text-[12px] font-medium">{step.label}</span>
            <span className="font-mono text-[10px] text-faint">{step.edge}px</span>
            <span className="flex-1" />
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {previewsBytes !== null
                ? `~${formatBytes(estimatedPreviewBytes(step.edge, currentEdge, previewsBytes))}`
                : "—"}
            </span>
          </label>
        ))}
      </RadioGroup>

      {isDowngrade && (
        <p className="font-mono text-[10.5px] text-faint">
          Lowering quality frees space after you regenerate previews.
        </p>
      )}
      {isUpgrade && (
        <p className="font-mono text-[10.5px] text-faint">
          Raising quality needs a full rescan with drives connected — the extra detail can only come from the
          originals.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!isStaged || applying} onClick={() => onApply(staged)}>
          {applying ? "Applying…" : "Apply"}
        </Button>

        {regenApplicable && (
          <Button variant="outline" size="sm" disabled={regenRunning} onClick={onRegen}>
            {regenRunning ? "Regenerating…" : "Regenerate previews"}
          </Button>
        )}
      </div>
    </div>
  );
}
