import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { PREVIEW_EDGES } from "@/lib/api/settings";
import { QualityPicker, estimatedPreviewBytes } from "./QualityPicker";
import type { QualityPickerProps } from "./QualityPicker.types";

function props(overrides: Partial<QualityPickerProps> = {}): QualityPickerProps {
  return {
    currentEdge: PREVIEW_EDGES.max,
    previewsBytes: 2_600_000_000,
    applying: false,
    onApply: vi.fn(),
    regenApplicable: false,
    regenRunning: false,
    onRegen: vi.fn(),
    ...overrides,
  };
}

describe("estimatedPreviewBytes", () => {
  it("returns the current bytes unchanged when the edge matches currentEdge", () => {
    expect(estimatedPreviewBytes(PREVIEW_EDGES.balanced, PREVIEW_EDGES.balanced, 1_000_000)).toBe(1_000_000);
    expect(estimatedPreviewBytes(PREVIEW_EDGES.max, PREVIEW_EDGES.max, 2_600_000_000)).toBe(2_600_000_000);
  });

  it("scales down by the square of the edge ratio, anchored on currentEdge", () => {
    // anchored at max (2000): (1200/2000)^2 = 0.36, (800/2000)^2 = 0.16
    expect(estimatedPreviewBytes(PREVIEW_EDGES.balanced, PREVIEW_EDGES.max, 1_000_000)).toBe(360_000);
    expect(estimatedPreviewBytes(PREVIEW_EDGES.compact, PREVIEW_EDGES.max, 1_000_000)).toBe(160_000);
  });

  it("anchors on the CURRENT edge, not max — the same target edge scales differently depending on where the cache actually sits today", () => {
    // anchored at balanced (1200) instead of max: (800/1200)^2 = 0.4444...
    expect(estimatedPreviewBytes(PREVIEW_EDGES.compact, PREVIEW_EDGES.balanced, 900_000)).toBe(400_000);
  });

  it("clamps an upscale to the current bytes rather than predicting growth", () => {
    // At Compact (800) today, "predicting" what Balanced/Max would cost by
    // scaling up would be dishonest — a rescan is required to know that,
    // and it can't shrink either way. Both clamp to the current total.
    expect(estimatedPreviewBytes(PREVIEW_EDGES.balanced, PREVIEW_EDGES.compact, 500_000)).toBe(500_000);
    expect(estimatedPreviewBytes(PREVIEW_EDGES.max, PREVIEW_EDGES.compact, 500_000)).toBe(500_000);
  });
});

describe("QualityPicker", () => {
  it("pre-selects the radio matching currentEdge", () => {
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.balanced })} />);
    expect(screen.getByRole("radio", { name: /Balanced/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Max/ })).not.toBeChecked();
  });

  it("shows an estimated size per step scaled from previewsBytes", () => {
    render(<QualityPicker {...props({ previewsBytes: 2_600_000_000 })} />);
    expect(screen.getByText("~2.4 GB")).toBeInTheDocument(); // max, unchanged
  });

  it("anchors the per-step estimates on currentEdge, not on the current cache's own quality — an upscale never predicts growth", () => {
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.balanced, previewsBytes: 900_000 })} />);
    // Balanced (currentEdge, ratio 1) and Max (an upscale, clamped to
    // ratio 1) both show today's real total — Max must NOT be shown as
    // costing more than what's actually on disk right now.
    expect(screen.getAllByText("~879 KB")).toHaveLength(2);
    // Compact (a real downscale from the current edge) still scales down.
    expect(screen.getByText("~391 KB")).toBeInTheDocument();
  });

  it("shows a placeholder instead of an estimate when previewsBytes is unknown", () => {
    render(<QualityPicker {...props({ previewsBytes: null })} />);
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("disables Apply until a different step is selected", async () => {
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.max })} />);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: /Compact/ }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("calls onApply with the staged edge when Apply is clicked", async () => {
    const onApply = vi.fn();
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.max, onApply })} />);

    await userEvent.click(screen.getByRole("radio", { name: /Balanced/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith(PREVIEW_EDGES.balanced);
  });

  it("shows the downscale copy when staging a lower quality", async () => {
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.max })} />);
    await userEvent.click(screen.getByRole("radio", { name: /Compact/ }));
    expect(screen.getByText(/frees space after you regenerate previews/)).toBeInTheDocument();
  });

  it("shows the full-rescan copy when staging a higher quality", async () => {
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.compact })} />);
    await userEvent.click(screen.getByRole("radio", { name: /Max/ }));
    expect(screen.getByText(/needs a full rescan with drives connected/)).toBeInTheDocument();
  });

  it("shows neither notice while the staged step matches the current one", () => {
    render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.max })} />);
    expect(screen.queryByText(/frees space/)).not.toBeInTheDocument();
    expect(screen.queryByText(/full rescan/)).not.toBeInTheDocument();
  });

  it("disables the picker and Apply while applying", () => {
    render(<QualityPicker {...props({ applying: true })} />);
    expect(screen.getByRole("radio", { name: /Max/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
  });

  it("shows a regenerate-previews button only when a regen is applicable", () => {
    const { rerender } = render(<QualityPicker {...props({ regenApplicable: false })} />);
    expect(screen.queryByRole("button", { name: /Regenerate previews/ })).not.toBeInTheDocument();

    rerender(<QualityPicker {...props({ regenApplicable: true })} />);
    expect(screen.getByRole("button", { name: "Regenerate previews" })).toBeInTheDocument();
  });

  it("calls onRegen when the regenerate-previews button is clicked", async () => {
    const onRegen = vi.fn();
    render(<QualityPicker {...props({ regenApplicable: true, onRegen })} />);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate previews" }));
    expect(onRegen).toHaveBeenCalledTimes(1);
  });

  it("disables and relabels the regenerate-previews button while one is running", () => {
    render(<QualityPicker {...props({ regenApplicable: true, regenRunning: true })} />);
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  });

  it("resets the staged step when currentEdge changes underneath it", () => {
    const { rerender } = render(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.max })} />);
    rerender(<QualityPicker {...props({ currentEdge: PREVIEW_EDGES.compact })} />);
    expect(screen.getByRole("radio", { name: /Compact/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});
