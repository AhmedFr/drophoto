import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { MaintenanceSettingsPage } from "./MaintenanceSettingsPage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MaintenanceSettingsPage />
    </QueryClientProvider>,
  );
}

function mockDefaults() {
  mockIPC((cmd) => {
    if (cmd === "tool_health")
      return {
        exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
        ffmpeg: { path: null, version: null, outdated: false },
      };
    if (cmd === "list_drives") return [];
    return undefined;
  });
}

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
