import { render, screen } from "@testing-library/react";
import type { Drive } from "@/lib/api/drives";
import { DriveCard } from "./DriveCard";

const baseDrive: Drive = {
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

it("renders the drive name, role, and free/capacity space", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText(/archive/i)).toBeInTheDocument();
  expect(screen.getByText(/1\.4.*GB/i)).toBeInTheDocument();
});

it("shows ONLINE when the drive is online", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.getByText("ONLINE")).toBeInTheDocument();
});

it("shows OFFLINE when the drive is not online", () => {
  render(<DriveCard drive={{ ...baseDrive, online: false, mount_path: null }} />);
  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
});
