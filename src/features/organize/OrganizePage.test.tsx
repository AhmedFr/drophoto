import { screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useWizardStore } from "./store/wizardStore";
import { OrganizePage } from "./OrganizePage";

vi.mock("@tauri-apps/api/event");

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  useWizardStore.setState({ step: 0, selectedDriveIds: [] });
});

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

function mockDetectApi() {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 20;
    return undefined;
  });
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

it("advances to the placeholder Organize step after CONTINUE", async () => {
  mockDetectApi();
  renderPage();
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));

  expect(await screen.findByText("STEP 02 · ORGANIZE")).toBeInTheDocument();
  expect(screen.getByText("Organize step — coming next")).toBeInTheDocument();
});
