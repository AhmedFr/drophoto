import type { OrganizeRule } from "@/lib/api/organize";

export type RuleEditorProps = {
  /** `null` while the active drive's rule is still loading. */
  rule: OrganizeRule | null;
  /** All drives selected in the wizard; the drive selector shows only when there's more than one. */
  driveIds: number[];
  /** Known drives (id + name) used to label the selector's options; an id with no match falls back to `Drive {id}`. */
  drives: { id: number; name: string }[];
  activeDriveId: number | undefined;
  onSelectDrive: (driveId: number) => void;
  onChange: (rule: OrganizeRule) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  /** Disables every input, the drive selector, presets, the switch, and SAVE — e.g. while an organize run is in progress. */
  disabled?: boolean;
};
