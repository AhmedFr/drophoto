import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { DangerZone } from "./DangerZone";

it("renders the danger-zone button but not the confirmation dialog initially", () => {
  render(<DangerZone onConfirmReset={vi.fn()} resetting={false} resetError={null} />);
  expect(screen.getByRole("button", { name: "Reset app data…" })).toBeInTheDocument();
  expect(screen.queryByText("Reset app data", { selector: "h2, [data-slot=dialog-title]" })).not.toBeInTheDocument();
});

it("opens the confirmation dialog when the reset button is clicked", async () => {
  render(<DangerZone onConfirmReset={vi.fn()} resetting={false} resetError={null} />);
  await userEvent.click(screen.getByRole("button", { name: "Reset app data…" }));
  expect(screen.getByText(/Deletes the catalog and every cached thumbnail/)).toBeInTheDocument();
});

it("wires onConfirmReset through to the dialog's confirm action", async () => {
  const onConfirmReset = vi.fn();
  render(<DangerZone onConfirmReset={onConfirmReset} resetting={false} resetError={null} />);

  await userEvent.click(screen.getByRole("button", { name: "Reset app data…" }));
  await userEvent.type(screen.getByLabelText("Type RESET to confirm"), "RESET");
  await userEvent.click(screen.getByRole("button", { name: "Reset app data" }));

  expect(onConfirmReset).toHaveBeenCalledTimes(1);
});

it("forwards resetError through to the confirmation dialog", async () => {
  render(
    <DangerZone onConfirmReset={vi.fn()} resetting={false} resetError="couldn't delete thumbs" />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset app data…" }));

  expect(screen.getByText("couldn't delete thumbs")).toBeInTheDocument();
});
