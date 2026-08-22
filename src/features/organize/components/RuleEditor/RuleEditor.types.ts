import type { OrganizeRule } from "@/lib/api/organize";

export type RuleEditorProps = {
  /** `null` while the active drive's rule is still loading. */
  rule: OrganizeRule | null;
  /** All drives selected in the wizard; the drive selector shows only when there's more than one. */
  driveIds: number[];
  activeDriveId: number | undefined;
  onSelectDrive: (driveId: number) => void;
  onChange: (rule: OrganizeRule) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
};
