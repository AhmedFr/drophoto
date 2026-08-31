import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { DrivesPage } from "./DrivesPage";

vi.mock("@tauri-apps/api/event");

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  // The "job" Tauri event is now only ever listened to by
  // `JobEventsBridge` (mounted once in `AppShell`, not rendered by
  // `DrivesPage` itself) — `DrivesPage` reads job progress from the
  // global `jobsStore` via `useJobEvents` instead, so tests seed it
  // directly rather than emitting a "job" Tauri event.
  useJobsStore.setState({ events: {}, labels: {}, samples: {}, driveIds: {} });
});

function renderPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <DrivesPage />
    </QueryClientProvider>,
  );
}

/** Mocks `listen` to record handlers by event name, returning an `emit` helper. */
async function mockListen() {
  const { listen } = await import("@tauri-apps/api/event");
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  vi.mocked(listen).mockImplementation((name, cb) => {
    handlers.set(name as string, cb as (event: { payload: unknown }) => void);
    return Promise.resolve(vi.fn());
  });
  return {
    emit: (name: string, payload: unknown) => act(() => handlers.get(name)?.({ payload })),
  };
}

const onlineDrive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive",
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

it("renders the Drives header and both sections", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_volumes") return [];
    if (cmd === "list_drives") return [];
    return undefined;
  });
  renderPage();
  expect(screen.getByRole("heading")).toHaveTextContent("DRIVES");
  expect(await screen.findByText("MOUNTED VOLUMES")).toBeInTheDocument();
  expect(screen.getByText("REGISTERED DRIVES")).toBeInTheDocument();
  expect(await screen.findByText("No drives registered")).toBeInTheDocument();
});

it("renders registered drives and hides their volume from the mounted list", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") {
      return [
        {
          id: 1,
          name: "Kodachrome",
          volume_uuid: null,
          mount_path: "/Volumes/Kodachrome",
          role: "archive",
          capacity: 2_000_000_000,
          free: 1_500_000_000,
          last_seen_at: "2026-08-22T00:00:00Z",
          online: true,
        },
      ];
    }
    if (cmd === "list_volumes") {
      return [
        {
          name: "Kodachrome",
          mount_path: "/Volumes/Kodachrome",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
        },
        {
          name: "Extra",
          mount_path: "/Volumes/Extra",
          total_bytes: 1_000_000_000,
          free_bytes: 500_000_000,
          is_removable: true,
        },
      ];
    }
    return undefined;
  });
  renderPage();

  expect(await screen.findByText("ONLINE")).toBeInTheDocument();
  expect(screen.queryByText("No drives registered")).not.toBeInTheDocument();

  const mountedList = (await screen.findByText("MOUNTED VOLUMES")).nextElementSibling as HTMLElement;
  expect(await within(mountedList).findByText("Extra")).toBeInTheDocument();
  expect(within(mountedList).queryByText("/Volumes/Kodachrome")).not.toBeInTheDocument();
});

it("shows the mutation error message when registration fails", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_volumes") {
      return [
        {
          name: "Kodachrome",
          mount_path: "/Volumes/Kodachrome",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
        },
      ];
    }
    if (cmd === "list_drives") return [];
    if (cmd === "register_drive") throw { code: "db", message: "name already taken" };
    return undefined;
  });
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /register/i }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));

  expect(await within(dialog).findByText("name already taken")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("clears the mutation error when the dialog is closed and reopened", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_volumes") {
      return [
        {
          name: "Kodachrome",
          mount_path: "/Volumes/Kodachrome",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
        },
      ];
    }
    if (cmd === "list_drives") return [];
    if (cmd === "register_drive") throw { code: "db", message: "name already taken" };
    return undefined;
  });
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /register/i }));
  let dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));
  expect(await within(dialog).findByText("name already taken")).toBeInTheDocument();

  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  fireEvent.click(await screen.findByRole("button", { name: /register/i }));
  dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByText("name already taken")).not.toBeInTheDocument();
});

it("registers a volume from the dialog with the expected input", async () => {
  let registerArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_volumes") {
      return [
        {
          name: "Kodachrome",
          mount_path: "/Volumes/Kodachrome",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
        },
      ];
    }
    if (cmd === "list_drives") return [];
    if (cmd === "register_drive") {
      registerArgs = (args as { input?: unknown } | undefined)?.input;
      return {
        id: 1,
        name: "Kodachrome",
        volume_uuid: null,
        mount_path: "/Volumes/Kodachrome",
        role: "archive",
        capacity: 2_000_000_000,
        free: 1_500_000_000,
        last_seen_at: "2026-08-22T00:00:00Z",
        online: true,
      };
    }
    return undefined;
  });
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /register/i }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));

  await waitFor(() =>
    expect(registerArgs).toEqual({
      name: "Kodachrome",
      mount_path: "/Volumes/Kodachrome",
      role: "archive",
      capacity: 2_000_000_000,
      free: 1_500_000_000,
    }),
  );
});

