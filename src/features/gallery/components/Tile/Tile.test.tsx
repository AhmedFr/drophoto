import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { MediaItem, MediaRow } from "@/lib/api/media";
import type { Tile as TileT } from "@/lib/media/layout";
import { mediaItem } from "@/test/mediaFactories";
import { Tile } from "./Tile";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://mock/${path}`,
}));

type ItemOverrides = Omit<Partial<MediaItem>, "row"> & { row?: Partial<MediaRow> };

function item({ row, ...rest }: ItemOverrides = {}): MediaItem {
  return mediaItem(1, { ...rest, row: { ...mediaItem(1).row, ...row } });
}

function tile(overrides: Partial<TileT> = {}): TileT {
  return {
    entry: { id: 1, taken_at: "2024-06-15T12:00:00+00:00", width: 100, height: 200 },
    width: 240,
    height: 160,
    index: 0,
    ...overrides,
  };
}

it("sets the img alt to rel_path", () => {
  render(<Tile tile={tile()} item={item({ row: { rel_path: "b.jpg" } })} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("img")).toHaveAttribute("alt", "b.jpg");
});

it("calls onOpen with the tile index on click", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} item={item()} onOpen={onOpen} selected={false} onToggle={() => {}} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onOpen with the tile index on Enter", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} item={item()} onOpen={onOpen} selected={false} onToggle={() => {}} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onToggle (a plain toggle, not a shift-range) with the tile index on Space", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 7 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: " " });
  expect(onToggle).toHaveBeenCalledWith(7, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("shows a video badge with the formatted duration", () => {
  const videoItem = item({ row: { kind: "video", duration_ms: 42_000 } });
  render(<Tile tile={tile()} item={videoItem} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByTestId("video-badge")).toHaveTextContent("0:42");
});

it("does not show a video badge for photos", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.queryByTestId("video-badge")).not.toBeInTheDocument();
});

it("shows a MISSING badge when missing_at is set", () => {
  const missingItem = item({ row: { missing_at: "2026-08-30T00:00:00Z" } });
  render(<Tile tile={tile()} item={missingItem} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByTestId("missing-badge")).toHaveTextContent("MISSING");
});

it("does not show a MISSING badge when missing_at is null", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.queryByTestId("missing-badge")).not.toBeInTheDocument();
});

it("shows an OFFLINE label only when the item is offline", () => {
  const { rerender } = render(<Tile tile={tile()} item={item({ online: true })} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();

  rerender(<Tile tile={tile()} item={item({ online: false })} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
});

it("hides the image on load error", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  const img = screen.getByRole("img");
  img.dispatchEvent(new Event("error", { bubbles: true }));
  expect(img).toHaveStyle({ opacity: "0" });
});

it("renders a placeholder with the uppercased extension instead of an img when has_thumb is false", () => {
  const heicItem = item({ has_thumb: false, row: { ext: "heic" } });
  render(<Tile tile={tile()} item={heicItem} onOpen={() => {}} selected={false} onToggle={() => {}} />);

  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByLabelText("No preview")).toBeInTheDocument();
  expect(screen.getByText("HEIC")).toBeInTheDocument();
});

it("calls onToggle instead of onOpen on a cmd/ctrl-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onToggle on a ctrl-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"), { ctrlKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onToggle with shiftKey true on a shift-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"), { shiftKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, true);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onOpen on a plain click even when the tile is already selected", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledWith(3);
  expect(onToggle).not.toHaveBeenCalled();
});

it("prevents default on shift-mousedown to avoid text selection", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  const event = new MouseEvent("mousedown", { shiftKey: true, bubbles: true, cancelable: true });
  screen.getByRole("button").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it("does not prevent default on a plain mousedown", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  screen.getByRole("button").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("shows a selected ring and check mark when selected", () => {
  const t = tile({ index: 3 });
  render(<Tile tile={t} item={item()} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(screen.getByRole("button")).toHaveClass("ring-2");
  expect(screen.getByTestId("tile-selected-check")).toBeInTheDocument();
});

it("does not show a selected ring or check mark when not selected", () => {
  const t = tile({ index: 3 });
  render(<Tile tile={t} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("button")).not.toHaveClass("ring-2");
  expect(screen.queryByTestId("tile-selected-check")).not.toBeInTheDocument();
});

it("reflects the selected state via aria-selected", () => {
  const { rerender } = render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "false");

  rerender(<Tile tile={tile()} item={item()} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(screen.getByRole("button")).toHaveAttribute("aria-selected", "true");
});

it("defaults to unfocused when focused is omitted", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("button")).toHaveAttribute("data-focused", "false");
});

it("reflects keyboard focus via data-focused and a visible ring", () => {
  const { rerender } = render(
    <Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} focused={false} />,
  );
  expect(screen.getByRole("button")).toHaveAttribute("data-focused", "false");
  expect(screen.getByRole("button")).not.toHaveClass("outline-2");

  rerender(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} focused />);
  expect(screen.getByRole("button")).toHaveAttribute("data-focused", "true");
  expect(screen.getByRole("button")).toHaveClass("outline-2");
});

// ---------------------------------------------------------------------
// Placeholder tiles: the chunk covering this index hasn't landed yet, so
// there's no row to render. The box is already the right size (the layout
// comes from the timeline index), so nothing reflows when it arrives.
// ---------------------------------------------------------------------

it("renders a sized, busy placeholder with no image or badges when item is undefined", () => {
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected={false} onToggle={() => {}} />);

  const box = screen.getByRole("button");
  expect(box).toHaveAttribute("aria-busy", "true");
  expect(box).toHaveClass("bg-surface-2");
  expect(box).toHaveStyle({ width: "240px", height: "160px" });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByTestId("video-badge")).not.toBeInTheDocument();
  expect(screen.queryByTestId("missing-badge")).not.toBeInTheDocument();
});

it("does not mark a hydrated tile as busy", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
});

it("does not open a placeholder on click or Enter", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={() => {}} />);

  fireEvent.click(screen.getByRole("button"));
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

  expect(onOpen).not.toHaveBeenCalled();
});

// Selection is keyed on `tile.entry.id`, which the timeline index knows
// for every tile — so selecting across not-yet-hydrated photos works.
it("still toggles selection on a placeholder", () => {
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected={false} onToggle={onToggle} />);

  fireEvent.click(screen.getByRole("button"), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);

  fireEvent.keyDown(screen.getByRole("button"), { key: " " });
  expect(onToggle).toHaveBeenCalledWith(3, false);
});

it("still shows the selected check on a placeholder", () => {
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(screen.getByTestId("tile-selected-check")).toBeInTheDocument();
});
