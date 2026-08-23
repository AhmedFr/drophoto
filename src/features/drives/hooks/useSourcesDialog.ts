import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Drive } from "@/lib/api/drives";
import { detectSources, listSources, saveSources } from "@/lib/api/sources";
import { pickFolder } from "@/lib/api/dialog";
import type { SourceRow } from "./useSourcesDialog.types";

/** `path` relative to `mount`, or `null` if `path` isn't inside `mount`. */
function relativeToMount(path: string, mount: string): string | null {
  const normMount = mount.endsWith("/") ? mount.slice(0, -1) : mount;
  if (path === normMount) return "";
  if (path.startsWith(`${normMount}/`)) return path.slice(normMount.length + 1);
  return null;
}

/**
 * Drives the Sources dialog: loads existing sources + runs auto-detect for
 * `drive`, merges them into checkable rows, and exposes toggle/add/save
 * actions. See `SourcesDialog` for the presentational half.
 */
export function useSourcesDialog(drive: Drive | null, onClose: () => void) {
  const queryClient = useQueryClient();
  const driveId = drive?.id ?? null;
  const mountPath = drive?.mount_path ?? null;
  const isBootVolume = mountPath === "/";

  // Manually-checked/unchecked rows (by rel_path), and manually-added
  // folders — layered on top of the detect/existing query results below.
  // Reset whenever a different drive's dialog opens: comparing against
  // the previous driveId during render (rather than in an effect) is the
  // standard "adjusting state when a prop changes" pattern, and avoids
  // the extra render an effect-driven reset would cause.
  const [checkedOverrides, setCheckedOverrides] = useState<Record<string, boolean>>({});
  const [addedRows, setAddedRows] = useState<SourceRow[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [resetForDriveId, setResetForDriveId] = useState(driveId);
  if (driveId !== resetForDriveId) {
    setResetForDriveId(driveId);
    setCheckedOverrides({});
    setAddedRows([]);
    setAddError(null);
  }

  const sourcesQuery = useQuery({
    queryKey: ["sources", driveId],
    queryFn: () => listSources(driveId as number),
    enabled: driveId != null,
  });

  const detectQuery = useQuery({
    queryKey: ["detect-sources", driveId],
    queryFn: () => detectSources(driveId as number),
    enabled: driveId != null,
  });

  // Existing rows are derived from `sourcesQuery` alone and always shown
  // once it resolves — a failed `detectQuery` (offline mount hiccup, a
  // walk error, ...) must never blank the dialog down to the empty state
  // with Save enabled, since saving an empty set would disable every
  // already-configured source. Detected rows are layered in only when
  // `detectQuery.data` is actually present.
  const baseRows = useMemo<SourceRow[]>(() => {
    if (!sourcesQuery.data) return [];

    const existing = sourcesQuery.data.filter((s) => !(isBootVolume && s.rel_path === ""));
    const existingPaths = new Set(existing.map((s) => s.rel_path));
    const noExistingSourcesYet = existing.length === 0;
    const detected = (detectQuery.data ?? []).filter(
      (d) => !(isBootVolume && d.rel_path === "") && !existingPaths.has(d.rel_path),
    );

    return [
      ...existing.map((s) => ({
        rel_path: s.rel_path,
        media_count: null,
        bytes: null,
        suggested: false,
        checked: s.enabled,
        existing: true,
      })),
      ...detected.map((d) => ({
        rel_path: d.rel_path,
        media_count: d.media_count,
        bytes: d.bytes,
        suggested: d.suggested,
        checked: noExistingSourcesYet && d.suggested,
        existing: false,
      })),
    ];
  }, [sourcesQuery.data, detectQuery.data, isBootVolume]);

  const rows = useMemo<SourceRow[]>(
    () =>
      [...baseRows, ...addedRows].map((r) =>
        r.rel_path in checkedOverrides ? { ...r, checked: checkedOverrides[r.rel_path] } : r,
      ),
    [baseRows, addedRows, checkedOverrides],
  );

  const toggle = (relPath: string) => {
    const current = rows.find((r) => r.rel_path === relPath);
    if (!current) return;
    setCheckedOverrides((prev) => ({ ...prev, [relPath]: !current.checked }));
  };

  const addFolder = async () => {
    if (!mountPath) return;
    setAddError(null);

    const picked = await pickFolder(mountPath);
    if (!picked) return;

    const rel = relativeToMount(picked, mountPath);
    if (isBootVolume && rel === "") {
      setAddError("The whole boot volume can't be a source");
      return;
    }
    if (rel === null) {
      setAddError("Folder must be on this drive");
      return;
    }

    const alreadyListed = baseRows.some((r) => r.rel_path === rel) || addedRows.some((r) => r.rel_path === rel);
    if (!alreadyListed) {
      setAddedRows((prev) => [
        ...prev,
        { rel_path: rel, media_count: null, bytes: null, suggested: false, checked: true, existing: false },
      ]);
    }
    setCheckedOverrides((prev) => ({ ...prev, [rel]: true }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (driveId == null) return;
      const relPaths = rows.filter((r) => r.checked).map((r) => r.rel_path);
      await saveSources(driveId, relPaths);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources", driveId] });
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      onClose();
    },
  });

  const sourcesError = sourcesQuery.isError ? (sourcesQuery.error as Error).message : null;

  return {
    rows,
    isDetecting: sourcesQuery.isLoading || detectQuery.isLoading,
    detectError: detectQuery.isError ? (detectQuery.error as Error).message : null,
    addError,
    saveError: saveMutation.isError ? (saveMutation.error as Error).message : null,
    isSaving: saveMutation.isPending,
    // Existing sources failing to load at all is different from detect
    // failing: there's no reliable row set to save in that case, so
    // saving is blocked outright rather than risking an accidental wipe.
    canSave: !sourcesError && !sourcesQuery.isLoading,
    toggle,
    addFolder,
    save: () => saveMutation.mutate(),
  };
}
