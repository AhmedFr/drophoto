import { act, screen } from "@testing-library/react";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { ActiveJobs } from "./ActiveJobs";

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {}, samples: {} });
});

it("renders nothing when no jobs are active", async () => {
  const { container } = renderWithRouter(<ActiveJobs />);
  // Router route resolution is async; flush it before asserting the
  // negative, otherwise this would pass trivially before anything —
  // including the router's own shell — has finished rendering.
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});

it("renders nothing once every job is terminal", async () => {
  useJobsStore.getState().applyEvent({ kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 });
  const { container } = renderWithRouter(<ActiveJobs />);
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});

it("renders a row per active job with its kind and drive label", async () => {
  useJobsStore.getState().setLabel("scan-0", "Kodachrome");
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByText("Scan Kodachrome")).toBeInTheDocument();
});

it("shows done/total for a progress event with a total", async () => {
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByText("3/10")).toBeInTheDocument();
});

it("shows a dot loader instead of done/total when total is 0", async () => {
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 0, total: 0, current: "a.jpg" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("status")).toBeInTheDocument();
  expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
});

it("shows a dot loader for a started event (no progress yet)", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("status")).toBeInTheDocument();
});

it("links a scan job to /drives", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("link")).toHaveAttribute("href", "/drives");
});

it("links an organize job to /organize", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "organize-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("link")).toHaveAttribute("href", "/organize");
});

it("links a revert job to /organize", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "revert-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("link")).toHaveAttribute("href", "/organize");
});

it("links a sidecar sync job to /drives", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "sidecar-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("link")).toHaveAttribute("href", "/drives");
  expect(await screen.findByText("Sidecar sync")).toBeInTheDocument();
});

// Regression test for review finding 6: a `regen-*` row used to fall
// through `targetPath`'s catch-all and route to `/organize`, so clicking
// "REGENERATE PREVIEWS" in the sidebar sent the user into the Organize
// wizard instead of back to Settings, where the sweep was started from.
it("links a regen-previews job to /settings", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "regen-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("link")).toHaveAttribute("href", "/settings");
  expect(await screen.findByText("Regenerate previews")).toBeInTheDocument();
});

it("renders one row per active job", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "organize-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findAllByRole("link")).toHaveLength(2);
});

it("shows no rate/eta with fewer than 2 progress samples", async () => {
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByText("3/10")).toBeInTheDocument();
  expect(screen.queryByText(/\/s/)).not.toBeInTheDocument();
});

it("shows a computed rate and eta once enough samples have landed", async () => {
  // `Date.now` is stubbed rather than reaching for fake timers, so the
  // router's own async route resolution (which `renderWithRouter`
  // depends on, via real timers) isn't disturbed.
  const nowSpy = vi.spyOn(Date, "now");
  nowSpy.mockReturnValueOnce(0);
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 0, total: 100, current: "a" });
  nowSpy.mockReturnValueOnce(10_000);
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 20, total: 100, current: "b" });
  nowSpy.mockReturnValue(10_000);

  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByText(/2\.0\/s/)).toBeInTheDocument();
  expect(screen.getByText(/left/)).toBeInTheDocument();
  nowSpy.mockRestore();
});

// Regression test: the row used to cram label + counts + rate/ETA onto a
// single flex line, which overflowed the sidebar's 212px strip during a
// real scan ("715/16210 · 56.5/s · ~4m 34s left"). The rework stacks the
// readout: the rate/ETA lives on its own full-width, nowrap line so it can
// never collide with the label, and it keeps a fixed height (`h-3`) while
// empty so the row doesn't grow when the first rate sample lands.
it("renders the rate/ETA on its own fixed-height nowrap line, separate from the label", async () => {
  const nowSpy = vi.spyOn(Date, "now");
  nowSpy.mockReturnValueOnce(0);
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 0, total: 100, current: "a" });
  nowSpy.mockReturnValueOnce(10_000);
  useJobsStore.getState().setLabel("scan-0", "T7");
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 20, total: 100, current: "b" });
  nowSpy.mockReturnValue(10_000);

  renderWithRouter(<ActiveJobs />);

  const rateLine = await screen.findByText(/2\.0\/s · ~\d+.* left/);
  expect(rateLine).toHaveClass("whitespace-nowrap", "h-3");
  // The label lives on a different line entirely — never a flex sibling
  // competing for the same row's width.
  const label = screen.getByText("Scan T7");
  expect(rateLine.parentElement).not.toBe(label.parentElement);
  nowSpy.mockRestore();
});

it("shows a determinate progress bar once the scan has a total", async () => {
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("progressbar")).toBeInTheDocument();
});

it("keeps the progress bar mounted (indeterminate) during the walk phase, total 0", async () => {
  useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 0, total: 0, current: "a.jpg" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findByRole("progressbar")).toBeInTheDocument();
  expect(screen.getByRole("status")).toBeInTheDocument();
});
