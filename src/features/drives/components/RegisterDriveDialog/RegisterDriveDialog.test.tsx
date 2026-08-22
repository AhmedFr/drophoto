import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Volume } from "@/lib/api/volumes";
import { RegisterDriveDialog } from "./RegisterDriveDialog";

const volume: Volume = {
  name: "",
  mount_path: "/Volumes/Kodachrome",
  total_bytes: 2_000_000_000,
  free_bytes: 1_500_000_000,
  is_removable: true,
};

it("is closed when volume is null", () => {
  render(<RegisterDriveDialog volume={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("defaults the name to the mount path basename when volume has no name", () => {
  render(<RegisterDriveDialog volume={volume} onClose={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.getByRole("textbox")).toHaveValue("Kodachrome");
});

it("defaults the name to the volume name when present", () => {
  render(
    <RegisterDriveDialog
      volume={{ ...volume, name: "My Drive" }}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getByRole("textbox")).toHaveValue("My Drive");
});

it("submits with the typed name and default archive role", () => {
  const onSubmit = vi.fn();
  render(<RegisterDriveDialog volume={volume} onClose={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Backup Drive" } });
  fireEvent.click(screen.getByRole("button", { name: /register/i }));
  expect(onSubmit).toHaveBeenCalledWith({
    name: "Backup Drive",
    mount_path: "/Volumes/Kodachrome",
    role: "archive",
    capacity: 2_000_000_000,
    free: 1_500_000_000,
  });
});

it("renders no role toggle", () => {
  render(<RegisterDriveDialog volume={volume} onClose={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "SOURCE" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "ARCHIVE" })).not.toBeInTheDocument();
});

it("calls onClose when the dialog is dismissed", () => {
  const onClose = vi.fn();
  render(<RegisterDriveDialog volume={volume} onClose={onClose} onSubmit={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

it("renders the error message inside the dialog when given one", () => {
  render(
    <RegisterDriveDialog
      volume={volume}
      error="name already taken"
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  expect(within(screen.getByRole("dialog")).getByText("name already taken")).toBeInTheDocument();
});

it("renders no error text when error is not given", () => {
  render(<RegisterDriveDialog volume={volume} onClose={vi.fn()} onSubmit={vi.fn()} />);
  expect(within(screen.getByRole("dialog")).queryByText(/taken/)).not.toBeInTheDocument();
});
