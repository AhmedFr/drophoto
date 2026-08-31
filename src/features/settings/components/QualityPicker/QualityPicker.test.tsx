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
  it("returns the current bytes unchanged at max quality", () => {
    expect(estimatedPreviewBytes(PREVIEW_EDGES.max, 2_600_000_000)).toBe(2_600_000_000);
  });

  it("scales down by the square of the edge ratio for a lower quality", () => {
    // (1200/2000)^2 = 0.36
    expect(estimatedPreviewBytes(PREVIEW_EDGES.balanced, 1_000_000)).toBe(360_000);
    // (800/2000)^2 = 0.16
    expect(estimatedPreviewBytes(PREVIEW_EDGES.compact, 1_000_000)).toBe(160_000);
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
