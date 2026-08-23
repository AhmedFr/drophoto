import { act, screen } from "@testing-library/react";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { ActiveJobs } from "./ActiveJobs";

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {} });
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

it("renders one row per active job", async () => {
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
  useJobsStore.getState().applyEvent({ kind: "started", job_id: "organize-0" });
  renderWithRouter(<ActiveJobs />);

  expect(await screen.findAllByRole("link")).toHaveLength(2);
});
