import { render, screen } from "@testing-library/react";
import { renderWithRouter } from "@/test/renderWithRouter";
import type { OrganizeJobRow } from "@/lib/api/organize";
import { RecentJobs } from "./RecentJobs";

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
};

it("renders a job row with status, drive name, counts, and relative time", () => {
  render(<RecentJobs jobs={[doneJob]} now={now} />);

  expect(screen.getByText("DONE")).toBeInTheDocument();
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText("9/10 moved · 1 skipped · 0 failed")).toBeInTheDocument();
  expect(screen.getByText("2 min ago")).toBeInTheDocument();
});

it("shows a pulsing dot for a running job", () => {
  const { container } = render(<RecentJobs jobs={[runningJob]} now={now} />);
  expect(screen.getByText("RUNNING")).toBeInTheDocument();
  expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
});

it("does not show a pulsing dot for a non-running job", () => {
  const { container } = render(<RecentJobs jobs={[doneJob]} now={now} />);
  expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
});

it("uses started_at for a running job's relative time", () => {
  render(<RecentJobs jobs={[runningJob]} now={now} />);
  expect(screen.getByText("1 min ago")).toBeInTheDocument();
});

it("uppercases cancelled and failed statuses", () => {
  render(
    <RecentJobs
      jobs={[
        { ...doneJob, id: 3, status: "cancelled" },
        { ...doneJob, id: 4, status: "failed" },
      ]}
      now={now}
    />,
  );
  expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  expect(screen.getByText("FAILED")).toBeInTheDocument();
});

it("shows an empty state with a link to /organize when there are no jobs", async () => {
  renderWithRouter(<RecentJobs jobs={[]} now={now} />);
  expect(await screen.findByText(/No organize jobs yet\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Organize now" })).toHaveAttribute("href", "/organize");
});
