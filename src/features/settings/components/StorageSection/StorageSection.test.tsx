import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { StorageUsage } from "@/lib/api/settings";
import { StorageSection, segmentWidthPct } from "./StorageSection";

function usage(overrides: Partial<StorageUsage> = {}): StorageUsage {
  return {
    thumbs_400_bytes: 1_000_000,
    previews_bytes: 8_000_000,
    catalog_bytes: 500_000,
    total_bytes: 9_500_000,
    file_count: 42,
    ...overrides,
  };
}

describe("segmentWidthPct", () => {
  it("computes the percentage share of the total", () => {
    expect(segmentWidthPct(25, 100)).toBe(25);
  });

  it("returns 0 when the total is 0, rather than dividing by zero", () => {
    expect(segmentWidthPct(0, 0)).toBe(0);
  });
});

describe("StorageSection", () => {
  it("shows a loading message on the first load", () => {
    render(<StorageSection usage={null} loading={true} error={null} refreshing={false} onRefresh={vi.fn()} />);
    expect(screen.getByText("Computing storage usage…")).toBeInTheDocument();
  });

  it("renders the byte totals for every bucket once usage resolves", () => {
    render(
      <StorageSection usage={usage()} loading={false} error={null} refreshing={false} onRefresh={vi.fn()} />,
    );
    expect(screen.getByText("Thumbnails (400px)")).toBeInTheDocument();
    expect(screen.getByText("Previews")).toBeInTheDocument();
    expect(screen.getByText("Catalog database")).toBeInTheDocument();
    expect(screen.getByText("977 KB")).toBeInTheDocument();
    expect(screen.getByText("7.6 MB")).toBeInTheDocument();
    expect(screen.getByText("488 KB")).toBeInTheDocument();
    expect(screen.getByText(/42 files/)).toBeInTheDocument();
  });

  it("shows the error alongside stale usage rather than hiding it", () => {
    render(
      <StorageSection usage={usage()} loading={false} error="boom" refreshing={false} onRefresh={vi.fn()} />,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("Previews")).toBeInTheDocument();
  });

  it("shows an unavailable message when there's no usage and no longer loading", () => {
    render(<StorageSection usage={null} loading={false} error={null} refreshing={false} onRefresh={vi.fn()} />);
    expect(screen.getByText("Storage usage unavailable.")).toBeInTheDocument();
  });

  it("calls onRefresh when the refresh button is clicked", async () => {
    const onRefresh = vi.fn();
    render(
      <StorageSection usage={usage()} loading={false} error={null} refreshing={false} onRefresh={onRefresh} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables the refresh button and relabels it while refreshing", () => {
    render(
      <StorageSection usage={usage()} loading={false} error={null} refreshing={true} onRefresh={vi.fn()} />,
    );
    const button = screen.getByRole("button", { name: "Refreshing…" });
    expect(button).toBeDisabled();
  });
});
