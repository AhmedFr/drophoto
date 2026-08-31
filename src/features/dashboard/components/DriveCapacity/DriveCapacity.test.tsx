import { render, screen } from "@testing-library/react";
import type { Drive } from "@/lib/api/drives";
import { DriveCapacity } from "./DriveCapacity";

const onlineDrive: Drive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  volume_label: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive",
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

const offlineDrive: Drive = { ...onlineDrive, id: 2, name: "Ektachrome", online: false, mount_path: null };

it("renders a drive row with name, online badge, and capacity", () => {
  render(<DriveCapacity drives={[onlineDrive]} />);
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText("ONLINE")).toBeInTheDocument();
  expect(screen.getByText("477 MB of 1.9 GB")).toBeInTheDocument();
});

it("shows OFFLINE for an offline drive", () => {
  render(<DriveCapacity drives={[offlineDrive]} />);
  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
});

it("renders a capacity progress bar with an accessible label", () => {
  render(<DriveCapacity drives={[onlineDrive]} />);
  expect(screen.getByRole("progressbar", { name: "Kodachrome capacity" })).toBeInTheDocument();
});

it("shows an empty state when there are no drives", () => {
  render(<DriveCapacity drives={[]} />);
  expect(screen.getByText("No drives registered.")).toBeInTheDocument();
});

it("clamps used to capacity when free is negative", () => {
  const negativeFreeDrive: Drive = { ...onlineDrive, free: -100 };
  render(<DriveCapacity drives={[negativeFreeDrive]} />);
  expect(screen.getByText("1.9 GB of 1.9 GB")).toBeInTheDocument();
});

it("clamps used to 0 when free exceeds capacity", () => {
  const overFreeDrive: Drive = { ...onlineDrive, free: 3_000_000_000 };
  render(<DriveCapacity drives={[overFreeDrive]} />);
  expect(screen.getByText("0 B of 1.9 GB")).toBeInTheDocument();
});

it("shows 0 B used of 0 B when capacity is 0", () => {
  const zeroCapacityDrive: Drive = { ...onlineDrive, capacity: 0, free: 0 };
  render(<DriveCapacity drives={[zeroCapacityDrive]} />);
  expect(screen.getByText("0 B of 0 B")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Kodachrome capacity" })).toBeInTheDocument();
});
