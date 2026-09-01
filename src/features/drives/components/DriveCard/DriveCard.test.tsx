import type { ReactElement } from "react";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import type { JobEvent } from "@/lib/api/scan";
import type { Source } from "@/lib/api/sources";
import { DriveCard } from "./DriveCard";

// `DriveCard` now runs its own `scan-error-count` query (for the
// dropdown's "Errors…" item), so every render needs a `QueryClient` in
// context — wrapping it here means every existing `render(<DriveCard
// .../>)` call site below keeps working unchanged.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// Default: no recorded scan errors, so the pre-existing tests below (none
// of which care about the "Errors…" item) see a stable, quiet count query
// instead of a real Tauri IPC call rejecting with no mock configured.
// Tests about the "Errors…" item itself call `mockIPC` again to override.
beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 0;
    return undefined;
  });
});

const baseDrive: Drive = {
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

const enabledSource: Source = { id: 1, drive_id: 1, rel_path: "DCIM", enabled: true };
const enabledSource2: Source = { id: 3, drive_id: 1, rel_path: "Pictures", enabled: true };
const disabledSource: Source = { id: 2, drive_id: 1, rel_path: "Downloads", enabled: false };

it("renders the drive name and free/capacity space", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
  expect(screen.getByText(/1\.4.*GB/i)).toBeInTheDocument();
});

it("shows ONLINE when the drive is online", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.getByText("ONLINE")).toBeInTheDocument();
});

it("shows OFFLINE when the drive is not online", () => {
  render(<DriveCard drive={{ ...baseDrive, online: false, mount_path: null }} />);
  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
});

it("calls onScan when the Scan button is clicked for an online drive with an enabled source", () => {
  const onScan = vi.fn();
  render(<DriveCard drive={baseDrive} sources={[enabledSource]} onScan={onScan} />);
  fireEvent.click(screen.getByRole("button", { name: /scan/i }));
  expect(onScan).toHaveBeenCalled();
});

it("disables the Scan button when the drive is offline", () => {
  render(
    <DriveCard
      drive={{ ...baseDrive, online: false, mount_path: null }}
      sources={[enabledSource]}
      onScan={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /scan/i })).toBeDisabled();
});

it("renders ScanProgress when a scanEvent is present", () => {
  const scanEvent: JobEvent = {
    kind: "progress",
    job_id: "scan-0",
    done: 3,
    total: 10,
    current: "a.jpg",
  };
  render(<DriveCard drive={baseDrive} scanEvent={scanEvent} onCancelScan={vi.fn()} />);
  expect(screen.getByText("3 / 10")).toBeInTheDocument();
});

it("does not render ScanProgress when there is no scanEvent", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
});

it("disables the Scan button while a scan is in progress", () => {
  const scanEvent: JobEvent = {
    kind: "progress",
    job_id: "scan-0",
    done: 3,
    total: 10,
    current: "a.jpg",
  };
  render(
    <DriveCard
      drive={baseDrive}
      sources={[enabledSource]}
      onScan={vi.fn()}
      scanEvent={scanEvent}
      onCancelScan={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /scan/i })).toBeDisabled();
});

it("re-enables the Scan button once the scan has finished", () => {
  const scanEvent: JobEvent = { kind: "finished", job_id: "scan-0", ok: 10, failed: 0, skipped: 0 };
  render(
    <DriveCard
      drive={baseDrive}
      sources={[enabledSource]}
      onScan={vi.fn()}
      scanEvent={scanEvent}
      onCancelScan={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /scan/i })).not.toBeDisabled();
});

it("re-enables the Scan button once the scan has been cancelled", () => {
  const scanEvent: JobEvent = { kind: "cancelled", job_id: "scan-0", ok: 0, failed: 0, skipped: 0 };
  render(
    <DriveCard
      drive={baseDrive}
      sources={[enabledSource]}
      onScan={vi.fn()}
      scanEvent={scanEvent}
      onCancelScan={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /scan/i })).not.toBeDisabled();
});

it("shows 'No sources' in red-ish styling when there are none", () => {
  render(<DriveCard drive={baseDrive} sources={[]} />);
  const label = screen.getByText("No sources");
  expect(label).toHaveClass("text-red-400");
});

it("shows the enabled source count, faint, when there are enabled sources", () => {
  render(<DriveCard drive={baseDrive} sources={[enabledSource, enabledSource2, disabledSource]} />);
  const label = screen.getByText("2 sources");
  expect(label).toHaveClass("text-faint");
});

it("counts only enabled sources, not disabled ones", () => {
  render(<DriveCard drive={baseDrive} sources={[enabledSource, disabledSource]} />);
  expect(screen.getByText("1 source")).toBeInTheDocument();
});

it("pluralizes a single source correctly", () => {
  render(<DriveCard drive={baseDrive} sources={[enabledSource]} />);
  expect(screen.getByText("1 source")).toBeInTheDocument();
});

it("disables Scan when there are sources but none enabled", () => {
  render(<DriveCard drive={baseDrive} sources={[disabledSource]} onScan={vi.fn()} />);
  const button = screen.getByRole("button", { name: /scan/i });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "Choose sources first");
});

it("disables Scan by default when no sources prop is given", () => {
  render(<DriveCard drive={baseDrive} onScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: /scan/i })).toBeDisabled();
});

