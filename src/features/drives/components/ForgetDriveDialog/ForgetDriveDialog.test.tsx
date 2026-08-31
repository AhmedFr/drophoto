import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import { ForgetDriveDialog } from "./ForgetDriveDialog";

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
    <ForgetDriveDialog
      drive={null}
      mediaCount={0}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("names the drive in the title", () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText('Forget "Kodachrome"')).toBeInTheDocument();
});

it("shows the media count and explains what is and isn't touched", () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(
    screen.getByText(
      "Removes 12 photos from the catalog and all their tags/places; files on the drive itself are NEVER touched.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/Thumbnails already generated/)).toBeInTheDocument();
});

it("pluralizes a single photo correctly", () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={1}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/Removes 1 photo from the catalog/)).toBeInTheDocument();
});

it("shows a loading message and keeps confirm disabled while the count is still loading", () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={null}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText(/Checking how many photos/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Forget drive" })).toBeDisabled();
});

it("keeps the confirm button disabled until FORGET is typed exactly", async () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  const confirmButton = screen.getByRole("button", { name: "Forget drive" });
  const input = screen.getByLabelText("Type FORGET to confirm");

  expect(confirmButton).toBeDisabled();

  await userEvent.type(input, "forget");
  expect(confirmButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "FORGET NOW");
  expect(confirmButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, "FORGET");
  expect(confirmButton).toBeEnabled();
});

it("calls onConfirm only once FORGET is typed and the button is clicked", async () => {
  const onConfirm = vi.fn();
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      onOpenChange={vi.fn()}
      onConfirm={onConfirm}
    />,
  );

  await userEvent.type(screen.getByLabelText("Type FORGET to confirm"), "FORGET");
  await userEvent.click(screen.getByRole("button", { name: "Forget drive" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("disables both buttons and relabels confirm while forgetting", () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={true}
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Forgetting…" })).toBeDisabled();
});

it("renders an error message when given one", () => {
  render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      error="a scan job is running on this drive"
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText("a scan job is running on this drive")).toBeInTheDocument();
});

it("clears the typed text when the dialog is closed and reopened", async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText("Type FORGET to confirm"), "FORGET");
  expect(screen.getByRole("button", { name: "Forget drive" })).toBeEnabled();

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(
    <ForgetDriveDialog
      drive={null}
      mediaCount={12}
      forgetting={false}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
    />,
  );
  rerender(
    <ForgetDriveDialog
      drive={drive}
      mediaCount={12}
      forgetting={false}
      onOpenChange={onOpenChange}
      onConfirm={vi.fn()}
    />,
  );

  expect(screen.getByLabelText("Type FORGET to confirm")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Forget drive" })).toBeDisabled();
});
