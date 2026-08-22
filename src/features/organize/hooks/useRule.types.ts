import type { OrganizeRule } from "@/lib/api/organize";

export type UseRuleResult = {
  /** All drives selected in the wizard, for the drive selector. */
  driveIds: number[];
  /** Which drive's rule is currently shown/edited. */
  activeDriveId: number | undefined;
  setActiveDriveId: (driveId: number) => void;
  /** `null` while the active drive's rule is still loading. */
  rule: OrganizeRule | null;
  onChange: (rule: OrganizeRule) => void;
  onSave: () => void;
  saving: boolean;
  /** The message from a failed `save_rule` (an `ApiError`), if any. */
  error: string | null;
};
