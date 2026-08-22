import type { Volume } from "@/lib/api/volumes";
import type { RegisterDriveInput } from "@/lib/api/drives";

export type RegisterDriveDialogProps = {
  volume: Volume | null;
  onClose: () => void;
  onSubmit: (input: RegisterDriveInput) => void;
};
