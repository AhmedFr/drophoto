import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { AppShell } from "./AppShell";

// `AppShell` mounts `JobEventsBridge`, which subscribes to the `"job"`
// Tauri event and needs a `QueryClient` in context.
vi.mock("@tauri-apps/api/event");

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

function renderShell(sidebar = <div>S</div>, children = <p>C</p>) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AppShell sidebar={sidebar}>{children}</AppShell>
    </QueryClientProvider>,
  );
}

it("renders sidebar and children", () => {
  renderShell();
  expect(screen.getByText("S")).toBeInTheDocument();
  expect(screen.getByText("C")).toBeInTheDocument();
});
