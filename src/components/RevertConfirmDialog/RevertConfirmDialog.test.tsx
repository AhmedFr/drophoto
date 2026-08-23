import { render, screen, fireEvent } from "@testing-library/react";
import { RevertConfirmDialog } from "./RevertConfirmDialog";

it("is closed when open is false", () => {
  render(<RevertConfirmDialog open={false} moved={5} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows how many files would move back, pluralized", () => {
  render(<RevertConfirmDialog open moved={5} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByText("Move 5 files back to their original locations?")).toBeInTheDocument();
});

it("uses singular file for a count of one", () => {
  render(<RevertConfirmDialog open moved={1} onCancel={vi.fn()} onConfirm={vi.fn()} />);
  expect(screen.getByText("Move 1 file back to their original locations?")).toBeInTheDocument();
});

it("calls onConfirm when Revert is clicked", () => {
  const onConfirm = vi.fn();
  render(<RevertConfirmDialog open moved={5} onCancel={vi.fn()} onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));
  expect(onConfirm).toHaveBeenCalled();
});

it("calls onCancel when Cancel is clicked", () => {
  const onCancel = vi.fn();
  render(<RevertConfirmDialog open moved={5} onCancel={onCancel} onConfirm={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
});

it("calls onCancel when dismissed via Escape", () => {
  const onCancel = vi.fn();
  render(<RevertConfirmDialog open moved={5} onCancel={onCancel} onConfirm={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onCancel).toHaveBeenCalled();
});
