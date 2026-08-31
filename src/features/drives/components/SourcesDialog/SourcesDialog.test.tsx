import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import { SourcesDialog } from "./SourcesDialog";

vi.mock("@tauri-apps/plugin-dialog");

const drive: Drive = {
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

function renderDialog(props: { drive: Drive | null; onClose?: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SourcesDialog drive={props.drive} onClose={props.onClose ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

it("is closed when drive is null", () => {
  renderDialog({ drive: null });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows the dot loader while detecting, then the rows", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") {
      return [{ rel_path: "DCIM", media_count: 40, bytes: 1000, suggested: true }];
    }
    return undefined;
  });
  renderDialog({ drive });

  expect(await screen.findByText("Looking for photo folders…")).toBeInTheDocument();
  expect(await screen.findByText("DCIM")).toBeInTheDocument();
  expect(screen.queryByText("Looking for photo folders…")).not.toBeInTheDocument();
});

it("shows the empty state when detection finds nothing and there are no existing sources", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  renderDialog({ drive });

  expect(await screen.findByText("No photo folders found — add one manually.")).toBeInTheDocument();
});

it("toggling a row and saving sends only the checked rel paths", async () => {
  let saveArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "detect_sources") {
      return [{ rel_path: "Downloads", media_count: 2, bytes: 20, suggested: false }];
    }
    if (cmd === "save_sources") {
      saveArgs = args;
      return null;
    }
    return undefined;
  });
  const onClose = vi.fn();
  renderDialog({ drive, onClose });

  const dcimRow = (await screen.findByText("DCIM")).closest("label") as HTMLElement;
  expect(within(dcimRow).getByRole("checkbox")).toBeChecked();

  fireEvent.click(within(dcimRow).getByRole("checkbox"));
  expect(within(dcimRow).getByRole("checkbox")).not.toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: /save/i }));

  await waitFor(() => expect(saveArgs).toEqual({ driveId: 1, relPaths: [] }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("adding a folder outside the mount shows an inline error", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("/Volumes/Other/Pictures");

  renderDialog({ drive });
  await screen.findByText("No photo folders found — add one manually.");

  fireEvent.click(screen.getByRole("button", { name: /add folder/i }));

  expect(await screen.findByText("Folder must be on this drive")).toBeInTheDocument();
});

it("never offers the whole-drive row for the boot volume", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [{ rel_path: "", media_count: 100, bytes: 100, suggested: true }];
    return undefined;
  });
  renderDialog({ drive: { ...drive, mount_path: "/" } });

  await screen.findByText("No photo folders found — add one manually.");
  expect(screen.queryByText("Whole drive")).not.toBeInTheDocument();
});

it("keeps existing sources visible and savable when detect_sources fails (regression)", async () => {
  let saveArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "detect_sources") throw { code: "io", message: "walk failed" };
    if (cmd === "save_sources") {
      saveArgs = args;
      return null;
    }
    return undefined;
  });
  const onClose = vi.fn();
  renderDialog({ drive, onClose });

  expect(await screen.findByText("walk failed")).toBeInTheDocument();
  expect(screen.getByText("DCIM")).toBeInTheDocument();
  expect(screen.queryByText("No photo folders found — add one manually.")).not.toBeInTheDocument();

  const saveButton = screen.getByRole("button", { name: /save/i });
  expect(saveButton).not.toBeDisabled();

  fireEvent.click(saveButton);

  await waitFor(() => expect(saveArgs).toEqual({ driveId: 1, relPaths: ["DCIM"] }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});
