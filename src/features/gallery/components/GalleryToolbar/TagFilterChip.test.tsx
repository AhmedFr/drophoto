import type { ReactElement } from "react";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import { TagFilterChip } from "./TagFilterChip";

function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useGalleryStore.setState({ tagId: null });
  useGalleryStore.persist.clearStorage();
});

describe("TagFilterChip", () => {
  it("renders nothing while no tag filter is active", () => {
    mockIPC(() => undefined);
    render(<TagFilterChip />);
    expect(screen.queryByText(/^Tag:/)).not.toBeInTheDocument();
  });

  it("shows the filtered tag's name once resolved", async () => {
    useGalleryStore.setState({ tagId: 2 });
    mockIPC((cmd) =>
      cmd === "list_tags"
        ? [
            { id: 1, name: "Family" },
            { id: 2, name: "Trip" },
          ]
        : undefined,
    );
    render(<TagFilterChip />);
    expect(await screen.findByText("Tag: Trip")).toBeInTheDocument();
  });

  it("falls back to the raw id if the tag list hasn't resolved it", async () => {
    useGalleryStore.setState({ tagId: 99 });
    mockIPC((cmd) => (cmd === "list_tags" ? [{ id: 1, name: "Family" }] : undefined));
    render(<TagFilterChip />);
    expect(await screen.findByText("Tag: #99")).toBeInTheDocument();
  });

  it("clicking the clear button resets the store's tagId", async () => {
    useGalleryStore.setState({ tagId: 2 });
    const user = userEvent.setup();
    mockIPC((cmd) => (cmd === "list_tags" ? [{ id: 2, name: "Trip" }] : undefined));
    render(<TagFilterChip />);

    const clear = await screen.findByRole("button", { name: "Clear tag filter" });
    await user.click(clear);

    expect(useGalleryStore.getState().tagId).toBeNull();
  });
});
