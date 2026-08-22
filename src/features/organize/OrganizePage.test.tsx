import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import type { OrganizeRule } from "@/lib/api/organize";
import { useWizardStore } from "./store/wizardStore";
import { OrganizePage } from "./OrganizePage";

vi.mock("@tauri-apps/api/event");

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  useWizardStore.setState({ step: 0, selectedDriveIds: [] });
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
    emit: (name: string, payload: unknown) => act(() => handlers.get(name)?.forEach((h) => h({ payload }))),
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

function mockDetectApi(extra: (cmd: string, args: unknown) => unknown = () => undefined) {
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 20;
    if (cmd === "get_rule") return rule;
    if (cmd === "plan_organize") return { items: [planItem], planned: 1, skipped_dup: 0, bytes: 1000 };
    return extra(cmd, args);
  });
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
