import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { JobEvent } from "@/lib/api/scan";
import type { OrganizeRule } from "@/lib/api/organize";
import { useWizardStore } from "./store/wizardStore";
import { OrganizePage } from "./OrganizePage";

vi.mock("@tauri-apps/api/event");

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  useWizardStore.setState({ step: 0, selectedDriveIds: [] });
  // `useOrganizeRun`/`useRevertRun` (used by this page) read job events
  // from the global `jobsStore` rather than listening for the "job"
  // Tauri event themselves — only `useUnorganized` still listens
  // directly. Reset the store so a job id from one test can't leak
  // into the next.
  useJobsStore.setState({ events: {}, labels: {}, samples: {} });
});

/** Records every `listen(name, cb)` handler so `emit` can broadcast to all of them, matching real Tauri fan-out. */
async function mockListen() {
  const { listen } = await import("@tauri-apps/api/event");
  const handlers = new Map<string, ((event: { payload: unknown }) => void)[]>();
  vi.mocked(listen).mockImplementation((name, cb) => {
    const list = handlers.get(name as string) ?? [];
    list.push(cb as (event: { payload: unknown }) => void);
    handlers.set(name as string, list);
    return Promise.resolve(vi.fn());
  });
  return {
    emit: (name: string, payload: unknown) =>
      act(() => {
        handlers.get(name)?.forEach((h) => h({ payload }));
        // `useUnorganized` gets it via the real (mocked) "job" listener
        // above; `useOrganizeRun`/`useRevertRun` read it from the store
        // instead — apply it there too so this one helper drives both.
        if (name === "job") useJobsStore.getState().applyEvent(payload as JobEvent);
      }),
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <OrganizePage />
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

const summary = {
  drive_id: 1,
  count: 10,
  total: 12,
  bytes: 1_000_000,
  photos: 8,
  videos: 2,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-09-12T00:00:00Z",
};

const rule: OrganizeRule = {
  drive_id: 1,
  root: "archive",
  folder_tpl: "{{yyyy}}/Q{{q}}",
  file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
  keep_pairs: true,
};

const planItem = {
  media_id: 1,
  old_rel_path: "DCIM/100/IMG_0001.jpg",
  new_rel_path: "archive/2025/Q3/2025-09-01_IMG_0001.jpg",
  status: "planned",
  reason: null,
};

const secondDrive = {
  ...onlineDrive,
  id: 2,
  name: "Ektachrome",
  mount_path: "/Volumes/Ektachrome",
};

const secondSummary = { ...summary, drive_id: 2 };

/** Default for commands `mockDetectApi`/`mockTwoDriveApi` don't otherwise handle — `list_jobs` defaults to empty so `useDoneSummary` doesn't error on an unmocked command. */
function defaultExtra(cmd: string): unknown {
  return cmd === "list_jobs" ? [] : undefined;
}

function mockDetectApi(extra: (cmd: string, args: unknown) => unknown = defaultExtra) {
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 20;
    if (cmd === "get_rule") return { ...rule, drive_id: (args as { driveId: number }).driveId };
    if (cmd === "plan_organize") return { items: [planItem], planned: 1, skipped_dup: 0, bytes: 1000 };
    return extra(cmd, args);
  });
}

function mockTwoDriveApi(extra: (cmd: string, args: unknown) => unknown = defaultExtra) {
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive, secondDrive];
    if (cmd === "list_unorganized_summaries") return [summary, secondSummary];
    if (cmd === "count_media") return 20;
    if (cmd === "get_rule") return { ...rule, drive_id: (args as { driveId: number }).driveId };
    if (cmd === "plan_organize")
      return {
        items: [
          planItem,
          { ...planItem, media_id: 2, new_rel_path: "archive/2025/Q3/2025-09-02_IMG_0002.jpg" },
        ],
        planned: 2,
        skipped_dup: 0,
        bytes: 2000,
      };
    return extra(cmd, args);
  });
}

async function goToStep2WithTwoDrives() {
  renderPage();
  const checkboxes = await screen.findAllByRole("checkbox");
  checkboxes.forEach((cb) => fireEvent.click(cb));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByText("STEP 02 · ORGANIZE");
}

async function goToStep2() {
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
  await screen.findByText("STEP 02 · ORGANIZE");
}

