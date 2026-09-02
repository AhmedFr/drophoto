import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import {
  getOrganizeDefaults,
  saveOrganizeDefaults,
  ORGANIZE_RULE_FALLBACK,
  type OrganizeDefaults,
} from "@/lib/api/organize";
import { TEMPLATE_PRESETS } from "@/lib/organize/presets";
import type { Draft } from "./OrganizeDefaultsSection.types";

/** `OrganizeDefaults`, with every field's fallback already applied. */
function draftFrom(defaults: OrganizeDefaults): Draft {
  return {
    root: defaults.root ?? ORGANIZE_RULE_FALLBACK.root,
    folder_tpl: defaults.folder_tpl ?? ORGANIZE_RULE_FALLBACK.folder_tpl,
    file_tpl: defaults.file_tpl ?? ORGANIZE_RULE_FALLBACK.file_tpl,
    keep_pairs: defaults.keep_pairs ?? ORGANIZE_RULE_FALLBACK.keep_pairs,
  };
}

/**
 * Settings' "Organize defaults" section: the root + folder/file templates
 * + keep-pairs setting a freshly registered drive's organize rule starts
 * from (`Catalog::get_rule`'s fallback branch — see
 * `dp_core::OrganizeDefaults`). Inputs prefill from the saved defaults,
 * or — for any field never configured — the same hardcoded values
 * `OrganizeRule::default_for` always used before this setting existed
 * (`ORGANIZE_RULE_FALLBACK`), so the section never shows a blank input.
 * SAVE always persists every field as currently shown (never re-clears
 * one back to unset); PRESETS fills only the folder template, from the
 * same dropdown the Organize wizard's `RuleEditor` offers
 * (`TEMPLATE_PRESETS`, shared between both).
 *
 * The form only renders once the initial `get_organize_defaults` load has
 * resolved (a "Loading…" message stands in until then) — deliberately,
 * so there's no window where a user could start editing before the
 * fetched defaults land and have that edit clobbered by the load; see
 * `RuleEditor`'s identical "Loading rule…" gate for the same reason.
 */
export function OrganizeDefaultsSection() {
  const queryClient = useQueryClient();
  const defaultsQuery = useQuery({
    queryKey: ["organize-defaults"],
    queryFn: getOrganizeDefaults,
    // Never refetches on its own (e.g. window focus) — only this
    // section's own successful save invalidates it.
    staleTime: Infinity,
  });

  // Adjusts the draft (and clears any stale error) whenever the loaded
  // defaults change — a plain render-time reaction rather than a
  // `useEffect`, matching `useRule`'s handling of the analogous
  // `["rule", driveId]` query. Safe against clobbering an in-progress
  // edit because the form below never renders until `defaultsQuery.data`
  // has resolved at least once.
  const [lastData, setLastData] = useState(defaultsQuery.data);
  const [draft, setDraft] = useState<Draft | null>(
    defaultsQuery.data ? draftFrom(defaultsQuery.data) : null,
  );
  const [error, setError] = useState<string | null>(null);
  if (defaultsQuery.data !== lastData) {
    setLastData(defaultsQuery.data);
    setDraft(defaultsQuery.data ? draftFrom(defaultsQuery.data) : null);
    setError(null);
  }

  const saveMutation = useMutation({
    mutationFn: (next: Draft) => saveOrganizeDefaults(next),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["organize-defaults"] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Failed to save the organize defaults.");
    },
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">ORGANIZE DEFAULTS</span>
      </div>

      {defaultsQuery.error && (
        <p className="px-6 pb-2 font-mono text-[11px] text-red-400">
          {(defaultsQuery.error as Error).message}
        </p>
      )}

      {!draft ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Loading organize defaults…</p>
      ) : (
        <div className="flex flex-col gap-5 px-6 pb-6">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-dim">Root</span>
            <Input
              aria-label="Default root"
              className="font-mono text-[11px]"
              value={draft.root}
              onChange={(e) => setDraft({ ...draft, root: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-dim">Folder template</span>
            <Input
              aria-label="Default folder template"
              className="font-mono text-[11px]"
              value={draft.folder_tpl}
              onChange={(e) => setDraft({ ...draft, folder_tpl: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] text-dim">File template</span>
            <Input
              aria-label="Default file template"
              className="font-mono text-[11px]"
              value={draft.file_tpl}
              onChange={(e) => setDraft({ ...draft, file_tpl: e.target.value })}
            />
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="self-start font-mono text-[10px] tracking-[1px]">
                PRESETS
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {TEMPLATE_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset.label}
                  onSelect={() => setDraft({ ...draft, folder_tpl: preset.folder_tpl })}
                >
                  {preset.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-[13px]">Keep RAW + JPEG pairs</span>
              <span className="text-[11px] text-dim">Shared name, same folder</span>
            </div>
            <Switch
              checked={draft.keep_pairs}
              onCheckedChange={(checked) => setDraft({ ...draft, keep_pairs: checked })}
            />
          </div>

          {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

          <Button
            size="sm"
            onClick={() => draft && saveMutation.mutate(draft)}
            disabled={saveMutation.isPending}
            className="self-start font-mono text-[10.5px] tracking-[1.5px]"
          >
            SAVE
          </Button>
        </div>
      )}
    </div>
  );
}
