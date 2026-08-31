import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { DangerZone } from "./DangerZone";

function renderZone(overrides: Partial<Parameters<typeof DangerZone>[0]> = {}) {
  return render(
    <DangerZone
      onConfirmReset={vi.fn()}
      resetting={false}
      resetError={null}
      onConfirmUninstall={vi.fn()}
      uninstalling={false}
      uninstallError={null}
      {...overrides}
    />,
  );
}

it("renders the danger-zone buttons but not the confirmation dialogs initially", () => {
  renderZone();
  expect(screen.getByRole("button", { name: "Reset app data…" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Uninstall drophoto…" })).toBeInTheDocument();
  expect(screen.queryByText("Reset app data", { selector: "h2, [data-slot=dialog-title]" })).not.toBeInTheDocument();
  expect(
    screen.queryByText("Uninstall drophoto", { selector: "h2, [data-slot=dialog-title]" }),
  ).not.toBeInTheDocument();
});

it("opens the reset confirmation dialog when the reset button is clicked", async () => {
  renderZone();
  await userEvent.click(screen.getByRole("button", { name: "Reset app data…" }));
  expect(screen.getByText(/Deletes the catalog and every cached thumbnail/)).toBeInTheDocument();
});

it("wires onConfirmReset through to the reset dialog's confirm action", async () => {
  const onConfirmReset = vi.fn();
  renderZone({ onConfirmReset });

  await userEvent.click(screen.getByRole("button", { name: "Reset app data…" }));
  await userEvent.type(screen.getByLabelText("Type RESET to confirm"), "RESET");
  await userEvent.click(screen.getByRole("button", { name: "Reset app data" }));

  expect(onConfirmReset).toHaveBeenCalledTimes(1);
});

it("forwards resetError through to the reset confirmation dialog", async () => {
  renderZone({ resetError: "couldn't delete thumbs" });
  await userEvent.click(screen.getByRole("button", { name: "Reset app data…" }));

  expect(screen.getByText("couldn't delete thumbs")).toBeInTheDocument();
});

it("opens the uninstall confirmation dialog when the uninstall button is clicked", async () => {
  renderZone();
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto…" }));
  expect(screen.getByText(/Moves drophoto to the Trash/)).toBeInTheDocument();
});

it("wires onConfirmUninstall through to the uninstall dialog's confirm action", async () => {
  const onConfirmUninstall = vi.fn();
  renderZone({ onConfirmUninstall });

  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto…" }));
  await userEvent.type(screen.getByLabelText("Type UNINSTALL to confirm"), "UNINSTALL");
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto" }));

  expect(onConfirmUninstall).toHaveBeenCalledTimes(1);
});

it("forwards uninstallError through to the uninstall confirmation dialog", async () => {
  renderZone({ uninstallError: "not running from an installed .app bundle" });
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto…" }));

  expect(screen.getByText("not running from an installed .app bundle")).toBeInTheDocument();
});
