import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { DrivesPage } from "./DrivesPage";

it("renders the Drives header and mounted volumes label", async () => {
  mockIPC((cmd) => (cmd === "list_volumes" ? [] : undefined));
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <DrivesPage />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("heading")).toHaveTextContent("DRIVES");
  expect(await screen.findByText("MOUNTED VOLUMES")).toBeInTheDocument();
});
