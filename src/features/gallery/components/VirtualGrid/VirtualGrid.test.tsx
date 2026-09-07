import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import type { LayoutEntry } from "@/lib/media/layout";
import { virtualizerMockFactory } from "@/test/mockVirtualizer";
import { entryFor, mediaItem } from "@/test/mediaFactories";
import { VirtualGrid } from "./VirtualGrid";

const virtualizerSpies = vi.hoisted(() => ({ measure: vi.fn() }));
vi.mock("@tanstack/react-virtual", () => virtualizerMockFactory(virtualizerSpies));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://mock/${path}`,
}));

let latestResizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverStub {
  #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
    latestResizeCallback = callback;
  }

  observe() {
    this.#callback(
      [{ contentRect: { width: 1000 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  latestResizeCallback = null;
  virtualizerSpies.measure.mockClear();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

function item(id: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return mediaItem(id, {
    ...overrides,
    row: { ...mediaItem(id).row, taken_at: "2025-09-10T12:00:00Z", ...overrides.row },
  });
}

/** A hydrated set: `entries` and `items` in the offset parity the gallery relies on. */
function hydrated(count: number): { entries: LayoutEntry[]; items: MediaItem[] } {
  const items = Array.from({ length: count }, (_, i) => item(i + 1));
  return { entries: items.map(entryFor), items };
}

it("renders a month header with a label and item count", () => {
  const { entries, items } = hydrated(2);
  render(<VirtualGrid entries={entries} items={items} targetRowHeight={200} onOpen={() => {}} selectedIds={new Set()} onToggle={() => {}} />);
  expect(screen.getByText("September 2025")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
});

it("renders a tile per item with alt text", () => {
  const { entries, items } = hydrated(3);
  render(<VirtualGrid entries={entries} items={items} targetRowHeight={200} onOpen={() => {}} selectedIds={new Set()} onToggle={() => {}} />);
  const imgs = screen.getAllByRole("img");
  expect(imgs).toHaveLength(3);
  expect(imgs[0]).toHaveAttribute("alt", "photos/1.jpg");
});

// The layout comes from the index alone, so an entry with no hydrated row
// still takes up its exact space — that's what keeps the scroll height
// stable while chunks land.
it("lays out every entry, rendering placeholders for the ones not yet hydrated", () => {
  const { entries, items } = hydrated(3);
  render(
    <VirtualGrid
      entries={entries}
      items={[items[0]]}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Loading" })).toHaveLength(2);
  expect(screen.getByText("3")).toBeInTheDocument();
});

it("reports the rendered tile-index range via onRangeChange", () => {
  const { entries, items } = hydrated(3);
  const onRangeChange = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      onRangeChange={onRangeChange}
    />,
  );
  expect(onRangeChange).toHaveBeenCalledWith({ start: 0, end: 2 });
});

// Chunk 0 is the right thing to hydrate before the index has landed, so
// the first rows are already in flight when it does.
it("reports a chunk-0 range when there is nothing laid out yet", () => {
  const onRangeChange = vi.fn();
  render(
    <VirtualGrid
      entries={[]}
      items={[]}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      onRangeChange={onRangeChange}
    />,
  );
  expect(onRangeChange).toHaveBeenCalledWith({ start: 0, end: 0 });
});

// A chunk landing must not re-report the range: that would feed straight
// back into the queries that produced it.
it("does not re-report the range when only the hydrated items change", () => {
  const { entries, items } = hydrated(3);
  const onRangeChange = vi.fn();
  const props = {
    entries,
    targetRowHeight: 200,
    onOpen: () => {},
    selectedIds: new Set<number>(),
    onToggle: () => {},
    onRangeChange,
  };
  const { rerender } = render(<VirtualGrid {...props} items={[items[0]]} />);
  // Mount settles at the measured width; what matters is that hydration
  // afterwards adds nothing.
  const callsAfterMount = onRangeChange.mock.calls.length;
  expect(onRangeChange).toHaveBeenLastCalledWith({ start: 0, end: 2 });

  rerender(<VirtualGrid {...props} items={items} />);

  expect(onRangeChange).toHaveBeenCalledTimes(callsAfterMount);
});

it("re-measures the virtualizer when the container is resized", () => {
  const { entries, items } = hydrated(2);
  render(<VirtualGrid entries={entries} items={items} targetRowHeight={200} onOpen={() => {}} selectedIds={new Set()} onToggle={() => {}} />);

  const callsAfterMount = virtualizerSpies.measure.mock.calls.length;
  expect(callsAfterMount).toBeGreaterThan(0);

  act(() => {
    latestResizeCallback?.(
      [{ contentRect: { width: 600 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
  });

  expect(virtualizerSpies.measure.mock.calls.length).toBeGreaterThan(callsAfterMount);
});

it("marks a tile as selected when its id is in selectedIds", () => {
  const { entries, items } = hydrated(2);
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set([2])}
      onToggle={() => {}}
    />,
  );
  // The checkmark is mounted on every tile (it doubles as the hover
  // affordance), so "selected" is its pressed state, not its presence.
  const checks = screen.getAllByTestId("tile-check");
  expect(checks.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
});

it("puts every tile into selection mode once anything is selected", () => {
  const { entries, items } = hydrated(2);
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={onOpen}
      selectedIds={new Set([2])}
      onToggle={onToggle}
      selectionMode
    />,
  );

  fireEvent.click(screen.getAllByRole("button", { name: /photos\// })[0]);

  expect(onToggle).toHaveBeenCalledWith(0, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("reports a tile's pointer entry through onTileEnter so a drag can extend to it", () => {
  const { entries, items } = hydrated(2);
  const onTileEnter = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      onTileEnter={onTileEnter}
    />,
  );

  fireEvent.pointerEnter(screen.getAllByRole("button", { name: /photos\// })[1]);

  expect(onTileEnter).toHaveBeenCalledWith(1);
});

it("starts a drag-select from a tile's checkmark", () => {
  const { entries, items } = hydrated(2);
  const onCheckPointerDown = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      onCheckPointerDown={onCheckPointerDown}
    />,
  );

  fireEvent.pointerDown(screen.getAllByTestId("tile-check")[1]);

  expect(onCheckPointerDown).toHaveBeenCalledWith(1, expect.anything());
});

it("passes cmd/ctrl-clicks through to onToggle instead of onOpen", () => {
  const { entries, items } = hydrated(2);
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={onOpen}
      selectedIds={new Set()}
      onToggle={onToggle}
    />,
  );
  const tiles = screen.getAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[1], { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(1, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("marks the tile at focusIndex as keyboard-focused", () => {
  const { entries, items } = hydrated(2);
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      focusIndex={1}
    />,
  );
  const tiles = screen.getAllByRole("button", { name: /photos\// });
  expect(tiles[0]).toHaveAttribute("data-focused", "false");
  expect(tiles[1]).toHaveAttribute("data-focused", "true");
});

it("reports the row grouping via onRowsChange, omitting the month header", () => {
  const { entries, items } = hydrated(2);
  const onRowsChange = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      onRowsChange={onRowsChange}
    />,
  );
  expect(onRowsChange).toHaveBeenCalledWith([[0, 1]]);
});

it("clicking a month header's select action calls onSelectMonth with that month's ids", () => {
  const { entries, items } = hydrated(2);
  const onSelectMonth = vi.fn();
  render(
    <VirtualGrid
      entries={entries}
      items={items}
      targetRowHeight={200}
      onOpen={() => {}}
      selectedIds={new Set()}
      onToggle={() => {}}
      onSelectMonth={onSelectMonth}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /select all/i }));
  expect(onSelectMonth).toHaveBeenCalledWith([1, 2], false);
});