it("renders a Sources… button that calls onOpenSources when clicked", () => {
  const onOpenSources = vi.fn();
  render(<DriveCard drive={baseDrive} onOpenSources={onOpenSources} />);
  fireEvent.click(screen.getByRole("button", { name: /sources/i }));
  expect(onOpenSources).toHaveBeenCalled();
});

it("does not render the Sources… button when onOpenSources is not given", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.queryByRole("button", { name: /sources/i })).not.toBeInTheDocument();
});

// `sources` defaults to `[]` while the caller's query is in flight,
// which used to be rendered as a red "No sources" for a beat on every
// mount before the real count arrived.
it("shows neither 'No sources' nor a count while sources are still loading", () => {
  render(<DriveCard drive={baseDrive} sourcesLoading />);
  expect(screen.queryByText("No sources")).not.toBeInTheDocument();
  expect(screen.queryByText(/source(s)?$/)).not.toBeInTheDocument();
});

it("keeps Scan disabled while sources are still loading", () => {
  render(<DriveCard drive={baseDrive} sourcesLoading onScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Scan" })).toBeDisabled();
});

it("renders a Full button that calls onFullScan when clicked", () => {
  const onFullScan = vi.fn();
  render(<DriveCard drive={baseDrive} sources={[enabledSource]} onFullScan={onFullScan} />);
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  expect(onFullScan).toHaveBeenCalled();
});

it("shows a title on the Full button explaining what it does", () => {
  render(<DriveCard drive={baseDrive} sources={[enabledSource]} onFullScan={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute(
    "title",
    "Re-hash and re-thumbnail every file",
  );
});

it("does not render the Full button when there are no sources configured at all", () => {
  render(<DriveCard drive={baseDrive} sources={[]} onFullScan={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Full" })).not.toBeInTheDocument();
});

it("does not render the Full button when onFullScan is not given", () => {
  render(<DriveCard drive={baseDrive} sources={[enabledSource]} />);
  expect(screen.queryByRole("button", { name: "Full" })).not.toBeInTheDocument();
});

it("disables the Full button while a scan is in progress", () => {
  const scanEvent: JobEvent = {
    kind: "progress",
    job_id: "scan-0",
    done: 3,
    total: 10,
    current: "a.jpg",
  };
  render(
    <DriveCard
      drive={baseDrive}
      sources={[enabledSource]}
      onFullScan={vi.fn()}
      scanEvent={scanEvent}
      onCancelScan={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Full" })).toBeDisabled();
});

it("disables the Full button when there are sources but none enabled, and switches its tooltip", () => {
  render(<DriveCard drive={baseDrive} sources={[disabledSource]} onFullScan={vi.fn()} />);
  const button = screen.getByRole("button", { name: "Full" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "Choose sources first");
});

it("does not render the drive-actions menu when onForget is not given", () => {
  render(<DriveCard drive={baseDrive} />);
  expect(screen.queryByRole("button", { name: "Drive actions" })).not.toBeInTheDocument();
});

it("calls onForget when Forget… is chosen from the drive-actions menu, even offline", async () => {
  const onForget = vi.fn();
  render(
    <DriveCard drive={{ ...baseDrive, online: false, mount_path: null }} onForget={onForget} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Drive actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Forget…" }));

  expect(onForget).toHaveBeenCalledTimes(1);
});

it("does not render Relink… for an online drive even when onRelink is given", async () => {
  render(<DriveCard drive={baseDrive} onForget={vi.fn()} onRelink={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Drive actions" }));

  expect(screen.queryByRole("menuitem", { name: "Relink…" })).not.toBeInTheDocument();
});

it("renders Relink… for an offline drive and calls onRelink when chosen", async () => {
  const onRelink = vi.fn();
  render(
    <DriveCard
      drive={{ ...baseDrive, online: false, mount_path: null }}
      onForget={vi.fn()}
      onRelink={onRelink}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Drive actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Relink…" }));

  expect(onRelink).toHaveBeenCalledTimes(1);
});

it("renders the drive-actions menu for an offline drive with only onRelink given (no onForget)", () => {
  render(
    <DriveCard drive={{ ...baseDrive, online: false, mount_path: null }} onRelink={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "Drive actions" })).toBeInTheDocument();
});

it("does not show Errors… when the drive has no recorded scan errors, even with onOpenErrors given", async () => {
  render(<DriveCard drive={baseDrive} onForget={vi.fn()} onOpenErrors={vi.fn()} />);

  await userEvent.click(screen.getByRole("button", { name: "Drive actions" }));

  expect(screen.queryByRole("menuitem", { name: "Errors…" })).not.toBeInTheDocument();
});

it("shows Errors… once the drive has recorded scan errors, and calls onOpenErrors when chosen", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 3;
    return undefined;
  });
  const onOpenErrors = vi.fn();
  render(<DriveCard drive={baseDrive} onOpenErrors={onOpenErrors} />);

  await userEvent.click(await screen.findByRole("button", { name: "Drive actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Errors…" }));

  expect(onOpenErrors).toHaveBeenCalledTimes(1);
});

it("does not show the drive-actions menu at all when only onOpenErrors is given but there are no scan errors", () => {
  render(<DriveCard drive={baseDrive} onOpenErrors={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Drive actions" })).not.toBeInTheDocument();
});

it("shows the drive-actions menu for onOpenErrors alone once the drive has recorded scan errors", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 1;
    return undefined;
  });
  render(<DriveCard drive={baseDrive} onOpenErrors={vi.fn()} />);

  expect(await screen.findByRole("button", { name: "Drive actions" })).toBeInTheDocument();
});
