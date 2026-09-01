import type { ReactElement } from "react";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { JobEvent } from "@/lib/api/scan";
import { ScanProgress } from "./ScanProgress";

function progressIndicatorClass(container: HTMLElement): string {
  return container.querySelector('[data-slot="progress-indicator"]')?.className ?? "";
}

// `render` (not `rtlRender`) throughout — most existing tests below don't
// pass `driveId`, so `ScanProgress` never mounts `ScanErrorSeverityHoverCard`
// and never touches this context, but the handful of new tests that do
// pass `driveId` need a `QueryClient` in context, same as `DriveCard.test.tsx`.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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

it("appends the skipped count when some files were skipped", () => {
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 3 };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByText("9 ok · 1 failed · 3 skipped")).toBeInTheDocument();
});

it("reads as up to date when a rescan skipped everything and touched nothing", () => {
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 0, failed: 0, skipped: 15988 };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);
  expect(screen.getByText("Up to date · 15988 skipped")).toBeInTheDocument();
  expect(screen.queryByText(/^0 ok/)).not.toBeInTheDocument();
});

it("hides the cancel button when cancelled", () => {
  const event: JobEvent = { kind: "cancelled", job_id: "scan-0", ok: 3, failed: 0, skipped: 0 };
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

it("turns the failed count into a button when onOpenErrors is given and failed > 0", () => {
  const onOpenErrors = vi.fn();
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 8, failed: 2, skipped: 0 };
  render(<ScanProgress event={event} onCancel={vi.fn()} onOpenErrors={onOpenErrors} />);

  const button = screen.getByRole("button", { name: "2 failed" });
  fireEvent.click(button);
  expect(onOpenErrors).toHaveBeenCalled();
});

it("does not render a failed button when failed is 0, even with onOpenErrors given", () => {
  const onOpenErrors = vi.fn();
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 8, failed: 0, skipped: 0 };
  render(<ScanProgress event={event} onCancel={vi.fn()} onOpenErrors={onOpenErrors} />);

  expect(screen.queryByRole("button", { name: /failed/i })).not.toBeInTheDocument();
});

it("renders the failed count as plain text when onOpenErrors is not given", () => {
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 8, failed: 2, skipped: 0 };
  render(<ScanProgress event={event} onCancel={vi.fn()} />);

  expect(screen.getByText("8 ok · 2 failed")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /failed/i })).not.toBeInTheDocument();
});

it("renders the progress bar indeterminate for a started event, with no per-file counts yet", () => {
  const event: JobEvent = { kind: "started", job_id: "scan-0" };
  const { container } = render(<ScanProgress event={event} onCancel={vi.fn()} />);

  expect(progressIndicatorClass(container)).toContain("animate-[scan-indeterminate");
  expect(screen.getByText("0 / 0")).toBeInTheDocument();
});

it("renders the progress bar indeterminate during a total:0 progress event, showing its current label", () => {
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 0, total: 0, current: "Scanning /DCIM" };
  const { container } = render(<ScanProgress event={event} onCancel={vi.fn()} />);

  expect(progressIndicatorClass(container)).toContain("animate-[scan-indeterminate");
  expect(screen.getByText("Scanning /DCIM")).toBeInTheDocument();
});

it("still allows cancelling while the bar is indeterminate", () => {
  const onCancel = vi.fn();
  const event: JobEvent = { kind: "started", job_id: "scan-0" };
  render(<ScanProgress event={event} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onCancel).toHaveBeenCalled();
});

it("switches the bar to determinate once a progress event reports a nonzero total", () => {
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  const { container } = render(<ScanProgress event={event} onCancel={vi.fn()} />);

  expect(screen.getByText("3 / 10")).toBeInTheDocument();
  expect(progressIndicatorClass(container)).not.toContain("animate-[scan-indeterminate");
});

it("renders the same fixed block (progress bar, counts row, current-file row) for both the walk phase and real progress — no subtree swap", () => {
  const started: JobEvent = { kind: "started", job_id: "scan-0" };
  const { container: walkContainer } = render(<ScanProgress event={started} onCancel={vi.fn()} />);
  const progress: JobEvent = { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" };
  const { container: progressContainer } = render(<ScanProgress event={progress} onCancel={vi.fn()} />);

  const walkBlock = walkContainer.firstElementChild as HTMLElement;
  const progressBlock = progressContainer.firstElementChild as HTMLElement;

  // Same shape: a progress bar, a counts+cancel row, and a current-file
  // row — three children in both phases, never a completely different
  // subtree (e.g. a dot loader standing in for the whole block).
  expect(walkBlock.children).toHaveLength(3);
  expect(progressBlock.children).toHaveLength(3);
  expect(walkBlock.children[0].getAttribute("data-slot")).toBe(
    progressBlock.children[0].getAttribute("data-slot"),
  );
});

it("wraps the failed button in a severity hover card when driveId is given, and shows the repartition on hover", async () => {
  mockIPC((cmd) => {
    if (cmd === "scan_error_code_counts") return [{ code: "db", count: 2 }];
    return undefined;
  });
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 8, failed: 2, skipped: 0 };
  render(<ScanProgress event={event} onCancel={vi.fn()} onOpenErrors={vi.fn()} driveId={1} />);

  const button = screen.getByRole("button", { name: "2 failed" });
  await userEvent.hover(button);

  expect(await screen.findByText("critical")).toBeInTheDocument();
});

it("still calls onOpenErrors when the failed button is clicked with driveId given", async () => {
  mockIPC((cmd) => {
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  const onOpenErrors = vi.fn();
  const event: JobEvent = { kind: "finished", job_id: "scan-0", ok: 8, failed: 2, skipped: 0 };
  render(<ScanProgress event={event} onCancel={vi.fn()} onOpenErrors={onOpenErrors} driveId={1} />);

  fireEvent.click(screen.getByRole("button", { name: "2 failed" }));
  expect(onOpenErrors).toHaveBeenCalled();
});
