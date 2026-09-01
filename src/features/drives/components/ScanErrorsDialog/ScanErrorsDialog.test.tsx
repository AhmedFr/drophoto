import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import { ScanErrorsDialog } from "./ScanErrorsDialog";

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

function row(id: number, path: string, code = "io", message = "boom") {
  return { id, drive_id: 1, path, code, message, at: "2026-08-30T00:00:00Z" };
}

function renderDialog(props: { drive: Drive | null; onClose?: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ScanErrorsDialog drive={props.drive} onClose={props.onClose ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

it("is closed when drive is null", () => {
  renderDialog({ drive: null });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("shows the empty state when the drive has no scan errors", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 0;
    if (cmd === "list_scan_errors") return [];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  expect(await screen.findByText("No scan errors")).toBeInTheDocument();
});

it("lists rows with path, code, and message, and shows the total count in the title", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 2;
    if (cmd === "list_scan_errors") return [row(2, "b.jpg", "stub", "too small"), row(1, "a.jpg", "io", "boom")];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  expect(await screen.findByText("Errors — Kodachrome (2)")).toBeInTheDocument();
  expect(screen.getByText("b.jpg")).toBeInTheDocument();
  expect(screen.getByText("a.jpg")).toBeInTheDocument();
  expect(screen.getByText("stub")).toBeInTheDocument();
  expect(screen.getByText("too small")).toBeInTheDocument();
});

it("puts the full path in the row's title attribute for truncation", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 1;
    if (cmd === "list_scan_errors") return [row(1, "DCIM/very/deeply/nested/path/photo.jpg")];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  const pathEl = await screen.findByText("DCIM/very/deeply/nested/path/photo.jpg");
  expect(pathEl).toHaveAttribute("title", "DCIM/very/deeply/nested/path/photo.jpg");
  expect(pathEl).toHaveClass("truncate");
});

it("pages via Load more, requesting the next offset", async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => row(200 - i, `f${200 - i}.jpg`));
  const receivedArgs: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "count_scan_errors") return 150;
    if (cmd === "list_scan_errors") {
      receivedArgs.push(args);
      const offset = (args as { offset: number }).offset;
      return offset === 0 ? fullPage : [row(1, "f1.jpg")];
    }
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  expect(await screen.findByText("f200.jpg")).toBeInTheDocument();
  const loadMore = screen.getByRole("button", { name: /load more/i });
  fireEvent.click(loadMore);

  await waitFor(() => expect(screen.getByText("f1.jpg")).toBeInTheDocument());
  expect(receivedArgs).toContainEqual({ driveId: 1, limit: 100, offset: 100 });
});

it("hides Load more once every row is loaded", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 1;
    if (cmd === "list_scan_errors") return [row(1, "a.jpg")];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  await screen.findByText("a.jpg");
  expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
});

it("closes via onOpenChange when dismissed", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 0;
    if (cmd === "list_scan_errors") return [];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  const onClose = vi.fn();
  renderDialog({ drive, onClose });
  await screen.findByText("No scan errors");

  fireEvent.click(screen.getByRole("button", { name: /close/i }));
  expect(onClose).toHaveBeenCalled();
});

it("colors each row's code chip by its severity", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 2;
    if (cmd === "list_scan_errors")
      return [row(2, "b.jpg", "db", "locked"), row(1, "a.jpg", "unsupported", "not media")];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  const dbChip = await screen.findByText("db");
  expect(dbChip).toHaveClass("text-red-400");
  const unsupportedChip = screen.getByText("unsupported");
  expect(unsupportedChip).toHaveClass("text-faint");
});

it("shows per-severity counts in the header, derived from the code-counts query", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 9;
    if (cmd === "list_scan_errors") return [row(1, "a.jpg", "db")];
    if (cmd === "scan_error_code_counts")
      return [
        { code: "db", count: 2 },
        { code: "io", count: 5 },
        { code: "sidecar", count: 2 },
      ];
    return undefined;
  });
  renderDialog({ drive });

  expect(await screen.findByText("2 critical · 5 error · 2 warning")).toBeInTheDocument();
});

it("shows no severity summary line when there are no scan errors", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_scan_errors") return 0;
    if (cmd === "list_scan_errors") return [];
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderDialog({ drive });

  await screen.findByText("No scan errors");
  expect(screen.queryByText(/critical|warning/)).not.toBeInTheDocument();
});
