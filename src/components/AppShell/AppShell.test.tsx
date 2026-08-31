import type { ReactNode } from "react";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { checkForUpdate } from "@/lib/api/updater";
import { AppShell } from "./AppShell";

// `AppShell` mounts `JobEventsBridge`, which subscribes to the `"job"`
// Tauri event and needs a `QueryClient` in context.
vi.mock("@tauri-apps/api/event");
// `AppShell` also mounts `UpdateNotifier`, which needs router context (for
// `useNavigate`) and goes through the updater wrapper rather than `invoke`.
vi.mock("@/lib/api/updater", () => ({ checkForUpdate: vi.fn() }));

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(checkForUpdate).mockResolvedValue(null);
});

function renderShell(sidebar: ReactNode = <div>S</div>, children: ReactNode = <p>C</p>) {
  const queryClient = new QueryClient();
  const Wrapper = ({ children: c }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AppShell sidebar={sidebar}>{c}</AppShell>
    </QueryClientProvider>
  );
  return renderWithRouter(<Wrapper>{children}</Wrapper>);
}

it("renders sidebar and children", async () => {
  renderShell();
  // Router route resolution is async — see `ActiveJobs.test.tsx`'s own
  // note on `renderWithRouter`.
  expect(await screen.findByText("S")).toBeInTheDocument();
  expect(screen.getByText("C")).toBeInTheDocument();
});
