import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { SourceRow } from "../../hooks/useSourcesDialog.types";
import { DetectedFolderRow } from "./DetectedFolderRow";

const baseRow: SourceRow = {
  rel_path: "DCIM",
  media_count: 42,
  bytes: 1_048_576,
  suggested: false,
  checked: false,
  existing: false,
};

it("shows the rel_path as the label", () => {
  render(<DetectedFolderRow row={baseRow} onToggle={vi.fn()} />);
  expect(screen.getByText("DCIM")).toBeInTheDocument();
});

it("shows 'Whole drive' for an empty rel_path", () => {
  render(<DetectedFolderRow row={{ ...baseRow, rel_path: "" }} onToggle={vi.fn()} />);
  expect(screen.getByText("Whole drive")).toBeInTheDocument();
});

it("shows the media count and formatted size", () => {
  render(<DetectedFolderRow row={baseRow} onToggle={vi.fn()} />);
  expect(screen.getByText("42 photos · 1 MB")).toBeInTheDocument();
});

it("shows the SUGGESTED badge when suggested", () => {
  render(<DetectedFolderRow row={{ ...baseRow, suggested: true }} onToggle={vi.fn()} />);
  expect(screen.getByText("SUGGESTED")).toBeInTheDocument();
});

it("hides the SUGGESTED badge when not suggested", () => {
  render(<DetectedFolderRow row={baseRow} onToggle={vi.fn()} />);
  expect(screen.queryByText("SUGGESTED")).not.toBeInTheDocument();
});

it("reflects the checked state", () => {
  render(<DetectedFolderRow row={{ ...baseRow, checked: true }} onToggle={vi.fn()} />);
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("calls onToggle when the checkbox is clicked", () => {
  const onToggle = vi.fn();
  render(<DetectedFolderRow row={baseRow} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(onToggle).toHaveBeenCalled();
});

it("omits the count when media_count is null (a manually added folder)", () => {
  render(<DetectedFolderRow row={{ ...baseRow, media_count: null, bytes: null }} onToggle={vi.fn()} />);
  expect(screen.queryByText(/photos/)).not.toBeInTheDocument();
});
