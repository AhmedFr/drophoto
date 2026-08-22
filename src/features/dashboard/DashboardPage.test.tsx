import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { DashboardPage } from "./DashboardPage";

vi.mock("@tauri-apps/api/event");

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

const onlineDrive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive" as const,
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

const job = {
  id: 1,
  drive_id: 1,
  drive_name: "Kodachrome",
  status: "done",
  planned: 10,
  moved: 9,
  skipped: 1,
  failed: 0,
  started_at: "2026-08-22T00:00:00Z",
  finished_at: "2026-08-22T00:05:00Z",
};

const summary = {
  drive_id: 1,
  count: 4,
  bytes: 4000,
  photos: 3,
  videos: 1,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-09-12T00:00:00Z",
};

it("renders the header, stat tiles, a job row, and a drive row", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_jobs") return [job];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") {
      const query = (args as { query?: { kinds: string[] } } | undefined)?.query;
      const kinds = query?.kinds ?? [];
      return kinds.includes("photo") ? 120 : 8;
    }
    return undefined;
  });

  renderPage();

  expect(await screen.findByRole("heading")).toHaveTextContent("DASHBOARD");
  expect(await screen.findByText("1/1 drives online")).toBeInTheDocument();
  expect(await screen.findByText("120")).toBeInTheDocument();
  expect(screen.getByText("PHOTOS")).toBeInTheDocument();
  expect(screen.getByText("8")).toBeInTheDocument();
  expect(screen.getByText("VIDEOS")).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
  expect(screen.getByText("UNORGANIZED")).toBeInTheDocument();

  expect(await screen.findByText("DONE")).toBeInTheDocument();
  expect(screen.getByText("9/10 moved · 1 skipped · 0 failed")).toBeInTheDocument();

  expect(await screen.findByText("ONLINE")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Kodachrome capacity" })).toBeInTheDocument();
});

it("shows the empty organize jobs state when there are no jobs", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [];
    if (cmd === "list_jobs") return [];
    if (cmd === "list_unorganized_summaries") return [];
    if (cmd === "count_media") return 0;
    return undefined;
  });

  renderPage();

  expect(await screen.findByText(/No organize jobs yet\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Organize now" })).toHaveAttribute("href", "/organize");
});

it("shows an error banner when a query fails", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_jobs") throw new Error("Failed to load jobs");
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 0;
    return undefined;
  });

  renderPage();

  expect(await screen.findByText("Failed to load jobs")).toBeInTheDocument();
});
