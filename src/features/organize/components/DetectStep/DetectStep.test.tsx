import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { UnorganizedRow } from "../../hooks/useUnorganized.types";
import { DetectStep } from "./DetectStep";

function drive(id: number, name: string, online = true) {
  return {
    id,
    name,
    volume_uuid: null,
    mount_path: `/Volumes/${name}`,
    role: "archive" as const,
    capacity: 2_000_000_000,
    free: 1_500_000_000,
    last_seen_at: "2026-08-22T00:00:00Z",
    online,
  };
}

const summaries: UnorganizedRow[] = [
  {
    drive_id: 1,
    count: 10,
    total: 12,
    bytes: 1_000_000,
    photos: 8,
    videos: 2,
    earliest: "2025-09-01T00:00:00Z",
    latest: "2025-09-12T00:00:00Z",
    legacy: 0,
    has_sources: true,
    drive: drive(1, "Kodachrome"),
  },
  {
    drive_id: 2,
    count: 5,
    total: 5,
    bytes: 500_000,
    photos: 5,
    videos: 0,
    earliest: "2025-08-01T00:00:00Z",
    latest: "2025-08-12T00:00:00Z",
    legacy: 0,
    has_sources: true,
    drive: drive(2, "Ektachrome"),
  },
];

it("renders a row per summary", () => {
  render(
    <DetectStep
      summaries={summaries}
      selected={[]}
      onToggle={vi.fn()}
      onScan={vi.fn()}
      organizedCount={0}
    />,
  );
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText("Ektachrome")).toBeInTheDocument();
});

it("shows 0 new photos found and 0 drives when nothing is selected", () => {
  render(
    <DetectStep
      summaries={summaries}
      selected={[]}
      onToggle={vi.fn()}
      onScan={vi.fn()}
      organizedCount={0}
    />,
  );
  const numbers = screen.getAllByText("0");
  expect(numbers).toHaveLength(2);
});

it("sums counts across selected drives for NEW PHOTOS FOUND and counts selected drives", () => {
  render(
    <DetectStep
      summaries={summaries}
      selected={[1, 2]}
      onToggle={vi.fn()}
      onScan={vi.fn()}
      organizedCount={0}
    />,
  );
  expect(screen.getByText("15")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
});

it("shows the already-organized count in the text cell", () => {
  render(
    <DetectStep
      summaries={summaries}
      selected={[]}
      onToggle={vi.fn()}
      onScan={vi.fn()}
      organizedCount={42}
    />,
  );
  expect(screen.getByText(/42 already organized/)).toBeInTheDocument();
});

it("calls onToggle with the drive id when a row's checkbox is clicked", () => {
  const onToggle = vi.fn();
  render(
    <DetectStep
      summaries={summaries}
      selected={[]}
      onToggle={onToggle}
      onScan={vi.fn()}
      organizedCount={0}
    />,
  );
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  expect(onToggle).toHaveBeenCalledWith(1);
});

it("calls onScan with the drive id for a never-scanned drive", () => {
  const onScan = vi.fn();
  const neverScanned: UnorganizedRow = {
    drive_id: 3,
    count: 0,
    total: 0,
    bytes: 0,
    photos: 0,
    videos: 0,
    earliest: null,
    latest: null,
    legacy: 0,
    has_sources: true,
    drive: drive(3, "New Drive"),
  };
  render(
    <DetectStep
      summaries={[neverScanned]}
      selected={[]}
      onToggle={vi.fn()}
      onScan={onScan}
      organizedCount={0}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /scan now/i }));
  expect(onScan).toHaveBeenCalledWith(3);
});

it("renders a fallback message when there are no online drives", () => {
  render(
    <DetectStep summaries={[]} selected={[]} onToggle={vi.fn()} onScan={vi.fn()} organizedCount={0} />,
  );
  expect(screen.getByText("No drives online.")).toBeInTheDocument();
});

it("shows a legacy-rows notice summing legacy across every drive when any are present", () => {
  const withLegacy: UnorganizedRow[] = [
    { ...summaries[0], legacy: 3 },
    { ...summaries[1], legacy: 4 },
  ];
  render(
    <DetectStep summaries={withLegacy} selected={[]} onToggle={vi.fn()} onScan={vi.fn()} organizedCount={0} />,
  );
  expect(
    screen.getByText("7 files from older scans aren't covered by a source — re-scan to include them."),
  ).toBeInTheDocument();
});

it("does not show a legacy-rows notice when no drive has legacy rows", () => {
  render(
    <DetectStep summaries={summaries} selected={[]} onToggle={vi.fn()} onScan={vi.fn()} organizedCount={0} />,
  );
  expect(screen.queryByText(/older scans/)).not.toBeInTheDocument();
});
