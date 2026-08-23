import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import type { JobEvent } from "@/lib/api/scan";
import { ScanProgress } from "./ScanProgress";

it("renders nothing when there is no event", () => {
  const { container } = render(<ScanProgress event={undefined} onCancel={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows the done/total progress text", () => {
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByText("3 / 10")).toBeInTheDocument();
});

it("shows the current filename, truncated, in monospace", () => {
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "IMG_0001.jpg" };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  const filename = screen.getByText("IMG_0001.jpg");
  expect(filename).toHaveClass("truncate", "font-mono");
});

it("shows ok/failed counts when finished, and hides the cancel button", () => {
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 0 };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByText("9 ok · 1 failed")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
});

it("hides the cancel button when cancelled", () => {
  const event: JobEvent = { kind: "cancelled", job_id: "scan-0" };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
});

it("calls onCancel when the cancel button is clicked while running", () => {
  const onCancel = vi.fn();
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  render(<ScanProgress event={event} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalled();
});

it("shows a dot loader instead of the bar when the event is started", () => {
  const event: JobEvent = { kind: "started", job_id: "scan-0" };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("Scanning…")).toBeInTheDocument();
  expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
});

it("shows a dot loader instead of the bar during a total:0 progress event, using its current label", () => {
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 0, total: 0, current: "Scanning /DCIM" };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByText("Scanning /DCIM")).toBeInTheDocument();
  expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
});

it("still allows cancelling while showing the dot loader", () => {
  const onCancel = vi.fn();
  const event: JobEvent = { kind: "started", job_id: "scan-0" };
  render(<ScanProgress event={event} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalled();
});

it("shows the bar once a progress event reports a nonzero total", () => {
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByText("3 / 10")).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
