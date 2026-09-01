import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  volume_label: null,
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
          volume_label: null,
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
          uuid: null,
        },
        {
          name: "Extra",
          mount_path: "/Volumes/Extra",
          total_bytes: 1_000_000_000,
          free_bytes: 500_000_000,
          is_removable: true,
          uuid: null,
        },
      ];
    }
    return undefined;
  });
  renderPage();

  expect(await screen.findByText("ONLINE")).toBeInTheDocument();
  expect(screen.queryByText("No drives registered")).not.toBeInTheDocument();

  const mountedList = (await screen.findByText("MOUNTED VOLUMES"))
    .nextElementSibling as HTMLElement;
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
          uuid: null,
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
          uuid: null,
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
          uuid: null,
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
        volume_label: null,
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
      volume_uuid: null,
      volume_label: "Kodachrome",
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
    useJobsStore
      .getState()
      .applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" }),
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

// Regression test for review finding 1: `activeScanJobId` used to filter to
// `started`/`progress` events only, so once a scan's job reached a terminal
// state its id dropped out of the lookup and `DriveCard` rendered nothing —
// the "Up to date · N skipped" readout `ScanProgress` already knows how to
// render was unreachable in the real app. Goes through the real store path
// (`applyEvent`, not a hand-built event object) the way `JobEventsBridge`
// would drive it.
it("keeps showing the finished scan readout (with skipped count) after the scan completes", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    return undefined;
  });

  act(() => {
    useJobsStore.getState().setJobDrive("scan-9", 1);
    useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-9" });
    useJobsStore
      .getState()
      .applyEvent({ kind: "progress", job_id: "scan-9", done: 5, total: 10, current: "a.jpg" });
    useJobsStore
      .getState()
      .applyEvent({ kind: "finished", job_id: "scan-9", ok: 0, failed: 0, skipped: 3 });
  });

  renderPage();

  expect(await screen.findByText("Up to date · 3 skipped")).toBeInTheDocument();
  // The Scan button is re-enabled once the job reaches a terminal state.
  expect(screen.getByRole("button", { name: "Scan" })).not.toBeDisabled();
});

it("opens ScanErrorsDialog for the drive when the terminal readout's failed count is clicked", async () => {
  let listArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "count_scan_errors") return 2;
    if (cmd === "list_scan_errors") {
      listArgs = args;
      return [{ id: 1, drive_id: 1, path: "a.jpg", code: "io", message: "boom", at: "2026-08-30T00:00:00Z" }];
    }
    return undefined;
  });

  act(() => {
    useJobsStore.getState().setJobDrive("scan-9", 1);
    useJobsStore
      .getState()
      .applyEvent({ kind: "finished", job_id: "scan-9", ok: 8, failed: 2, skipped: 0 });
  });

  renderPage();

  const failedButton = await screen.findByRole("button", { name: "2 failed" });
  await userEvent.click(failedButton);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Errors — Kodachrome (2)")).toBeInTheDocument();
  expect(await screen.findByText("a.jpg")).toBeInTheDocument();
  expect(listArgs).toEqual({ driveId: 1, limit: 100, offset: 0 });
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
          uuid: null,
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

it("opens the Forget dialog with the drive's media count from the drive-actions menu", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [];
    if (cmd === "count_drive_media") return 12;
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Forget…" }));

  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent('Forget "Kodachrome"');
  expect(await within(dialog).findByText(/Removes 12 photos/)).toBeInTheDocument();
});