it("shows the step 01 detect header and eyebrow", async () => {
  mockDetectApi();
  renderPage();
  expect(await screen.findByRole("heading", { name: "New photos found" })).toBeInTheDocument();
  expect(screen.getByText("STEP 01 · DETECT")).toBeInTheDocument();
});

it("renders the drive row from the detected summaries", async () => {
  mockDetectApi();
  renderPage();
  expect(await screen.findByText("Kodachrome")).toBeInTheDocument();
});

it("disables CONTINUE until a drive is selected, then enables it", async () => {
  mockDetectApi();
  renderPage();
  const continueButton = await screen.findByRole("button", { name: /continue/i });
  expect(continueButton).toBeDisabled();

  fireEvent.click(await screen.findByRole("checkbox"));

  expect(continueButton).not.toBeDisabled();
});

it("advances to the Organize step with the rule editor and plan preview after CONTINUE", async () => {
  mockDetectApi();
  await goToStep2();

  expect(await screen.findByRole("heading", { name: "Rename & file" })).toBeInTheDocument();
  expect(screen.getByLabelText("Root")).toHaveValue("archive");
  expect(await screen.findByText("archive/2025/Q3")).toBeInTheDocument();
});

it("shows the ORGANIZE n label on the footer, disabled until the plan resolves", async () => {
  mockDetectApi();
  await goToStep2();

  expect(await screen.findByRole("button", { name: "ORGANIZE 1 →" })).not.toBeDisabled();
});

it("running an organize job shows MOVING progress in the footer and a DoneOverlay on finish", async () => {
  mockDetectApi((cmd) => (cmd === "start_organize" ? "job-1" : undefined));
  const { emit } = await mockListen();
  await goToStep2();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 1 →" }));

  await waitFor(() => expect(screen.getByRole("button", { name: "ORGANIZE 1 →" })).toBeDisabled());

  emit("job", { kind: "progress", job_id: "job-1", done: 12, total: 300, current: "a.jpg" });
  expect(await screen.findByText("MOVING 12 / 300")).toBeInTheDocument();

  emit("job", { kind: "finished", job_id: "job-1", ok: 1, failed: 0, skipped: 0 });

  expect(await screen.findByText("ORGANIZED")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "1 photos filed" })).toBeInTheDocument();
});

it("shows a CANCEL button while running that calls cancel_job", async () => {
  const cancelJobSpy = vi.fn();
  mockDetectApi((cmd) => {
    if (cmd === "start_organize") return "job-1";
    if (cmd === "cancel_job") return cancelJobSpy();
    return undefined;
  });
  await mockListen();
  await goToStep2();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 1 →" }));
  const cancelButtons = await screen.findAllByRole("button", { name: "CANCEL" });
  fireEvent.click(cancelButtons[cancelButtons.length - 1]);

  await waitFor(() => expect(cancelJobSpy).toHaveBeenCalled());
});

it("CANCEL during a multi-drive run stops the whole queue — the second drive's job is never started", async () => {
  const startOrganizeSpy = vi.fn().mockReturnValue("job-1");
  mockTwoDriveApi((cmd) => (cmd === "start_organize" ? startOrganizeSpy() : defaultExtra(cmd)));
  const { emit } = await mockListen();
  await goToStep2WithTwoDrives();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 2 →" }));
  await waitFor(() => expect(startOrganizeSpy).toHaveBeenCalledTimes(1));

  const cancelButtons = await screen.findAllByRole("button", { name: "CANCEL" });
  fireEvent.click(cancelButtons[cancelButtons.length - 1]);
  emit("job", { kind: "cancelled", job_id: "job-1", ok: 0, failed: 0, skipped: 0 });

  expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
  expect(startOrganizeSpy).toHaveBeenCalledTimes(1);
});

it("a cancelled run shows the CANCELLED screen, not the success one", async () => {
  mockDetectApi((cmd) => {
    if (cmd === "start_organize") return "job-1";
    if (cmd === "cancel_job") return null;
    return defaultExtra(cmd);
  });
  const { emit } = await mockListen();
  await goToStep2();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 1 →" }));
  const cancelButtons = await screen.findAllByRole("button", { name: "CANCEL" });
  fireEvent.click(cancelButtons[cancelButtons.length - 1]);
  emit("job", { kind: "cancelled", job_id: "job-1", ok: 0, failed: 0, skipped: 0 });

  expect(await screen.findByText("CANCELLED")).toBeInTheDocument();
  expect(screen.queryByText("ORGANIZED")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "0 photos filed before cancelling" })).toBeInTheDocument();
  expect(screen.getByText("Remaining photos were left in place.")).toBeInTheDocument();
});

