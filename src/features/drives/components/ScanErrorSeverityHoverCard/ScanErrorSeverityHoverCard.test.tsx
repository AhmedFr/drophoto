import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ReactElement } from "react";
import { ScanErrorSeverityHoverCard } from "./ScanErrorSeverityHoverCard";

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

it("shows the severity repartition (dot, label, count per severity) on hover", async () => {
  mockIPC((cmd) => {
    if (cmd === "scan_error_code_counts") {
      return [
        { code: "db", count: 2 },
        { code: "io", count: 5 },
        { code: "sidecar", count: 1 },
      ];
    }
    return undefined;
  });
  renderWithClient(
    <ScanErrorSeverityHoverCard driveId={1}>
      <button type="button">8 failed</button>
    </ScanErrorSeverityHoverCard>,
  );

  await userEvent.hover(screen.getByRole("button", { name: "8 failed" }));

  expect(await screen.findByText("critical")).toBeInTheDocument();
  expect(screen.getByText("error")).toBeInTheDocument();
  expect(screen.getByText("warning")).toBeInTheDocument();
  expect(screen.queryByText("info")).not.toBeInTheDocument();
});

it("only shows severities with at least one recorded error", async () => {
  mockIPC((cmd) => {
    if (cmd === "scan_error_code_counts") return [{ code: "unsupported", count: 3 }];
    return undefined;
  });
  renderWithClient(
    <ScanErrorSeverityHoverCard driveId={1}>
      <button type="button">3 failed</button>
    </ScanErrorSeverityHoverCard>,
  );

  await userEvent.hover(screen.getByRole("button", { name: "3 failed" }));

  expect(await screen.findByText("info")).toBeInTheDocument();
  expect(screen.queryByText("critical")).not.toBeInTheDocument();
  expect(screen.queryByText("error")).not.toBeInTheDocument();
  expect(screen.queryByText("warning")).not.toBeInTheDocument();
});

it("renders the trigger children even before any hover", () => {
  mockIPC((cmd) => {
    if (cmd === "scan_error_code_counts") return [];
    return undefined;
  });
  renderWithClient(
    <ScanErrorSeverityHoverCard driveId={1}>
      <button type="button">2 failed</button>
    </ScanErrorSeverityHoverCard>,
  );

  expect(screen.getByRole("button", { name: "2 failed" })).toBeInTheDocument();
});
