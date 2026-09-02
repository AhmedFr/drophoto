import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { it, expect, vi } from "vitest";
import { toast } from "sonner";
import { SidecarsSection } from "./SidecarsSection";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SidecarsSection />
    </QueryClientProvider>,
  );
}

const onlineDrive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  volume_label: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive" as const,
  capacity: 1000,
  free: 500,
  last_seen_at: null,
  online: true,
};

const offlineDrive = {
  id: 2,
  name: "Ektachrome",
  volume_uuid: null,
  volume_label: null,
  mount_path: null,
  role: "archive" as const,
  capacity: 1000,
  free: 500,
  last_seen_at: null,
  online: false,
};

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

it("shows no drives registered when the catalog has none", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [];
    return undefined;
  });
  renderSection();

  expect(await screen.findByText("No drives registered.")).toBeInTheDocument();
});

it("shows an online drive's tagged/pending counts", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "sidecar_health") {
      expect(args).toEqual({ driveId: 1 });
      return { tagged: 12, pending: 3 };
    }
    return undefined;
  });
  renderSection();

  expect(await screen.findByText("Kodachrome")).toBeInTheDocument();
  expect(await screen.findByText("12 tagged · 3 pending")).toBeInTheDocument();
});

it("lists an offline drive with no counts or actions, just a prompt to reconnect", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [offlineDrive];
    return undefined;
  });
  renderSection();

  expect(await screen.findByText("Ektachrome")).toBeInTheDocument();
  expect(screen.getByText("offline — plug in to check")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /check files/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sync now/i })).not.toBeInTheDocument();
});

it("CHECK FILES toasts the missing count and queues them when sidecars are missing", async () => {
  let checkArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "sidecar_health") return { tagged: 5, pending: 0 };
    if (cmd === "check_sidecar_files") {
      checkArgs = args;
      return 2;
    }
    return undefined;
  });
  renderSection();

  const button = await screen.findByRole("button", { name: /check files/i });
  fireEvent.click(button);

  await waitFor(() => expect(toast).toHaveBeenCalledWith("2 sidecars missing — queued for rewrite"));
  expect(checkArgs).toEqual({ driveId: 1 });
});

it("CHECK FILES toasts success when every sidecar is present", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "sidecar_health") return { tagged: 5, pending: 0 };
    if (cmd === "check_sidecar_files") return 0;
    return undefined;
  });
  renderSection();

  const button = await screen.findByRole("button", { name: /check files/i });
  fireEvent.click(button);

  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("All sidecar files present"));
});

it("SYNC NOW starts the existing sidecar sync sweep", async () => {
  let syncCalled = false;
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "sidecar_health") return { tagged: 5, pending: 1 };
    if (cmd === "start_sidecar_sync_all") {
      syncCalled = true;
      return ["sidecar-0"];
    }
    return undefined;
  });
  renderSection();

  const button = await screen.findByRole("button", { name: /sync now/i });
  fireEvent.click(button);

  await waitFor(() => expect(syncCalled).toBe(true));
});

it("shows an error toast when CHECK FILES fails", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "sidecar_health") return { tagged: 5, pending: 0 };
    if (cmd === "check_sidecar_files") throw new Error("drive is offline");
    return undefined;
  });
  renderSection();

  const button = await screen.findByRole("button", { name: /check files/i });
  fireEvent.click(button);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("drive is offline"));
});