it("counts skipped duplicates once — the job's own total, not the plan's added on top", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 20;
    if (cmd === "get_rule") return { ...rule, drive_id: (args as { driveId: number }).driveId };
    // The plan reports 2 duplicates; the job then reports those same 2
    // as `skipped` in its Finished event. The overlay must show 2, not 4.
    if (cmd === "plan_organize") return { items: [planItem], planned: 1, skipped_dup: 2, bytes: 1000 };
    if (cmd === "start_organize") return "job-1";
    return defaultExtra(cmd);
  });
  const { emit } = await mockListen();
  await goToStep2();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 1 →" }));
  emit("job", { kind: "finished", job_id: "job-1", ok: 1, failed: 0, skipped: 2 });

  expect(await screen.findByText("2 skipped · 0 failed")).toBeInTheDocument();
});

it("editing the rule without saving blocks ORGANIZE with a hint; saving re-enables it", async () => {
  mockDetectApi();
  await goToStep2();

  expect(await screen.findByRole("button", { name: "ORGANIZE 1 →" })).not.toBeDisabled();

  fireEvent.change(screen.getByLabelText("Root"), { target: { value: "archive2" } });

  const blockedButton = await screen.findByRole("button", { name: "SAVE RULE FIRST" });
  expect(blockedButton).toBeDisabled();
  expect(screen.getByText("Save the rule to apply your changes")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "ORGANIZE 1 →" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "SAVE" }));

  expect(await screen.findByRole("button", { name: "ORGANIZE 1 →" })).not.toBeDisabled();
  expect(screen.queryByText("Save the rule to apply your changes")).not.toBeInTheDocument();
});

it("clicking DASHBOARD after done resets the wizard to step 0 with no selection", async () => {
  mockDetectApi((cmd) => (cmd === "start_organize" ? "job-1" : defaultExtra(cmd)));
  const { emit } = await mockListen();
  await goToStep2();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 1 →" }));
  emit("job", { kind: "finished", job_id: "job-1", ok: 1, failed: 0, skipped: 0 });

  fireEvent.click(await screen.findByRole("link", { name: "DASHBOARD" }));

  expect(useWizardStore.getState()).toMatchObject({ step: 0, selectedDriveIds: [] });
});

it("the done summary's folders come from list_job_items (the real result), not the pre-run plan", async () => {
  const jobRow = {
    id: 42,
    drive_id: 1,
    drive_name: "Kodachrome",
    status: "done",
    planned: 1,
    moved: 1,
    skipped: 0,
    failed: 0,
    started_at: "2026-08-22T00:00:00Z",
    finished_at: "2026-08-22T00:01:00Z",
    // `useDoneSummary` only ever resolves `organize` rows — a `revert`
    // row on the same drive carries a higher id and would otherwise win.
    kind: "organize",
    reverts_job_id: null,
    reverted_by_job_id: null,
  };
  const movedItem = {
    id: 1,
    job_id: 42,
    media_id: 1,
    old_rel_path: planItem.old_rel_path,
    // Deliberately a different folder than `planItem.new_rel_path`'s
    // "archive/2025/Q3" — e.g. a collision was resolved into a
    // different bucket than planned — to prove the overlay reflects
    // this, not the stale pre-run plan.
    new_rel_path: "archive/2025/Q3-collision/2025-09-01_IMG_0001.jpg",
    status: "moved",
    error: null,
  };
  mockDetectApi((cmd, args) => {
    if (cmd === "start_organize") return "job-1";
    if (cmd === "list_jobs") return [jobRow];
    if (cmd === "list_job_items" && (args as { jobId: number }).jobId === 42) return [movedItem];
    return undefined;
  });
  const { emit } = await mockListen();
  await goToStep2();

  fireEvent.click(await screen.findByRole("button", { name: "ORGANIZE 1 →" }));
  emit("job", { kind: "finished", job_id: "job-1", ok: 1, failed: 0, skipped: 0 });

  expect(await screen.findByText("Filed into archive/2025/Q3-collision")).toBeInTheDocument();
  expect(screen.queryByText("Filed into archive/2025/Q3")).not.toBeInTheDocument();
});
