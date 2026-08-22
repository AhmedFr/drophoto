import { render, screen } from "@testing-library/react";
import type { Drive } from "@/lib/api/drives";
import { DriveCapacity } from "./DriveCapacity";

const onlineDrive: Drive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
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
