import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { toast } from "sonner";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { JobEventsBridge } from "./JobEventsBridge";

vi.mock("@tauri-apps/api/event");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeEach(async () => {
  useJobsStore.setState({ events: {}, labels: {} });
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

async function mockListen() {
  const { listen } = await import("@tauri-apps/api/event");
  let handler: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementation((_name, cb) => {
    handler = cb as (event: { payload: unknown }) => void;
    return Promise.resolve(vi.fn());
  });
  return {
    // Waits for the (post-render) effect to have registered its handler
    // before invoking it — robust whether `mockListen()` or `render()`
    // happened first.
    emit: async (payload: unknown) => {
      await waitFor(() => expect(handler).toBeDefined());
      act(() => handler?.({ payload }));
    },
  };
}

function renderBridge(queryClient: QueryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <JobEventsBridge />
    </QueryClientProvider>,
  );
  return queryClient;
}

it("renders nothing", () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <JobEventsBridge />
    </QueryClientProvider>,
  );
  expect(container).toBeEmptyDOMElement();
});

it("applies every job event to the global jobs store", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit({ kind: "started", job_id: "scan-0" });
  await waitFor(() =>
    expect(useJobsStore.getState().events["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" }),
  );

  await emit({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  await waitFor(() => expect(useJobsStore.getState().events["scan-0"]).toMatchObject({ done: 3 }));
});

it("invalidates media/media-count/jobs/unorganized/drives once on finished", async () => {
  const { emit } = await mockListen();
  const queryClient = renderBridge();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  await emit({ kind: "finished", job_id: "scan-0", ok: 9, failed: 0, skipped: 1 });

  await waitFor(() => {
    for (const key of ["media", "media-count", "jobs", "unorganized", "drives"]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});

it("shows exactly one success toast per finished event, never for item_error", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit({ kind: "item_error", job_id: "scan-0", path: "a.jpg", code: "io", message: "boom" });
  await emit({ kind: "item_error", job_id: "scan-0", path: "b.jpg", code: "io", message: "boom" });
  await emit({ kind: "finished", job_id: "scan-0", ok: 8, failed: 0, skipped: 0 });

  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  expect(toast.success).toHaveBeenCalledWith("Scan finished — 8 files");
});

it("shows an error toast when finished with failures", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit({ kind: "finished", job_id: "scan-0", ok: 5, failed: 2, skipped: 0 });

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Scan finished with 2 errors"));
});

it("shows a neutral toast on cancelled", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit({ kind: "cancelled", job_id: "scan-0" });

  await waitFor(() => expect(toast).toHaveBeenCalledWith("Scan cancelled"));
});

it("uses the recorded drive label in the toast when one was set", async () => {
  useJobsStore.getState().setLabel("scan-0", "Kodachrome");
  const { emit } = await mockListen();
  renderBridge();

  await emit({ kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 });

  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Scan Kodachrome finished — 1 file"));
});
