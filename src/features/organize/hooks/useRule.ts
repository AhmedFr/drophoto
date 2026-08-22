import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { getRule, saveRule, type OrganizeRule } from "@/lib/api/organize";
import type { UseRuleResult } from "./useRule.types";

function sameRule(a: OrganizeRule, b: OrganizeRule): boolean {
  return (
    a.root === b.root &&
    a.folder_tpl === b.folder_tpl &&
    a.file_tpl === b.file_tpl &&
    a.keep_pairs === b.keep_pairs
  );
}

/**
 * Owns rule-editing state for the Organize step's `RuleEditor`: which of
 * the selected drives is being edited (defaulting to the first, and
 * falling back to it if the wizard's selection changes and the
 * previously-active drive is no longer among `driveIds`), the draft rule
 * for it, whether that draft has unsaved edits (`isDirty`), and saving.
 * On a successful `save_rule`, invalidates that drive's `["rule",
 * driveId]` query and the whole selection's `["plan", driveIds]` — the
 * latter is what makes `PlanPreview` re-plan after a rule change.
 */
export function useRule(driveIds: number[]): UseRuleResult {
  const queryClient = useQueryClient();
  const [selectedDriveId, setSelectedDriveId] = useState<number | undefined>(driveIds[0]);

  const driveId =
    selectedDriveId !== undefined && driveIds.includes(selectedDriveId) ? selectedDriveId : driveIds[0];

  const ruleQuery = useQuery({
    queryKey: ["rule", driveId],
    queryFn: () => getRule(driveId as number),
    enabled: driveId !== undefined,
  });

  // Adjusts the draft (and clears any stale error) whenever the loaded
  // rule for the active drive changes — a plain render-time reaction
  // rather than a `useEffect`, per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  //
  // `savedRule` tracks the last known-good persisted value (what the
  // draft is dirty *against*): it starts out as whatever loaded, and is
  // updated optimistically the instant a save succeeds — rather than
  // waiting for the `["rule", driveId]` invalidation's refetch to land
  // — so `isDirty` flips back to `false` immediately after SAVE, not on
  // some later render.
  const [lastRuleData, setLastRuleData] = useState(ruleQuery.data);
  const [draft, setDraft] = useState<OrganizeRule | null>(ruleQuery.data ?? null);
  const [savedRule, setSavedRule] = useState<OrganizeRule | null>(ruleQuery.data ?? null);
  const [error, setError] = useState<string | null>(null);
  if (ruleQuery.data !== lastRuleData) {
    setLastRuleData(ruleQuery.data);
    setDraft(ruleQuery.data ?? null);
    setSavedRule(ruleQuery.data ?? null);
    setError(null);
  }

  const saveMutation = useMutation({
    mutationFn: (rule: OrganizeRule) => saveRule(rule),
    onSuccess: (_result, rule) => {
      setError(null);
      setSavedRule(rule);
      queryClient.invalidateQueries({ queryKey: ["rule", rule.drive_id] });
      queryClient.invalidateQueries({ queryKey: ["plan", driveIds] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Failed to save the rule.");
    },
  });

  const isDirty = draft !== null && savedRule !== null && !sameRule(draft, savedRule);

  return {
    driveIds,
    activeDriveId: driveId,
    setActiveDriveId: setSelectedDriveId,
    rule: draft,
    onChange: setDraft,
    onSave: () => {
      if (draft) saveMutation.mutate(draft);
    },
    saving: saveMutation.isPending,
    isDirty,
    error,
  };
}
