import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { toast } from "sonner";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { startSidecarSyncAll } from "@/lib/api/sidecars";
import { JobEventsBridge } from "./JobEventsBridge";

vi.mock("@tauri-apps/api/event");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/api/sidecars", () => ({
  startSidecarSyncAll: vi.fn(),
}));

beforeEach(async () => {
  useJobsStore.setState({ events: {}, labels: {} });
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(startSidecarSyncAll).mockReset().mockResolvedValue([]);
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

/** Mocks `listen` to record handlers by event name, returning an `emit` helper. */
async function mockListen() {
  const { listen } = await import("@tauri-apps/api/event");
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  vi.mocked(listen).mockImplementation((name, cb) => {
    handlers.set(name as string, cb as (event: { payload: unknown }) => void);
    return Promise.resolve(vi.fn());
  });
  return {
    // Waits for the (post-render) effect to have registered `name`'s
    // handler before invoking it — robust whether `mockListen()` or
    // `render()` happened first.
    emit: async (name: string, payload: unknown) => {
      await waitFor(() => expect(handlers.get(name)).toBeDefined());
      act(() => handlers.get(name)?.({ payload }));
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

  await emit("job", { kind: "started", job_id: "scan-0" });
  await waitFor(() =>
    expect(useJobsStore.getState().events["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" }),
  );

  await emit("job", { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  await waitFor(() => expect(useJobsStore.getState().events["scan-0"]).toMatchObject({ done: 3 }));
});

it("invalidates media/media-count/jobs/unorganized/drives once on finished", async () => {
  const { emit } = await mockListen();
  const queryClient = renderBridge();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  await emit("job", { kind: "finished", job_id: "scan-0", ok: 9, failed: 0, skipped: 1 });

  await waitFor(() => {
    for (const key of ["media", "media-count", "jobs", "unorganized", "drives"]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
});

it("shows exactly one success toast per finished event, never for item_error", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "item_error", job_id: "scan-0", path: "a.jpg", code: "io", message: "boom" });
  await emit("job", { kind: "item_error", job_id: "scan-0", path: "b.jpg", code: "io", message: "boom" });
  await emit("job", { kind: "finished", job_id: "scan-0", ok: 8, failed: 0, skipped: 0 });

  await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  expect(toast.success).toHaveBeenCalledWith("Scan finished — 8 files");
});

it("shows an error toast when finished with failures", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "finished", job_id: "scan-0", ok: 5, failed: 2, skipped: 0 });

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Scan finished with 2 errors"));
});

it("shows a neutral toast with the ok tally on cancelled", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "cancelled", job_id: "scan-0", ok: 3, failed: 0, skipped: 0 });

  await waitFor(() => expect(toast).toHaveBeenCalledWith("Scan cancelled — 3 files done"));
});

it("uses the recorded drive label in the toast when one was set", async () => {
  useJobsStore.getState().setLabel("scan-0", "Kodachrome");
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 });

  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Scan Kodachrome finished — 1 file"));
});

it("triggers a sidecar sync sweep when a scan job finishes", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 });

  await waitFor(() => expect(startSidecarSyncAll).toHaveBeenCalledTimes(1));
});

it("does not trigger a sidecar sync sweep when an organize job finishes", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "finished", job_id: "organize-0", ok: 1, failed: 0, skipped: 0 });

  // Give any (wrongly) fired async trigger a chance to run before asserting its absence.
  await waitFor(() => expect(useJobsStore.getState().events["organize-0"]).toBeDefined());
  expect(startSidecarSyncAll).not.toHaveBeenCalled();
});

it("triggers a sidecar sync sweep when a drives:changed event arrives", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("drives:changed", null);

  await waitFor(() => expect(startSidecarSyncAll).toHaveBeenCalledTimes(1));
});

it("does not re-trigger a sidecar sync sweep when a sidecar sync job itself finishes (loop guard)", async () => {
  const { emit } = await mockListen();
  renderBridge();

  await emit("job", { kind: "finished", job_id: "sidecar-0", ok: 1, failed: 0, skipped: 0 });

  // Give any (wrongly) fired async trigger a chance to run before asserting its absence.
  await waitFor(() => expect(useJobsStore.getState().events["sidecar-0"]).toBeDefined());
  expect(startSidecarSyncAll).not.toHaveBeenCalled();
});
