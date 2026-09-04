import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { LibrarySettingsPage } from "./LibrarySettingsPage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LibrarySettingsPage />
    </QueryClientProvider>,
  );
}

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
    if (cmd === "storage_usage") return usage;
    if (cmd === "cache_status") return { thumbs_dir: "/Users/me/Library/thumbs", fallback: false };
    if (cmd === "list_drives") return [];
    if (cmd === "get_organize_defaults") return organizeDefaults;
    return undefined;
  });
}

it("renders the storage breakdown once it loads", async () => {
  mockDefaults();
  renderPage();
  expect(await screen.findByText("Previews")).toBeInTheDocument();
  expect(screen.getByText("977 KB")).toBeInTheDocument();
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
  expect(await screen.findByLabelText("Default root")).toHaveValue("archive");
  expect(screen.getByLabelText("Default folder template")).toHaveValue("{{yyyy}}/Q{{q}}");
  expect(screen.getByLabelText("Default file template")).toHaveValue("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}");
});

it("renders storage above cache location", async () => {
  mockDefaults();
  renderPage();
  const labels = await screen.findAllByText(/^(STORAGE|CACHE LOCATION)$/);
  expect(labels.map((el) => el.textContent)).toEqual(["STORAGE", "CACHE LOCATION"]);
});
