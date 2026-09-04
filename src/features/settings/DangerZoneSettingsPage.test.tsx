import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { DangerZoneSettingsPage } from "./DangerZoneSettingsPage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DangerZoneSettingsPage />
    </QueryClientProvider>,
  );
}

it("renders the danger zone with the reset button", async () => {
  mockIPC(() => undefined);
  renderPage();
  expect(await screen.findByRole("button", { name: "Reset app data…" })).toBeInTheDocument();
});

it("triggers reset_app_data once the danger-zone dialog is confirmed", async () => {
  const resetAppData = vi.fn().mockReturnValue(undefined);
  mockIPC((cmd) => {
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
    if (cmd === "uninstall_app") return uninstallApp();
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Uninstall drophoto…" }));
  await userEvent.type(screen.getByLabelText("Type UNINSTALL to confirm"), "UNINSTALL");
  await userEvent.click(screen.getByRole("button", { name: "Uninstall drophoto" }));

  expect(uninstallApp).toHaveBeenCalledTimes(1);
});
