import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import { RemoveMissingDialog } from "./RemoveMissingDialog";

const drive: Drive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  volume_label: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive",
  capacity: 100,
  free: 40,
  last_seen_at: null,
  online: true,
};

it("renders nothing when drive is null", () => {
  render(
    <RemoveMissingDialog
      drive={null}
      missingCount={0}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("names the drive in the title", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={3}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText('Remove missing files on "Kodachrome"')).toBeInTheDocument();
});

it("shows the missing count and explains that only catalog entries are removed", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={5}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(
    screen.getByText("Removes 5 catalog entries for files that couldn't be found on the last scan."),
  ).toBeInTheDocument();
  expect(screen.getByText(/Catalog entries only/)).toBeInTheDocument();
});

it("pluralizes a single entry correctly", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={1}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/Removes 1 catalog entry for files/)).toBeInTheDocument();
});

it("shows a loading message while the count is still loading", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={null}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/Checking how many files/)).toBeInTheDocument();
});

it("shows the count error but still allows confirming (no typed word gate)", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={null}
      missingCountError="network error"
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByText(/Checking how many files/)).not.toBeInTheDocument();
  expect(screen.getByText(/Couldn't determine how many files/)).toBeInTheDocument();
  expect(screen.getByText("network error")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove missing" })).toBeEnabled();
});

it("has no typed confirmation input — confirm is enabled immediately", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={5}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove missing" })).toBeEnabled();
});

it("calls onConfirm when the button is clicked", async () => {
  const onConfirm = vi.fn();
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={5}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={onConfirm}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Remove missing" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("disables both buttons and relabels confirm while removing", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={5}
      missingCountError={null}
      removing={true}
      error={null}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Removing…" })).toBeDisabled();
});

it("renders an error message when given one", () => {
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={5}
      missingCountError={null}
      removing={false}
      error="a scan job is running on this drive"
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText("a scan job is running on this drive")).toBeInTheDocument();
});

it("calls onOpenChange(false) when Cancel is clicked", async () => {
  const onOpenChange = vi.fn();
  render(
    <RemoveMissingDialog
      drive={drive}
      missingCount={5}
      missingCountError={null}
      removing={false}
      error={null}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(onOpenChange).toHaveBeenCalledWith(false);
});
