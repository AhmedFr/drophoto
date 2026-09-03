import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { checkForUpdate, getCurrentVersion } from "@/lib/api/updater";
import { buildFeatureRoutes } from "@/app/router";
import { settingsModule } from "./module";

// The rest of Settings' former single-page behavior now lives in each
// group's own page test (`GeneralSettingsPage.test.tsx`,
// `LibrarySettingsPage.test.tsx`, `MaintenanceSettingsPage.test.tsx`,
// `DangerZoneSettingsPage.test.tsx`) — this file re-points what's left to
// `SettingsPage`'s actual remaining job: hosting the layout (header +
// sub-nav + routed group) at `/settings` and its children, via the real
// `settingsModule` wired through the same route-building logic `router.tsx`
// uses.
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

function renderAt(pathname: string) {
  const rootRoute = createRootRoute();
  const routes = buildFeatureRoutes([settingsModule], rootRoute);
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function mockDefaults() {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "tool_health") {
      return {
        exiftool: { path: null, version: null, outdated: false },
        ffmpeg: { path: null, version: null, outdated: false },
      };
    }
    if (cmd === "cache_status") return { thumbs_dir: "/Users/me/Library/thumbs", fallback: false };
    if (cmd === "list_drives") return [];
    if (cmd === "get_organize_defaults") return { root: null, folder_tpl: null, file_tpl: null, keep_pairs: null };
    return undefined;
  });
}

it("renders the Settings header and the General group by default", async () => {
  mockDefaults();
  renderAt("/settings");
  expect(await screen.findByRole("heading")).toHaveTextContent("SETTINGS");
  // General's own content (Updates section).
  expect(await screen.findByText("Current: v0.3.0")).toBeInTheDocument();
});

it("lists every group in the sub-nav, in order", async () => {
  mockDefaults();
  renderAt("/settings");
  const nav = await screen.findByRole("link", { name: "General" });
  expect(nav).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Maintenance" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Danger zone" })).toBeInTheDocument();
});

it("navigates to the Library group and renders its storage section", async () => {
  mockDefaults();
  renderAt("/settings");
  await screen.findByText("Current: v0.3.0");

  await userEvent.click(screen.getByRole("link", { name: "Library" }));

  expect(await screen.findByText("Previews")).toBeInTheDocument();
});

it("navigates to the Maintenance group and renders its tools section", async () => {
  mockDefaults();
  renderAt("/settings");
  await screen.findByText("Current: v0.3.0");

  await userEvent.click(screen.getByRole("link", { name: "Maintenance" }));

  expect(await screen.findByText("brew install ffmpeg")).toBeInTheDocument();
});

it("navigates to the Danger zone group and renders its reset button", async () => {
  mockDefaults();
  renderAt("/settings");
  await screen.findByText("Current: v0.3.0");

  await userEvent.click(screen.getByRole("link", { name: "Danger zone" }));

  expect(await screen.findByRole("button", { name: "Reset app data…" })).toBeInTheDocument();
});

it("resolves the Library group directly at /settings/library", async () => {
  mockDefaults();
  renderAt("/settings/library");
  expect(await screen.findByText("Previews")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
});
