import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { CacheLocationSection } from "./CacheLocationSection";

vi.mock("@/lib/api/dialog", () => ({ pickFolder: vi.fn() }));
vi.mock("@/lib/api/updater", () => ({ relaunchApp: vi.fn() }));

import { pickFolder } from "@/lib/api/dialog";
import { relaunchApp } from "@/lib/api/updater";

beforeEach(() => {
  vi.mocked(pickFolder).mockReset();
  vi.mocked(relaunchApp).mockReset();
});

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CacheLocationSection />
    </QueryClientProvider>,
  );
}

it("shows the current cache root", async () => {
  mockIPC((cmd) => {
    if (cmd === "cache_status") return { thumbs_dir: "/Users/me/Library/thumbs", fallback: false };
    return undefined;
  });
  renderSection();

  expect(await screen.findByText("/Users/me/Library/thumbs")).toBeInTheDocument();
  expect(screen.queryByText(/unavailable at launch/)).not.toBeInTheDocument();
});

it("warns when the configured location fell back to the default", async () => {
  mockIPC((cmd) => {
    if (cmd === "cache_status") return { thumbs_dir: "/Users/me/Library/thumbs", fallback: true };
    return undefined;
  });
  renderSection();

  expect(await screen.findByText(/unavailable at launch/)).toBeInTheDocument();
});

it("picks a folder, confirms, moves the cache, and relaunches", async () => {
  let moveArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "cache_status") return { thumbs_dir: "/old/thumbs", fallback: false };
    if (cmd === "move_cache") {
      moveArgs = args;
      return "/Volumes/Fast/drophoto-thumbs";
    }
    return undefined;
  });
  vi.mocked(pickFolder).mockResolvedValue("/Volumes/Fast");
  renderSection();

  fireEvent.click(await screen.findByRole("button", { name: "Change…" }));
  const confirm = await screen.findByRole("button", { name: "Move and relaunch" });
  expect(screen.getByRole("dialog")).toHaveTextContent("/Volumes/Fast/drophoto-thumbs");
  fireEvent.click(confirm);

  await waitFor(() => expect(moveArgs).toEqual({ newDir: "/Volumes/Fast" }));
  await waitFor(() => expect(relaunchApp).toHaveBeenCalledTimes(1));
});

it("keeps the dialog open with the error when the move is refused, and never relaunches", async () => {
  mockIPC((cmd) => {
    if (cmd === "cache_status") return { thumbs_dir: "/old/thumbs", fallback: false };
    if (cmd === "move_cache") {
      throw { code: "unsupported", message: "a job is running — wait for it to finish before moving the cache" };
    }
    return undefined;
  });
  vi.mocked(pickFolder).mockResolvedValue("/Volumes/Fast");
  renderSection();

  fireEvent.click(await screen.findByRole("button", { name: "Change…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Move and relaunch" }));

  expect(await screen.findByText(/a job is running/)).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(relaunchApp).not.toHaveBeenCalled();
});

it("surfaces a relaunch failure instead of leaving the dialog silent (MINOR-4)", async () => {
  mockIPC((cmd) => {
    if (cmd === "cache_status") return { thumbs_dir: "/old/thumbs", fallback: false };
    if (cmd === "move_cache") return "/Volumes/Fast/drophoto-thumbs";
    return undefined;
  });
  vi.mocked(pickFolder).mockResolvedValue("/Volumes/Fast");
  vi.mocked(relaunchApp).mockRejectedValue(new Error("relaunch failed"));
  renderSection();

  fireEvent.click(await screen.findByRole("button", { name: "Change…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Move and relaunch" }));

  // The move itself succeeded — only the relaunch failed — so the user
  // must be told to finish the job manually rather than staring at a
  // dialog that silently never closes.
  await waitFor(() => expect(relaunchApp).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/quit and reopen drophoto manually/i)).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("does nothing when the folder picker is cancelled", async () => {
  mockIPC((cmd) => {
    if (cmd === "cache_status") return { thumbs_dir: "/old/thumbs", fallback: false };
    return undefined;
  });
  vi.mocked(pickFolder).mockResolvedValue(null);
  renderSection();

  fireEvent.click(await screen.findByRole("button", { name: "Change…" }));

  await waitFor(() => expect(pickFolder).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
