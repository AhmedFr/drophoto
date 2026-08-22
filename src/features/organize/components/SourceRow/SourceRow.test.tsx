import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { UnorganizedRow } from "../../hooks/useUnorganized.types";
import { SourceRow } from "./SourceRow";

const summary: UnorganizedRow = {
  drive_id: 1,
  count: 3,
  bytes: 3_000_000,
  photos: 2,
  videos: 1,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-10-12T00:00:00Z",
  drive: {
    id: 1,
    name: "Kodachrome",
    volume_uuid: null,
    mount_path: "/Volumes/Kodachrome",
    role: "archive",
    capacity: 2_000_000_000,
    free: 1_500_000_000,
    last_seen_at: "2026-08-22T00:00:00Z",
    online: true,
  },
};

it("renders the drive name and mount path", () => {
  render(<SourceRow summary={summary} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText("/Volumes/Kodachrome")).toBeInTheDocument();
});

it("renders photo/video counts, date range, and size", () => {
  render(<SourceRow summary={summary} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(
    screen.getByText("2 photos · 1 videos · September 2025 – October 2025 · 2.9 MB"),
  ).toBeInTheDocument();
});

it("collapses the date range when earliest and latest are the same month", () => {
  render(
    <SourceRow
      summary={{ ...summary, latest: "2025-09-20T00:00:00Z" }}
      selected={false}
      onToggle={vi.fn()}
      onScan={vi.fn()}
    />,
  );
  expect(screen.getByText(/September 2025 · 2.9 MB/)).toBeInTheDocument();
});

it("calls onToggle when the checkbox is clicked", () => {
  const onToggle = vi.fn();
  render(<SourceRow summary={summary} selected={false} onToggle={onToggle} onScan={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onToggle).toHaveBeenCalled();
});

it("shows the checkbox checked when selected", () => {
  render(<SourceRow summary={summary} selected={true} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("shows a SCAN NOW prompt instead of a checkbox when the drive has never been scanned", () => {
  const neverScanned: UnorganizedRow = { ...summary, count: 0, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(<SourceRow summary={neverScanned} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("No unorganized photos — scan to index")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /scan now/i })).toBeInTheDocument();
});

it("calls onScan when SCAN NOW is clicked", () => {
  const onScan = vi.fn();
  const neverScanned: UnorganizedRow = { ...summary, count: 0, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(<SourceRow summary={neverScanned} selected={false} onToggle={vi.fn()} onScan={onScan} />);
  fireEvent.click(screen.getByRole("button", { name: /scan now/i }));
  expect(onScan).toHaveBeenCalled();
});

it("disables the SCAN NOW button while scanning", () => {
  const neverScanned: UnorganizedRow = { ...summary, count: 0, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(
    <SourceRow summary={neverScanned} selected={false} onToggle={vi.fn()} onScan={vi.fn()} scanning />,
  );
  expect(screen.getByRole("button", { name: /scanning/i })).toBeDisabled();
});
