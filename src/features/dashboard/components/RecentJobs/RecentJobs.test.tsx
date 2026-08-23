import type { ReactNode } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { JobEvent } from "@/lib/api/scan";
import type { OrganizeJobRow } from "@/lib/api/organize";
import { RecentJobs } from "./RecentJobs";

beforeEach(() => {
  // `RecentJobs` renders `useRevertRow`, which reads job events from the
  // global `jobsStore` (via `useJobEvents`) rather than listening for the
  // "job" Tauri event itself — in the real app `JobEventsBridge` applies
  // those events, so tests seed the store directly instead of mocking
  // `listen`.
  useJobsStore.setState({ events: {}, labels: {} });
});

/** Seeds job events straight into the global jobs store, returning an `emit` helper. */
function mockListen() {
  return { emit: (payload: unknown) => act(() => useJobsStore.getState().applyEvent(payload as JobEvent)) };
}

const now = new Date("2026-08-22T12:10:00Z").getTime();

const doneJob: OrganizeJobRow = {
  id: 1,
  drive_id: 1,
  drive_name: "Kodachrome",
  status: "done",
  planned: 10,
  moved: 9,
  skipped: 1,
  failed: 0,
  started_at: "2026-08-22T12:00:00Z",
  finished_at: "2026-08-22T12:08:00Z",
  kind: "organize",
  reverts_job_id: null,
  reverted_by_job_id: null,
};

const runningJob: OrganizeJobRow = {
  id: 2,
  drive_id: 2,
  drive_name: "Ektachrome",
  status: "running",
  planned: 5,
  moved: 2,
  skipped: 0,
  failed: 0,
  started_at: "2026-08-22T12:09:00Z",
  finished_at: null,
  kind: "organize",
  reverts_job_id: null,
  reverted_by_job_id: null,
};

function renderJobs(jobs: OrganizeJobRow[]) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <RecentJobs jobs={jobs} now={now} />
    </QueryClientProvider>,
  );
}

function renderJobsWithRouter(jobs: OrganizeJobRow[]) {
  const queryClient = new QueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderWithRouter(
    <Wrapper>
      <RecentJobs jobs={jobs} now={now} />
    </Wrapper>,
  );
}

it("renders a job row with status, drive name, counts, and relative time", () => {
  renderJobs([doneJob]);

  expect(screen.getByText("DONE")).toBeInTheDocument();
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText("9/10 moved · 1 skipped · 0 failed")).toBeInTheDocument();
  expect(screen.getByText("2 min ago")).toBeInTheDocument();
});

it("shows a pulsing dot for a running job", () => {
  const { container } = renderJobs([runningJob]);
  expect(screen.getByText("RUNNING")).toBeInTheDocument();
  expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
});

it("does not show a pulsing dot for a non-running job", () => {
  const { container } = renderJobs([doneJob]);
  expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
});

it("uses started_at for a running job's relative time", () => {
  renderJobs([runningJob]);
  expect(screen.getByText("1 min ago")).toBeInTheDocument();
});

it("uppercases cancelled and failed statuses", () => {
  renderJobs([
    { ...doneJob, id: 3, status: "cancelled" },
    { ...doneJob, id: 4, status: "failed" },
  ]);
  expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  expect(screen.getByText("FAILED")).toBeInTheDocument();
});

it("shows an empty state with a link to /organize when there are no jobs", async () => {
  renderJobsWithRouter([]);
  expect(await screen.findByText(/No organize jobs yet\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Organize now" })).toHaveAttribute("href", "/organize");
});

it("shows a REVERT badge and 'of job #N' for a revert row", () => {
  const revertJob: OrganizeJobRow = {
    ...doneJob,
    id: 5,
    kind: "revert",
    reverts_job_id: 1,
  };
  renderJobs([revertJob]);
  expect(screen.getByText("REVERT")).toBeInTheDocument();
  expect(screen.getByText("of job #1")).toBeInTheDocument();
});

it("shows a REVERT action button for an eligible organize job", () => {
  renderJobs([doneJob]);
  expect(screen.getByRole("button", { name: "REVERT" })).toBeInTheDocument();
});

it("hides the REVERT action for a running job", () => {
  renderJobs([runningJob]);
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("hides the REVERT action for a job with nothing moved", () => {
  renderJobs([{ ...doneJob, moved: 0 }]);
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("hides the REVERT action for a job already reverted", () => {
  renderJobs([{ ...doneJob, reverted_by_job_id: 99 }]);
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("hides the REVERT action on a revert row itself", () => {
  renderJobs([{ ...doneJob, kind: "revert", reverts_job_id: 1 }]);
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();
});

it("opens a confirm dialog with the job's moved count when REVERT is clicked", () => {
  renderJobs([doneJob]);
  fireEvent.click(screen.getByRole("button", { name: "REVERT" }));
  expect(screen.getByText("Move 9 files back to their original locations?")).toBeInTheDocument();
});

it("calls revert_organize with the job id when the revert is confirmed", async () => {
  const revertOrganizeSpy = vi.fn().mockResolvedValue("revert-1");
  mockIPC((cmd, args) => {
    if (cmd === "revert_organize") {
      revertOrganizeSpy(args);
      return "revert-1";
    }
    return undefined;
  });
  await mockListen();

  renderJobs([doneJob]);
  fireEvent.click(screen.getByRole("button", { name: "REVERT" }));
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));

  await waitFor(() => expect(revertOrganizeSpy).toHaveBeenCalledWith({ jobId: 1 }));
});

it("shows a REVERTING badge with progress once a revert is confirmed", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  renderJobs([doneJob]);
  fireEvent.click(screen.getByRole("button", { name: "REVERT" }));
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));

  await waitFor(() => expect(screen.getByText(/REVERTING…/)).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "REVERT" })).not.toBeInTheDocument();

  emit({ kind: "progress", job_id: "revert-1", done: 3, total: 9, current: "a.jpg" });
  await waitFor(() => expect(screen.getByText("REVERTING… 3/9")).toBeInTheDocument());
});

it("shows a REVERT FAILED message and keeps the REVERT button available after a partial failure", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  renderJobs([doneJob]);
  fireEvent.click(screen.getByRole("button", { name: "REVERT" }));
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));
  await waitFor(() => expect(screen.getByText(/REVERTING…/)).toBeInTheDocument());

  emit({ kind: "finished", job_id: "revert-1", ok: 6, failed: 3, skipped: 0 });

  expect(
    await screen.findByText("REVERT FAILED — 3 files could not be moved back"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "REVERT" })).toBeInTheDocument();
});

it("shows the revert_organize call's own error message on the row", async () => {
  mockIPC((cmd) => {
    if (cmd === "revert_organize") {
      throw { code: "Unsupported", message: "another job is running on this drive" };
    }
    return undefined;
  });
  await mockListen();

  renderJobs([doneJob]);
  fireEvent.click(screen.getByRole("button", { name: "REVERT" }));
  fireEvent.click(screen.getByRole("button", { name: "Revert" }));

  expect(await screen.findByText("another job is running on this drive")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "REVERT" })).toBeInTheDocument();
});

it("does not call revert_organize when the confirm dialog is cancelled", async () => {
  const revertOrganizeSpy = vi.fn();
  mockIPC((cmd) => (cmd === "revert_organize" ? revertOrganizeSpy() : undefined));
  await mockListen();

  renderJobs([doneJob]);
  fireEvent.click(screen.getByRole("button", { name: "REVERT" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(revertOrganizeSpy).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "REVERT" })).toBeInTheDocument();
});
