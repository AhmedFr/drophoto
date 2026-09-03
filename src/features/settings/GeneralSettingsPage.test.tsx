import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { checkForUpdate, getCurrentVersion } from "@/lib/api/updater";
import { GeneralSettingsPage } from "./GeneralSettingsPage";

// `UpdatesSection`'s `useUpdater` goes through `src/lib/api/updater`, which
// wraps the updater/process Tauri plugins directly rather than `invoke` —
// `mockIPC` doesn't cover those plugin channels, so the wrapper is mocked
// instead (per the wrapper's own test-strategy note).
vi.mock("@/lib/api/updater", () => ({
  checkForUpdate: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn(),
}));

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {}, samples: {} });
  vi.mocked(checkForUpdate).mockResolvedValue(null);
  vi.mocked(getCurrentVersion).mockResolvedValue("0.3.0");
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralSettingsPage />
    </QueryClientProvider>,
  );
}

const settings = { preview_edge: 2000, thumbs_dir: null };
const usage = {
  thumbs_400_bytes: 1_000_000,
  previews_bytes: 8_000_000,
  catalog_bytes: 500_000,
  total_bytes: 9_500_000,
  file_count: 42,
};

function mockDefaults() {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return settings;
    if (cmd === "storage_usage") return usage;
    return undefined;
  });
}

it("shows the current app version in the updates section", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("Current: v0.3.0")).toBeInTheDocument();
});

it("renders the quality picker pre-selected to the current setting", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByRole("radio", { name: /Max/ })).toBeChecked();
});

/**
 * A stateful `get_settings`/`set_preview_quality` pair, mirroring what the
 * real Rust command pair does: `set_preview_quality` persists the edge,
 * and `get_settings` reflects it afterward.
 */
function statefulSettingsMock(usageValue: typeof usage) {
  let previewEdge = 2000;
  mockIPC((cmd, args) => {
    if (cmd === "get_settings") return { preview_edge: previewEdge };
    if (cmd === "storage_usage") return usageValue;
    if (cmd === "set_preview_quality") {
      previewEdge = (args as { edge: number }).edge;
      return null;
    }
    return undefined;
  });
}

it("applies a lower quality and offers to regenerate previews", async () => {
  statefulSettingsMock(usage);
  renderPage();

  await userEvent.click(await screen.findByRole("radio", { name: /Compact/ }));
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));

  expect(await screen.findByRole("button", { name: "Regenerate previews" })).toBeInTheDocument();
});

it("starts a regen sweep when the regenerate-previews button is clicked", async () => {
  const startRegen = vi.fn().mockReturnValue("regen-0");
  let previewEdge = 2000;
  mockIPC((cmd, args) => {
    if (cmd === "get_settings") return { preview_edge: previewEdge };
    if (cmd === "storage_usage") return usage;
    if (cmd === "set_preview_quality") {
      previewEdge = (args as { edge: number }).edge;
      return null;
    }
    if (cmd === "start_regen_previews") return startRegen();
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("radio", { name: /Compact/ }));
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await userEvent.click(await screen.findByRole("button", { name: "Regenerate previews" }));

  expect(startRegen).toHaveBeenCalledTimes(1);
});
