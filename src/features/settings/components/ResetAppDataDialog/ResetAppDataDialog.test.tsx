import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ResetAppDataDialog } from "./ResetAppDataDialog";

it("renders nothing when closed", () => {
  render(<ResetAppDataDialog open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} resetting={false} />);
  expect(screen.queryByText("Reset app data")).not.toBeInTheDocument();
});

it("explains exactly what will and won't be touched", () => {
  render(<ResetAppDataDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} resetting={false} />);
  expect(
    screen.getByText(
      "Deletes the catalog and every cached thumbnail. Your photos, folders and .xmp sidecar files on your drives are NEVER touched.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/drag drophoto to the Trash/)).toBeInTheDocument();
});

it("keeps the confirm button disabled until RESET is typed exactly", async () => {
  render(<ResetAppDataDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} resetting={false} />);
  const confirmButton = screen.getByRole("button", { name: "Reset app data" });
  const input = screen.getByLabelText("Type RESET to confirm");

  expect(confirmButton).toBeDisabled();

  await userEvent.type(input, "reset");
  expect(confirmButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "RESET data");
  expect(confirmButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "RESET");
  expect(confirmButton).toBeEnabled();
});

it("calls onConfirm only once RESET is typed and the button is clicked", async () => {
  const onConfirm = vi.fn();
  render(<ResetAppDataDialog open={true} onOpenChange={vi.fn()} onConfirm={onConfirm} resetting={false} />);

  await userEvent.type(screen.getByLabelText("Type RESET to confirm"), "RESET");
  await userEvent.click(screen.getByRole("button", { name: "Reset app data" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("disables both buttons and relabels confirm while resetting", () => {
  render(<ResetAppDataDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} resetting={true} />);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Resetting…" })).toBeDisabled();
});

it("clears the typed text when the dialog is closed and reopened", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <ResetAppDataDialog open={true} onOpenChange={onOpenChange} onConfirm={vi.fn()} resetting={false} />,
  );
  await userEvent.type(screen.getByLabelText("Type RESET to confirm"), "RESET");
  expect(screen.getByRole("button", { name: "Reset app data" })).toBeEnabled();

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(<ResetAppDataDialog open={false} onOpenChange={onOpenChange} onConfirm={vi.fn()} resetting={false} />);
  rerender(<ResetAppDataDialog open={true} onOpenChange={onOpenChange} onConfirm={vi.fn()} resetting={false} />);

  expect(screen.getByLabelText("Type RESET to confirm")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Reset app data" })).toBeDisabled();
});