it("forgets a drive and removes it from the list", async () => {
  let forgetArgs: unknown;
  let listCalls = 0;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") {
      listCalls += 1;
      return listCalls === 1 ? [onlineDrive] : [];
    }
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [];
    if (cmd === "count_drive_media") return 3;
    if (cmd === "forget_drive") {
      forgetArgs = args;
      return null;
    }
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Forget…" }));

  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Type FORGET to confirm"), {
    target: { value: "FORGET" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Forget drive" }));

  await waitFor(() => expect(forgetArgs).toEqual({ driveId: 1 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("No drives registered")).toBeInTheDocument();
});

it("shows the backend's refusal message when a job is running on the drive", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_volumes") return [];
    if (cmd === "list_sources") return [];
    if (cmd === "count_drive_media") return 3;
    if (cmd === "forget_drive") {
      throw { code: "unsupported", message: "a scan job is running on this drive" };
    }
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Forget…" }));

  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Type FORGET to confirm"), {
    target: { value: "FORGET" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Forget drive" }));

  expect(
    await within(dialog).findByText("a scan job is running on this drive"),
  ).toBeInTheDocument();
  // The dialog stays open and the drive is not removed from the list.
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

const offlineDrive = {
  id: 2,
  name: "SSD Samsung T7",
  volume_uuid: null,
  volume_label: null,
  mount_path: null,
  role: "archive",
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: null,
  online: false,
};

it("opens the Relink dialog listing unclaimed mounted volumes for an offline drive", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [offlineDrive];
    if (cmd === "list_volumes") {
      return [
        {
          name: "T7",
          mount_path: "/Volumes/T7",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
          uuid: "uuid-real",
        },
      ];
    }
    if (cmd === "list_sources") return [];
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Relink…" }));

  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent('Relink "SSD Samsung T7"');
  expect(within(dialog).getByText("T7")).toBeInTheDocument();
});

it("relinks a drive to the chosen volume and refreshes the drives list", async () => {
  let relinkArgs: unknown;
  let listCalls = 0;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") {
      listCalls += 1;
      return listCalls === 1
        ? [offlineDrive]
        : [{ ...offlineDrive, online: true, mount_path: "/Volumes/T7" }];
    }
    if (cmd === "list_volumes") {
      return [
        {
          name: "T7",
          mount_path: "/Volumes/T7",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
          uuid: "uuid-real",
        },
      ];
    }
    if (cmd === "list_sources") return [];
    if (cmd === "relink_drive") {
      relinkArgs = args;
      return null;
    }
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Relink…" }));

  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Relink" }));

  await waitFor(() => expect(relinkArgs).toEqual({ driveId: 2, mountPath: "/Volumes/T7" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("ONLINE")).toBeInTheDocument();
});

it("excludes a volume already claimed by another registered drive from the Relink candidates", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") {
      return [
        offlineDrive,
        { ...onlineDrive, id: 3, volume_label: "T7", mount_path: "/Volumes/Other" },
      ];
    }
    if (cmd === "list_volumes") {
      return [
        {
          name: "T7",
          mount_path: "/Volumes/T7",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
          uuid: null,
        },
      ];
    }
    if (cmd === "list_sources") return [];
    return undefined;
  });
  renderPage();

  const driveActionButtons = await screen.findAllByRole("button", { name: "Drive actions" });
  await userEvent.click(driveActionButtons[0]);
  await userEvent.click(await screen.findByRole("menuitem", { name: "Relink…" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/No unclaimed mounted volumes found/)).toBeInTheDocument();
});

// Regression test for review finding 11: `relinkCandidates` must exclude
// the drive actually being relinked (via `excludeDriveId`), mirroring the
// backend's `exclude_drive_id` — otherwise a drive whose own stale
// `mount_path` happens to equal a mounted volume's `mount_path` would
// wrongly disqualify that volume as "claimed by another drive" (by
// itself).
it("does not let the drive being relinked disqualify its own candidate volume via a stale mount_path", async () => {
  const staleOfflineDrive = { ...offlineDrive, mount_path: "/Volumes/T7" };
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [staleOfflineDrive];
    if (cmd === "list_volumes") {
      return [
        {
          name: "T7",
          mount_path: "/Volumes/T7",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
          uuid: "uuid-real",
        },
      ];
    }
    if (cmd === "list_sources") return [];
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Relink…" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("T7")).toBeInTheDocument();
  expect(within(dialog).queryByText(/No unclaimed mounted volumes found/)).not.toBeInTheDocument();
});

// Re-review finding 1: the drive can self-heal online while the Relink
// dialog is already open on a stale snapshot; the backend's server-side
// guard must refuse, and the dialog must surface that refusal rather than
// silently succeeding or failing invisibly.
it("surfaces the backend's refusal when the drive went online while the Relink dialog was open", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [offlineDrive];
    if (cmd === "list_volumes") {
      return [
        {
          name: "T7",
          mount_path: "/Volumes/T7",
          total_bytes: 2_000_000_000,
          free_bytes: 1_500_000_000,
          is_removable: true,
          uuid: "uuid-real",
        },
      ];
    }
    if (cmd === "list_sources") return [];
    if (cmd === "relink_drive") {
      throw {
        code: "unsupported",
        message: "drive is already online — relink is only for offline drives",
      };
    }
    return undefined;
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Relink…" }));

  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Relink" }));

  expect(
    await within(dialog).findByText("drive is already online — relink is only for offline drives"),
  ).toBeInTheDocument();
  // The dialog stays open rather than silently closing as if it succeeded.
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
