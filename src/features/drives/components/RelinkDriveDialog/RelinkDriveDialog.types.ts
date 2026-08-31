import type { Drive } from "@/lib/api/drives";
import type { Volume } from "@/lib/api/volumes";

export type RelinkDriveDialogProps = {
  /** The drive being relinked — the dialog is closed when this is `null`. */
  drive: Drive | null;
  /** Currently mounted volumes not already claimed by any registered drive — what the user can pick from. */
  candidates: Volume[];
  /** Whether `relink_drive` is in flight — disables the list while true. */
  relinking: boolean;
  /** The backend's refusal message, if the last attempt failed. */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Fires with the chosen volume's mount path once the user picks one. */
  onConfirm: (mountPath: string) => void;
};
