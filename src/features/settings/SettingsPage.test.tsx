import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { checkForUpdate, getCurrentVersion } from "@/lib/api/updater";
import { SettingsPage } from "./SettingsPage";

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
      <SettingsPage />
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

const organizeDefaults = { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null };

function mockDefaults() {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return settings;
    if (cmd === "storage_usage") return usage;
    if (cmd === "tool_health")
      return {
        exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
        ffmpeg: { path: null, version: null, outdated: false },
      };
    if (cmd === "cache_status") return { thumbs_dir: "/Users/me/Library/thumbs", fallback: false };
    if (cmd === "list_drives") return [];
    if (cmd === "get_organize_defaults") return organizeDefaults;
    return undefined;
  });
}

it("renders the Settings header", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByRole("heading")).toHaveTextContent("SETTINGS");
});

it("renders the updates section first, above storage", async () => {
  mockDefaults();
  renderPage();
  const labels = await screen.findAllByText(/^(UPDATES|STORAGE)$/);
  expect(labels.map((el) => el.textContent)).toEqual(["UPDATES", "STORAGE"]);
});

it("shows the current app version in the updates section", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("Current: v0.3.0")).toBeInTheDocument();
});

it("renders the storage breakdown once it loads", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("Previews")).toBeInTheDocument();
  expect(screen.getByText("977 KB")).toBeInTheDocument();
});

it("renders the quality picker pre-selected to the current setting", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByRole("radio", { name: /Max/ })).toBeChecked();
});

it("renders the tools section with each tool's resolved state", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("found at /opt/homebrew/bin/exiftool · v13.10")).toBeInTheDocument();
  expect(screen.getByText("brew install ffmpeg")).toBeInTheDocument();
});

it("renders the sidecars section after tools", async () => {
  mockDefaults();
  renderPage();
  const labels = await screen.findAllByText(/^(TOOLS|SIDECARS)$/);
  expect(labels.map((el) => el.textContent)).toEqual(["TOOLS", "SIDECARS"]);
});

it("renders the danger zone with the reset button", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByRole("button", { name: "Reset app data…" })).toBeInTheDocument();
});

/**
 * A stateful `get_settings`/`set_preview_quality` pair, mirroring what the
 * real Rust command pair does: `set_preview_quality` persists the edge,
 * and `get_settings` reflects it afterward — since `regenApplicable` is
 * now derived from the persisted setting (not `set_preview_quality`'s
 * response, which is `void`), the mock has to actually persist across
 * calls for the "offers to regenerate" flow to be exercised honestly.
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

it("triggers reset_app_data once the danger-zone dialog is confirmed", async () => {
  const resetAppData = vi.fn().mockReturnValue(undefined);
  mockIPC((cmd) => {
    if (cmd === "get_settings") return settings;
    if (cmd === "storage_usage") return usage;
    if (cmd === "reset_app_data") return resetAppData();
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Reset app data…" }));
  await userEvent.type(screen.getByLabelText("Type RESET to confirm"), "RESET");
  await userEvent.click(screen.getByRole("button", { name: "Reset app data" }));

  expect(resetAppData).toHaveBeenCalledTimes(1);
});

it("triggers uninstall_app once the danger-zone uninstall dialog is confirmed", async () => {
  const uninstallApp = vi.fn().mockReturnValue(undefined);
  mockIPC((cmd) => {
    if (cmd === "get_settings") return settings;
    if (cmd === "storage_usage") return usage;
    if (cmd === "uninstall_app") return uninstallApp();
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Uninstall drophoto…" }));
  await userEvent.type(screen.getByLabelText("Type UNINSTALL to confirm"), "UNINSTALL");
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto" }));

  expect(uninstallApp).toHaveBeenCalledTimes(1);
});

it("renders the cache-location section with the current root", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("CACHE LOCATION")).toBeInTheDocument();
  expect(await screen.findByText("/Users/me/Library/thumbs")).toBeInTheDocument();
});

it("renders the organize-defaults section prefilled with the hardcoded fallback when unset", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("ORGANIZE DEFAULTS")).toBeInTheDocument();
  expect(screen.getByLabelText("Default root")).toHaveValue("archive");
  expect(screen.getByLabelText("Default folder template")).toHaveValue("{{yyyy}}/Q{{q}}");
  expect(screen.getByLabelText("Default file template")).toHaveValue("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}");
});
