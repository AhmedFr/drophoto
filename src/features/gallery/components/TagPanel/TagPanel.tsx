import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTags } from "../../hooks/useTags";
import type { TagPanelProps } from "./TagPanel.types";

type Override = "add" | "remove";

/** Effective (staged) coverage for a tag: an override wins over the base state, absent means "none". */
function effectiveState(base: "all" | "some" | undefined, override: Override | undefined): "all" | "some" | "none" {
  if (override === "add") return "all";
  if (override === "remove") return "none";
  return base ?? "none";
}

/** Cycles a tag row's staged state per the brief: none→all, all→none, some→all. */
function nextOverride(current: "all" | "some" | "none"): Override {
  return current === "all" ? "remove" : "add";
}

/**
 * Tag picker for a set of media ids, styled like `SourcesDialog` (a plain
 * Radix Dialog, not a popover — simpler focus handling over the gallery).
 * Every checkbox toggle only *stages* a change locally; APPLY sends the
 * accumulated add/remove payload through `useTags`, CANCEL/Escape discards
 * it. Staged state resets each time the dialog re-opens.
 */
export function TagPanel({ mediaIds, open, onClose }: TagPanelProps) {
  const { allTags, states, apply, isApplying, error } = useTags(mediaIds);

  const [filterText, setFilterText] = useState("");
  const [overrides, setOverrides] = useState<Record<number, Override>>({});
  const [stagedCreates, setStagedCreates] = useState<string[]>([]);

  // Reset staged state whenever the dialog transitions from closed to open
  // — the standard "adjust state during render when a prop changes"
  // pattern (avoids an extra render an effect-driven reset would cause),
  // mirroring `useSourcesDialog`'s per-drive reset.
  const [resetForOpen, setResetForOpen] = useState(open);
  if (open !== resetForOpen) {
    setResetForOpen(open);
    if (open) {
      setFilterText("");
      setOverrides({});
      setStagedCreates([]);
    }
  }

  const trimmedFilter = filterText.trim();
  const filterLower = trimmedFilter.toLowerCase();
  const filteredTags = allTags.filter(
    (tag) => filterLower === "" || tag.name.toLowerCase().includes(filterLower),
  );
  const exactMatch = allTags.some((tag) => tag.name.toLowerCase() === filterLower);
  const alreadyStaged = stagedCreates.some((name) => name.toLowerCase() === filterLower);
  const showCreateRow = trimmedFilter !== "" && !exactMatch && !alreadyStaged;

  function toggleTag(tagId: number) {
    const current = effectiveState(states[tagId], overrides[tagId]);
    setOverrides((prev) => ({ ...prev, [tagId]: nextOverride(current) }));
  }

  function stageCreate() {
    setStagedCreates((prev) => [...prev, trimmedFilter]);
    setFilterText("");
  }

  function unstageCreate(name: string) {
    setStagedCreates((prev) => prev.filter((n) => n !== name));
  }

  function handleApply() {
    const add = [...stagedCreates];
    const remove: number[] = [];
    for (const tag of allTags) {
      const override = overrides[tag.id];
      if (override === "add") add.push(tag.name);
      else if (override === "remove") remove.push(tag.id);
    }
    // The per-call `onSuccess` (supported by the mutate function `useTags`
    // returns, even though its documented type is just `(input) => void`)
    // closes the panel once the mutation actually resolves — watching a
    // derived `isApplying` flag instead would race a mock/mutation that
    // resolves before React ever commits the intermediate "pending" render.
    apply({ add, remove }, { onSuccess: () => onClose() });
  }

  const hasChanges = stagedCreates.length > 0 || Object.keys(overrides).length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tags</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Filter or create a tag…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          autoFocus
        />

        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {stagedCreates.map((name) => (
            <label
              key={`create-${name}`}
              className="flex items-center gap-2 py-1.5 font-mono text-[11px] text-foreground"
            >
              <Checkbox checked onCheckedChange={() => unstageCreate(name)} />
              <span>{name}</span>
              <span className="text-faint">(new)</span>
            </label>
          ))}

          {showCreateRow && (
            <button
              type="button"
              onClick={stageCreate}
              className="py-1.5 text-left font-mono text-[11px] text-dim hover:text-foreground"
            >
              CREATE &quot;{trimmedFilter}&quot;
            </button>
          )}

          {filteredTags.length === 0 && !showCreateRow && stagedCreates.length === 0 && (
            <p className="py-1.5 font-mono text-[11px] text-dim">No tags found.</p>
          )}

          {filteredTags.map((tag) => {
            const state = effectiveState(states[tag.id], overrides[tag.id]);
            return (
              <label
                key={tag.id}
                className="flex items-center gap-2 py-1.5 font-mono text-[11px] text-foreground"
              >
                <Checkbox
                  checked={state === "all" ? true : state === "some" ? "indeterminate" : false}
                  onCheckedChange={() => toggleTag(tag.id)}
                />
                <span>{tag.name}</span>
              </label>
            );
          })}
        </div>

        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isApplying}>
            CANCEL
          </Button>
          <Button size="sm" onClick={handleApply} disabled={isApplying || !hasChanges}>
            APPLY
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
