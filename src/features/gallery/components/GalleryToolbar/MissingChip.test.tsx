import type { ReactElement } from "react";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import { MissingChip } from "./MissingChip";

function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useGalleryStore.setState({ missingOnly: false });
  useGalleryStore.persist.clearStorage();
});

describe("MissingChip", () => {
  it("renders nothing while the count is loading", () => {
    mockIPC(() => undefined);
    render(<MissingChip />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when the count is zero", async () => {
    mockIPC((cmd) => (cmd === "count_media" ? 0 : undefined));
    render(<MissingChip />);
    // Let the query settle before asserting absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the count once nonzero", async () => {
    mockIPC((cmd) => (cmd === "count_media" ? 7 : undefined));
    render(<MissingChip />);
    expect(await screen.findByRole("button", { name: "Missing (7)" })).toBeInTheDocument();
  });

  it("reflects the store's missingOnly flag via aria-pressed", async () => {
    useGalleryStore.setState({ missingOnly: true });
    mockIPC((cmd) => (cmd === "count_media" ? 7 : undefined));
    render(<MissingChip />);
    expect(await screen.findByRole("button", { name: "Missing (7)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clicking toggles the store's missingOnly flag", async () => {
    const user = userEvent.setup();
    mockIPC((cmd) => (cmd === "count_media" ? 7 : undefined));
    render(<MissingChip />);

    const chip = await screen.findByRole("button", { name: "Missing (7)" });
    expect(useGalleryStore.getState().missingOnly).toBe(false);
    await user.click(chip);
    expect(useGalleryStore.getState().missingOnly).toBe(true);
    await user.click(chip);
    expect(useGalleryStore.getState().missingOnly).toBe(false);
  });
});
