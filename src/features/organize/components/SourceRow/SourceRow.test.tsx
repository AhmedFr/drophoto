import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import type { UnorganizedRow } from "../../hooks/useUnorganized.types";
import { SourceRow } from "./SourceRow";

const summary: UnorganizedRow = {
  drive_id: 1,
  count: 3,
  total: 5,
  bytes: 3_000_000,
  photos: 2,
  videos: 1,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-10-12T00:00:00Z",
  legacy: 0,
  has_sources: true,
  drive: {
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
  const neverScanned: UnorganizedRow = { ...summary, count: 0, total: 0, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(<SourceRow summary={neverScanned} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("No photos indexed yet — scan to index")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /scan now/i })).toBeInTheDocument();
});

it("shows All organized with a disabled checkbox when the drive is indexed but has nothing left to organize", () => {
  const allOrganized: UnorganizedRow = { ...summary, count: 0, total: 5, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(<SourceRow summary={allOrganized} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("All organized")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.queryByRole("button", { name: /scan now/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/scan to index/)).not.toBeInTheDocument();
});

it("calls onScan when SCAN NOW is clicked", () => {
  const onScan = vi.fn();
  const neverScanned: UnorganizedRow = { ...summary, count: 0, total: 0, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(<SourceRow summary={neverScanned} selected={false} onToggle={vi.fn()} onScan={onScan} />);
  fireEvent.click(screen.getByRole("button", { name: /scan now/i }));
  expect(onScan).toHaveBeenCalled();
});

it("disables the SCAN NOW button while scanning", () => {
  const neverScanned: UnorganizedRow = { ...summary, count: 0, total: 0, photos: 0, videos: 0, bytes: 0, earliest: null, latest: null };
  render(
    <SourceRow summary={neverScanned} selected={false} onToggle={vi.fn()} onScan={vi.fn()} scanning />,
  );
  expect(screen.getByRole("button", { name: /scanning/i })).toBeDisabled();
});

it("shows a re-scan hint with the legacy count when some rows aren't covered by a source", () => {
  render(<SourceRow summary={{ ...summary, legacy: 4 }} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.getByText("4 not covered by a source — re-scan")).toBeInTheDocument();
});

it("does not show a re-scan hint when every row is covered by a source", () => {
  render(<SourceRow summary={summary} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.queryByText(/not covered by a source/)).not.toBeInTheDocument();
});

it("shows the re-scan notice and SCAN NOW (not All organized) when everything left is legacy", () => {
  const legacyOnly: UnorganizedRow = {
    ...summary,
    count: 0,
    total: 5,
    photos: 0,
    videos: 0,
    bytes: 0,
    earliest: null,
    latest: null,
    legacy: 4,
    has_sources: true,
  };
  const onScan = vi.fn();
  render(<SourceRow summary={legacyOnly} selected={false} onToggle={vi.fn()} onScan={onScan} />);
  expect(screen.queryByText("All organized")).not.toBeInTheDocument();
  expect(screen.getByText("4 not covered by a source — re-scan")).toBeInTheDocument();
  const scanButton = screen.getByRole("button", { name: /scan now/i });
  fireEvent.click(scanButton);
  expect(onScan).toHaveBeenCalled();
});

it("disables SCAN NOW while scanning in the legacy-only state", () => {
  const legacyOnly: UnorganizedRow = {
    ...summary,
    count: 0,
    total: 5,
    photos: 0,
    videos: 0,
    bytes: 0,
    earliest: null,
    latest: null,
    legacy: 4,
    has_sources: true,
  };
  render(<SourceRow summary={legacyOnly} selected={false} onToggle={vi.fn()} onScan={vi.fn()} scanning />);
  expect(screen.getByRole("button", { name: /scanning/i })).toBeDisabled();
});

const neverScannedRow: UnorganizedRow = { ...summary, count: 0, total: 0, photos: 0, videos: 0, bytes: 0 };

it("shows the scan error under the button after a failed scan", () => {
  render(
    <SourceRow
      summary={neverScannedRow}
      selected={false}
      onToggle={vi.fn()}
      onScan={vi.fn()}
      scanError="a scan job is already running on this drive"
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("a scan job is already running on this drive");
  // The button stays: the failure is retryable, not terminal.
  expect(screen.getByRole("button", { name: /scan now/i })).toBeInTheDocument();
});

it("shows no alert when the last scan did not fail", () => {
  render(<SourceRow summary={neverScannedRow} selected={false} onToggle={vi.fn()} onScan={vi.fn()} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// With no enabled source a scan walks nothing, so SCAN NOW could only
// ever "succeed" having found zero photos. Send the user to Drives.
it("replaces SCAN NOW with a link to /drives when the drive has no sources", async () => {
  renderWithRouter(
    <SourceRow
      summary={{ ...neverScannedRow, has_sources: false }}
      selected={false}
      onToggle={vi.fn()}
      onScan={vi.fn()}
    />,
  );
  expect(await screen.findByRole("link", { name: /set up sources/i })).toHaveAttribute("href", "/drives");
  expect(screen.queryByRole("button", { name: /scan now/i })).not.toBeInTheDocument();
});

it("offers SCAN NOW, not the sources link, once the drive has sources", async () => {
  renderWithRouter(
    <SourceRow
      summary={{ ...neverScannedRow, has_sources: true }}
      selected={false}
      onToggle={vi.fn()}
      onScan={vi.fn()}
    />,
  );
  expect(await screen.findByRole("button", { name: /scan now/i })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /set up sources/i })).not.toBeInTheDocument();
});

it("offers the sources link over a re-scan in the legacy-only state with no sources", async () => {
  renderWithRouter(
    <SourceRow
      summary={{ ...summary, count: 0, total: 5, legacy: 4, has_sources: false }}
      selected={false}
      onToggle={vi.fn()}
      onScan={vi.fn()}
    />,
  );
  expect(await screen.findByRole("link", { name: /set up sources/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /scan now/i })).not.toBeInTheDocument();
});
