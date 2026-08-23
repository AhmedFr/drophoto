import { act, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { virtualizerMockFactory } from "@/test/mockVirtualizer";
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
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photos/${id}.jpg`,
      hash: `hash${id}`,
      size: 1234,
      kind: "photo",
      ext: "jpg",
      width: 100,
      height: 200,
      duration_ms: null,
      taken_at: "2025-09-10T12:00:00Z",
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
    },
    thumb_path: `/tmp/thumbs/hash${id}/400.webp`,
    preview_path: `/tmp/thumbs/hash${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    ...overrides,
  };
}

it("renders a month header with a label and item count", () => {
  const items = [item(1), item(2)];
  render(<VirtualGrid items={items} targetRowHeight={200} onOpen={() => {}} />);
  expect(screen.getByText("September 2025")).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();
});

it("renders a tile per item with alt text", () => {
  const items = [item(1), item(2), item(3)];
  render(<VirtualGrid items={items} targetRowHeight={200} onOpen={() => {}} />);
  const imgs = screen.getAllByRole("img");
  expect(imgs).toHaveLength(3);
  expect(imgs[0]).toHaveAttribute("alt", "photos/1.jpg");
});

it("calls onNearEnd once when the last rendered row is near the end of the layout", () => {
  const items = Array.from({ length: 3 }, (_, i) => item(i + 1));
  const onNearEnd = vi.fn();
  render(<VirtualGrid items={items} targetRowHeight={200} onOpen={() => {}} onNearEnd={onNearEnd} />);
  expect(onNearEnd).toHaveBeenCalledTimes(1);
});

it("does not call onNearEnd again for the same layout length", () => {
  const items = Array.from({ length: 3 }, (_, i) => item(i + 1));
  const onNearEnd = vi.fn();
  const { rerender } = render(
    <VirtualGrid items={items} targetRowHeight={200} onOpen={() => {}} onNearEnd={onNearEnd} />,
  );
  rerender(<VirtualGrid items={items} targetRowHeight={200} onOpen={() => {}} onNearEnd={onNearEnd} />);
  expect(onNearEnd).toHaveBeenCalledTimes(1);
});

it("re-measures the virtualizer when the container is resized", () => {
  const items = [item(1), item(2)];
  render(<VirtualGrid items={items} targetRowHeight={200} onOpen={() => {}} />);

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
