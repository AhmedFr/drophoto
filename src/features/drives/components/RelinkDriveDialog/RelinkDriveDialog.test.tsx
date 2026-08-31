import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import type { Volume } from "@/lib/api/volumes";
import { RelinkDriveDialog } from "./RelinkDriveDialog";

const drive: Drive = {
  id: 1,
  name: "SSD Samsung T7",
  volume_uuid: null,
  volume_label: null,
  mount_path: null,
  role: "archive",
  capacity: 100,
  free: 40,
  last_seen_at: null,
  online: false,
};

const t7: Volume = {
  name: "T7",
  mount_path: "/Volumes/T7",
  total_bytes: 2_000_000_000,
  free_bytes: 1_500_000_000,
  is_removable: true,
  uuid: "uuid-real",
};

it("renders nothing when drive is null", () => {
  render(
    <RelinkDriveDialog
      drive={null}
      candidates={[t7]}
      relinking={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("names the drive in the title", () => {
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[t7]}
      relinking={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText('Relink "SSD Samsung T7"')).toBeInTheDocument();
});

it("lists candidate volumes with their free/total space", () => {
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[t7]}
      relinking={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText("T7")).toBeInTheDocument();
  expect(screen.getByText("/Volumes/T7")).toBeInTheDocument();
  expect(screen.getByText(/1\.4.*GB.*free/i)).toBeInTheDocument();
});

it("shows an empty state when there are no unclaimed volumes", () => {
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[]}
      relinking={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/No unclaimed mounted volumes found/)).toBeInTheDocument();
});

it("calls onConfirm with the chosen volume's mount path when Relink is clicked", async () => {
  const onConfirm = vi.fn();
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[t7]}
      relinking={false}
      onOpenChange={vi.fn()}
      onConfirm={onConfirm}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Relink" }));

  expect(onConfirm).toHaveBeenCalledWith("/Volumes/T7");
});

it("disables the Relink button and relabels it while relinking", () => {
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[t7]}
      relinking={true}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Relinking…" })).toBeDisabled();
});

it("renders an error message when given one", () => {
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[t7]}
      relinking={false}
      error={`"T7" is already registered as another drive`}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText('"T7" is already registered as another drive')).toBeInTheDocument();
});

it("calls onOpenChange when the dialog is dismissed", () => {
  const onOpenChange = vi.fn();
  render(
    <RelinkDriveDialog
      drive={drive}
      candidates={[t7]}
      relinking={false}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
    />,
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
