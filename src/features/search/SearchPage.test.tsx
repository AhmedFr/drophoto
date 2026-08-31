import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { MediaItem, MediaKind } from "@/lib/api/media";
import { virtualizerMockFactory } from "@/test/mockVirtualizer";
import { SearchPage } from "./SearchPage";

vi.mock("@tanstack/react-virtual", () => virtualizerMockFactory());

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, convertFileSrc: (path: string) => `asset://mock/${path}` };
});

class ResizeObserverStub {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    this.#callback([{ contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

function item(id: number, kind: MediaKind = "photo"): MediaItem {
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photos/${id}.${kind === "video" ? "mp4" : "jpg"}`,
      hash: `hash${id}`,
      size: 1234,
      kind,
      ext: kind === "video" ? "mp4" : "jpg",
      width: 100,
      height: 200,
      duration_ms: kind === "video" ? 5000 : null,
      taken_at: "2024-06-15T12:00:00Z",
      camera: null,
      lens: null,
      aperture: null,
      shutter: null,
      iso: null,
      focal_mm: null,
      lat: null,
      lon: null,
      missing_at: null,
      organized_at: null,
      source_id: null,
      place_id: null,
      mtime: null,
    },
    thumb_path: `/tmp/thumbs/hash${id}/400.webp`,
    preview_path: `/tmp/thumbs/hash${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    has_thumb: true,
  };
}

it("renders the Search header", () => {
  renderPage();
  expect(screen.getByRole("heading")).toHaveTextContent("SEARCH");
});

it("shows a hint to type when the query is empty", () => {
  renderPage();
  expect(screen.getByText("TYPE TO SEARCH")).toBeInTheDocument();
});

it("shows a loading indicator while debouncing and fetching", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");

  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText("TYPE TO SEARCH")).not.toBeInTheDocument();
});

it("shows a no-results message quoting the query once the search settles empty", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");

  expect(await screen.findByText('NO RESULTS FOR "beach"')).toBeInTheDocument();
});

it("shows the result count and grid once results come back", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [item(1), item(2)] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");

  expect(await screen.findByText("2 RESULTS")).toBeInTheDocument();
  expect(screen.getAllByRole("img")).toHaveLength(2);
});

it("uses singular RESULT for exactly one match", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [item(1)] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");

  expect(await screen.findByText("1 RESULT")).toBeInTheDocument();
});

it("opens the lightbox on a plain click of a result", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [item(1), item(2)] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");
  await screen.findByText("2 RESULTS");

  const tiles = screen.getAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();
});

it("filters results client-side by kind chip without refetching", async () => {
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd === "search_media") {
      calls += 1;
      return [item(1, "photo"), item(2, "video")];
    }
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");
  await screen.findByText("2 RESULTS");
  expect(calls).toBe(1);

  await user.click(screen.getByRole("button", { name: "VIDEOS" }));

  expect(await screen.findByText("1 RESULT")).toBeInTheDocument();
  expect(calls).toBe(1);
});

it("navigates between results with the prev/next buttons, clamped to the range", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [item(1), item(2)] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");
  await screen.findByText("2 RESULTS");

  const tiles = screen.getAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  expect(within(dialog).getByText("02 / 2")).toBeInTheDocument();

  // Already at the last result — clicking Next again stays put.
  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  expect(within(dialog).getByText("02 / 2")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: /previous/i }));
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();

  // Already at the first result — clicking Previous again stays put.
  await user.click(within(dialog).getByRole("button", { name: /previous/i }));
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: "CLOSE" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("clamps the open lightbox index when the kind filter shrinks the results", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [item(1, "photo"), item(2, "video")] : undefined));
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");
  await screen.findByText("2 RESULTS");

  const tiles = screen.getAllByRole("button", { name: /photos\// });
  await user.click(tiles[1]);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("02 / 2")).toBeInTheDocument();

  // Radix marks the rest of the page `aria-hidden` (and pointer-events:
  // none) while the dialog is open, so the chip is only reachable here via
  // `fireEvent` with `hidden: true` — that's fine, this is just exercising
  // the underlying state clamp, not a11y or real pointer interaction.
  fireEvent.click(screen.getByRole("button", { name: "PHOTOS", hidden: true }));

  await waitFor(() => {
    expect(within(screen.getByRole("dialog")).getByText("01 / 1")).toBeInTheDocument();
  });
});

it("keeps a non-empty result set and its grid on screen while typing further, instead of showing the loader", async () => {
  let resolveNext: (() => void) | undefined;
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd !== "search_media") return undefined;
    calls += 1;
    if (calls === 1) return [item(1), item(2)];
    return new Promise((resolve) => {
      resolveNext = () => resolve([item(1)]);
    });
  });
  const user = userEvent.setup();
  renderPage();

  await user.type(screen.getByRole("textbox"), "beach");
  await screen.findByText("2 RESULTS");

  await user.type(screen.getByRole("textbox"), "es");
  await waitFor(() => expect(calls).toBe(2));

  // The second search is now in flight, but the previous non-empty
  // result set must stay visible — no loader, grid still showing the
  // prior results.
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("2 RESULTS")).toBeInTheDocument();

  resolveNext?.();
  expect(await screen.findByText("1 RESULT")).toBeInTheDocument();
});

it("goes back to the hint when the query is cleared", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [item(1)] : undefined));
  const user = userEvent.setup();
  renderPage();

  const input = screen.getByRole("textbox");
  await user.type(input, "beach");
  await screen.findByText("1 RESULT");

  await user.clear(input);

  await waitFor(() => expect(screen.getByText("TYPE TO SEARCH")).toBeInTheDocument());
});