it("unsubscribes its event listeners on unmount", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenFns: ReturnType<typeof vi.fn>[] = [];
  vi.mocked(listen).mockImplementation(() => {
    const fn = vi.fn();
    unlistenFns.push(fn);
    return Promise.resolve(fn);
  });
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [];
    if (cmd === "list_volumes") return [];
    return undefined;
  });
  const queryClient = new QueryClient();
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <DrivesPage />
    </QueryClientProvider>,
  );
  await screen.findByText("No drives registered");
  await waitFor(() => expect(unlistenFns.length).toBeGreaterThan(0));

  unmount();

  await waitFor(() => expect(unlistenFns.every((fn) => fn.mock.calls.length > 0)).toBe(true));
});

it("starts a scan, shows live progress from job events, and cancels", async () => {
  let startScanArgs: unknown;
  let cancelArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "start_scan") {
      startScanArgs = args;
      return "scan-0";
    }
    if (cmd === "cancel_job") {
      cancelArgs = args;
      return null;
    }
    return undefined;
  });
  renderPage();
  await screen.findByText("1 source");

  fireEvent.click(await screen.findByRole("button", { name: "Scan" }));
  await waitFor(() => expect(startScanArgs).toEqual({ driveId: 1, full: false }));

  // In the real app `JobEventsBridge` (mounted in `AppShell`, not under
  // test here) is what applies "job" Tauri events to the store; seed it
  // directly to simulate that.
  act(() =>
    useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" }),
  );
  expect(await screen.findByText("3 / 10")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await waitFor(() => expect(cancelArgs).toEqual({ jobId: "scan-0" }));
});

it("shows a drive's running scan and lets it be cancelled after navigating away and back (job event was already in the global store before mount)", async () => {
  let cancelArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "cancel_job") {
      cancelArgs = args;
      return null;
    }
    return undefined;
  });

  // Simulates a scan that was started while `DrivesPage` was mounted
  // earlier, whose progress is only tracked in the global `jobsStore` (fed
  // by `JobEventsBridge` in `AppShell`) — not in any state local to
  // `DrivesPage`, which would have been discarded on unmount.
  act(() => {
    useJobsStore.getState().setJobDrive("scan-7", 1);
    useJobsStore
      .getState()
      .applyEvent({ kind: "progress", job_id: "scan-7", done: 4, total: 10, current: "b.jpg" });
  });

  renderPage();

  expect(await screen.findByText("4 / 10")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  await waitFor(() => expect(cancelArgs).toEqual({ jobId: "scan-7" }));
});

it("starts a full rescan when the Full button is clicked", async () => {
  let startScanArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "start_scan") {
      startScanArgs = args;
      return "scan-0";
    }
    return undefined;
  });
  renderPage();
  await screen.findByText("1 source");

  fireEvent.click(await screen.findByRole("button", { name: "Full" }));
  await waitFor(() => expect(startScanArgs).toEqual({ driveId: 1, full: true }));
});

it("records the drive's name as the job's label when a scan starts", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "start_scan") return "scan-0";
    return undefined;
  });
  renderPage();
  await screen.findByText("1 source");

  fireEvent.click(await screen.findByRole("button", { name: /scan/i }));

  await waitFor(() => expect(useJobsStore.getState().labels["scan-0"]).toBe("Kodachrome"));
});

it("disables the Scan button for an offline drive", async () => {
  await mockListen();
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [{ ...onlineDrive, online: false, mount_path: null }];
    if (cmd === "list_volumes") return [];
    return undefined;
  });
  renderPage();

  expect(await screen.findByRole("button", { name: /scan/i })).toBeDisabled();
});

it("refetches drives when a drives:changed event arrives", async () => {
  const { emit } = await mockListen();
  let listDrivesCalls = 0;
  mockIPC((cmd) => {
    if (cmd === "list_drives") {
      listDrivesCalls += 1;
      return [];
    }
    if (cmd === "list_volumes") return [];
    return undefined;
  });
  renderPage();
  await screen.findByText("No drives registered");
  const callsBefore = listDrivesCalls;

  emit("drives:changed", null);

  await waitFor(() => expect(listDrivesCalls).toBeGreaterThan(callsBefore));
});

it("opens the Sources dialog automatically after registering a drive", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [];
    if (cmd === "list_volumes") {
      return [
        {
          name: "Kodachrome",
          mount_path: "/Volumes/Kodachrome",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
        },
      ];
    }
    if (cmd === "register_drive") return onlineDrive;
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /register/i }));
  const registerDialog = await screen.findByRole("dialog");
  fireEvent.click(within(registerDialog).getByRole("button", { name: "Register" }));

  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Sources"));
  expect(await screen.findByText("No photo folders found — add one manually.")).toBeInTheDocument();
});

it("opens the Sources dialog for a drive when its Sources… button is clicked", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  renderPage();

  fireEvent.click(await screen.findByRole("button", { name: /sources/i }));

  expect(await screen.findByRole("dialog")).toHaveTextContent("Sources — Kodachrome");
});
