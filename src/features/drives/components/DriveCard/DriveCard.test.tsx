import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import type { JobEvent } from "@/lib/api/scan";
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

it("calls onScan when the Scan button is clicked for an online drive", () => {
  const onScan = vi.fn();
  render(<DriveCard drive={baseDrive} onScan={onScan} />);
  fireEvent.click(screen.getByRole("button", { name: /scan/i }));
  expect(onScan).toHaveBeenCalled();
});

it("disables the Scan button when the drive is offline", () => {
  render(<DriveCard drive={{ ...baseDrive, online: false, mount_path: null }} onScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: /scan/i })).toBeDisabled();
});

it("renders ScanProgress when a scanEvent is present", () => {
  const scanEvent: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  render(<DriveCard drive={baseDrive} scanEvent={scanEvent} onCancelScan={vi.fn()} />);
  expect(screen.getByText("3 / 10")).toBeInTheDocument();
});

it("does not render ScanProgress when there is no scanEvent", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
});

it("disables the Scan button while a scan is in progress", () => {
  const scanEvent: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  render(<DriveCard drive={baseDrive} onScan={vi.fn()} scanEvent={scanEvent} onCancelScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: /scan/i })).toBeDisabled();
});

it("re-enables the Scan button once the scan has finished", () => {
  const scanEvent: JobEvent = { kind: "finished", job_id: "scan-0", ok: 10, failed: 0, skipped: 0 };
  render(<DriveCard drive={baseDrive} onScan={vi.fn()} scanEvent={scanEvent} onCancelScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: /scan/i })).not.toBeDisabled();
});

it("re-enables the Scan button once the scan has been cancelled", () => {
  const scanEvent: JobEvent = { kind: "cancelled", job_id: "scan-0" };
  render(<DriveCard drive={baseDrive} onScan={vi.fn()} scanEvent={scanEvent} onCancelScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: /scan/i })).not.toBeDisabled();
});
