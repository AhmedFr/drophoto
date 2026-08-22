import type { Volume } from "@/lib/api/volumes";
import type { RegisterDriveInput } from "@/lib/api/drives";

export type RegisterDriveDialogProps = {
  volume: Volume | null;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: RegisterDriveInput) => void;
};
