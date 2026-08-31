import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { UninstallDialog } from "./UninstallDialog";

it("renders nothing when closed", () => {
  render(
    <UninstallDialog open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} uninstalling={false} error={null} />,
  );
  expect(screen.queryByText("Uninstall drophoto")).not.toBeInTheDocument();
});

it("explains exactly what will and won't happen", () => {
  render(
    <UninstallDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} uninstalling={false} error={null} />,
  );
  expect(
    screen.getByText(
      "Moves drophoto to the Trash, then deletes the catalog and every cached thumbnail — drophoto quits immediately once this finishes successfully. Your photos and .xmp sidecar files are NEVER touched — your drives keep every file exactly where it is.",
    ),
  ).toBeInTheDocument();
});

it("keeps the confirm button disabled until UNINSTALL is typed exactly", async () => {
  render(
    <UninstallDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} uninstalling={false} error={null} />,
  );
  const confirmButton = screen.getByRole("button", { name: "Uninstall drophoto" });
  const input = screen.getByLabelText("Type UNINSTALL to confirm");

  expect(confirmButton).toBeDisabled();

  await userEvent.type(input, "uninstall");
  expect(confirmButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "UNINSTALL now");
  expect(confirmButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "UNINSTALL");
  expect(confirmButton).toBeEnabled();
});

it("calls onConfirm only once UNINSTALL is typed and the button is clicked", async () => {
  const onConfirm = vi.fn();
  render(
    <UninstallDialog open={true} onOpenChange={vi.fn()} onConfirm={onConfirm} uninstalling={false} error={null} />,
  );

  await userEvent.type(screen.getByLabelText("Type UNINSTALL to confirm"), "UNINSTALL");
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("disables both buttons and relabels confirm while uninstalling", () => {
  render(
    <UninstallDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} uninstalling={true} error={null} />,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Uninstalling…" })).toBeDisabled();
});

it("shows the uninstall error when the last attempt failed, without closing the dialog", () => {
  render(
    <UninstallDialog
      open={true}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      uninstalling={false}
      error="not running from an installed .app bundle"
    />,
  );
  expect(screen.getByText("not running from an installed .app bundle")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("clears the typed text when the dialog is closed and reopened", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <UninstallDialog
      open={true}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
      uninstalling={false}
      error={null}
    />,
  );
  await userEvent.type(screen.getByLabelText("Type UNINSTALL to confirm"), "UNINSTALL");
  expect(screen.getByRole("button", { name: "Uninstall drophoto" })).toBeEnabled();

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(
    <UninstallDialog
      open={false}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
      uninstalling={false}
      error={null}
    />,
  );
  rerender(
    <UninstallDialog open={true} onOpenChange={onOpenChange} onConfirm={vi.fn()} uninstalling={false} error={null} />,
  );

  expect(screen.getByLabelText("Type UNINSTALL to confirm")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Uninstall drophoto" })).toBeDisabled();
});

// Review finding 7: a stale error from a previous attempt must not
// resurface just because the dialog is closed and reopened.
it("hides a stale error after closing and reopening, until a new attempt fails", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <UninstallDialog open={true} onOpenChange={onOpenChange} onConfirm={vi.fn()} uninstalling={false} error="boom" />,
  );
  expect(screen.getByText("boom")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(
    <UninstallDialog open={false} onOpenChange={onOpenChange} onConfirm={vi.fn()} uninstalling={false} error="boom" />,
  );
  rerender(
    <UninstallDialog open={true} onOpenChange={onOpenChange} onConfirm={vi.fn()} uninstalling={false} error="boom" />,
  );

  // Still the same (stale) error prop, but the dialog was closed since —
  // it must stay hidden until a fresh attempt is made.
  expect(screen.queryByText("boom")).not.toBeInTheDocument();
});

it("shows a new error once a fresh attempt is confirmed after a reopen", async () => {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const { rerender } = render(
    <UninstallDialog open={true} onOpenChange={onOpenChange} onConfirm={onConfirm} uninstalling={false} error="boom" />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  rerender(
    <UninstallDialog open={false} onOpenChange={onOpenChange} onConfirm={onConfirm} uninstalling={false} error="boom" />,
  );
  rerender(
    <UninstallDialog open={true} onOpenChange={onOpenChange} onConfirm={onConfirm} uninstalling={false} error="boom" />,
  );
  expect(screen.queryByText("boom")).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("Type UNINSTALL to confirm"), "UNINSTALL");
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
  // Same error string re-supplied by the hook (a genuinely new failure
  // would look identical from this component's point of view) — the
  // point is that a fresh confirm re-arms the display.
  expect(screen.getByText("boom")).toBeInTheDocument();
});
