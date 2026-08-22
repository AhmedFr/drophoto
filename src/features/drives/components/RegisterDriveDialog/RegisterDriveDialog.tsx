import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Volume } from "@/lib/api/volumes";
import type { DriveRole, RegisterDriveInput } from "@/lib/api/drives";
import type { RegisterDriveDialogProps } from "./RegisterDriveDialog.types";

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

type FormProps = {
  volume: Volume;
  onSubmit: (input: RegisterDriveInput) => void;
};

function RegisterDriveForm({ volume, onSubmit }: FormProps) {
  const [name, setName] = useState(() => volume.name || basename(volume.mount_path));
  const [role, setRole] = useState<DriveRole>("archive");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      mount_path: volume.mount_path,
      role,
      capacity: volume.total_bytes,
      free: volume.free_bytes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input aria-label="Drive name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex gap-2">
        <Button
          type="button"
          variant={role === "archive" ? "default" : "outline"}
          onClick={() => setRole("archive")}
        >
          ARCHIVE
        </Button>
        <Button
          type="button"
          variant={role === "source" ? "default" : "outline"}
          onClick={() => setRole("source")}
        >
          SOURCE
        </Button>
      </div>
      <DialogFooter>
        <Button type="submit">Register</Button>
      </DialogFooter>
    </form>
  );
}

export function RegisterDriveDialog({ volume, onClose, onSubmit }: RegisterDriveDialogProps) {
  return (
    <Dialog open={volume != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Drive</DialogTitle>
        </DialogHeader>
        {volume && (
          <RegisterDriveForm key={volume.mount_path} volume={volume} onSubmit={onSubmit} />
        )}
      </DialogContent>
    </Dialog>
  );
}
