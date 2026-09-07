import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import userEvent from "@testing-library/user-event";
import { it, expect, vi } from "vitest";
import { toast } from "sonner";
import { RecoverDatesSection } from "./RecoverDatesSection";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecoverDatesSection />
    </QueryClientProvider>,
  );
}

it("recovers dates and reports how many", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_undated") return 11398;
    if (cmd === "recover_filename_dates") return 9950;
    return undefined;
  });

  renderSection();

  expect(await screen.findByText("11398")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /recover from filenames/i }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Recovered dates for 9950 photos"));
});

it("reports when nothing could be recovered", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_undated") return 5;
    if (cmd === "recover_filename_dates") return 0;
    return undefined;
  });

  renderSection();

  expect(await screen.findByText("5")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /recover from filenames/i }));
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith("No dates could be recovered"));
});

it("disables the button when there is nothing to recover", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_undated") return 0;
    return undefined;
  });

  renderSection();

  expect(await screen.findByText("0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /recover from filenames/i })).toBeDisabled();
});
