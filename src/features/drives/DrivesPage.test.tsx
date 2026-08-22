import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { DrivesPage } from "./DrivesPage";

function renderPage() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <DrivesPage />
    </QueryClientProvider>,
  );
}

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
