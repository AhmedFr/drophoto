import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/**
 * The tile box itself. Not `getByRole("button")` any more: the hover
 * checkmark is a real button nested inside the tile, so a bare button query
 * matches two elements.
 */
function tileEl() {
  return screen.getByTestId("tile");
}

/** The tile's hover/selection checkmark. */
function checkEl() {
  return screen.getByTestId("tile-check");
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
  fireEvent.click(tileEl());
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onOpen with the tile index on Enter", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} item={item()} onOpen={onOpen} selected={false} onToggle={() => {}} />);
  fireEvent.keyDown(tileEl(), { key: "Enter" });
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onToggle (a plain toggle, not a shift-range) with the tile index on Space", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 7 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.keyDown(tileEl(), { key: " " });
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
  fireEvent.click(tileEl(), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onToggle on a ctrl-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(tileEl(), { ctrlKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onToggle with shiftKey true on a shift-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(tileEl(), { shiftKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, true);
  expect(onOpen).not.toHaveBeenCalled();
});

// Being selected doesn't by itself change what a click means — only
// `selectionMode` does, and GalleryPage derives that from the whole
// selection rather than from this one tile.
it("calls onOpen on a plain click of a selected tile when selection mode is off", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected onToggle={onToggle} />);
  fireEvent.click(tileEl());
  expect(onOpen).toHaveBeenCalledWith(3);
  expect(onToggle).not.toHaveBeenCalled();
});

it("prevents default on shift-mousedown to avoid text selection", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  const event = new MouseEvent("mousedown", { shiftKey: true, bubbles: true, cancelable: true });
  tileEl().dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it("does not prevent default on a plain mousedown", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  tileEl().dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("shows a selected ring and a filled, pressed check mark when selected", () => {
  const t = tile({ index: 3 });
  render(<Tile tile={t} item={item()} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(tileEl()).toHaveClass("ring-2");
  expect(checkEl()).toHaveAttribute("aria-pressed", "true");
  expect(checkEl()).toHaveAccessibleName("Deselect");
  expect(checkEl()).toHaveClass("opacity-100");
});

// The checkmark is always mounted — it's the hover affordance, not just a
// selected badge — so "not selected" means transparent and unpressed
// rather than absent.
it("keeps the check mark mounted but transparent and unpressed when not selected", () => {
  const t = tile({ index: 3 });
  render(<Tile tile={t} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(tileEl()).not.toHaveClass("ring-2");
  expect(checkEl()).toHaveAttribute("aria-pressed", "false");
  expect(checkEl()).toHaveAccessibleName("Select");
  expect(checkEl()).toHaveClass("opacity-0", "group-hover:opacity-100");
});

// In selection mode every tile is a target, so the affordance stops hiding
// behind hover.
it("shows an unselected check mark without hover once selection mode is on", () => {
  render(
    <Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} selectionMode />,
  );
  expect(checkEl()).toHaveClass("opacity-100");
  expect(checkEl()).not.toHaveClass("opacity-0");
});

it("reflects the selected state via aria-selected", () => {
  const { rerender } = render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(tileEl()).toHaveAttribute("aria-selected", "false");

  rerender(<Tile tile={tile()} item={item()} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(tileEl()).toHaveAttribute("aria-selected", "true");
});

it("defaults to unfocused when focused is omitted", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(tileEl()).toHaveAttribute("data-focused", "false");
});

it("reflects keyboard focus via data-focused and a visible ring", () => {
  const { rerender } = render(
    <Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} focused={false} />,
  );
  expect(tileEl()).toHaveAttribute("data-focused", "false");
  expect(tileEl()).not.toHaveClass("outline-2");

  rerender(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} focused />);
  expect(tileEl()).toHaveAttribute("data-focused", "true");
  expect(tileEl()).toHaveClass("outline-2");
});

// ---------------------------------------------------------------------
// Placeholder tiles: the chunk covering this index hasn't landed yet, so
// there's no row to render. The box is already the right size (the layout
// comes from the timeline index), so nothing reflows when it arrives.
// ---------------------------------------------------------------------

it("renders a sized, busy placeholder with no image or badges when item is undefined", () => {
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected={false} onToggle={() => {}} />);

  const box = tileEl();
  expect(box).toHaveAttribute("aria-busy", "true");
  expect(box).toHaveClass("bg-surface-2");
  expect(box).toHaveStyle({ width: "240px", height: "160px" });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByTestId("video-badge")).not.toBeInTheDocument();
  expect(screen.queryByTestId("missing-badge")).not.toBeInTheDocument();
});

it("does not mark a hydrated tile as busy", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(tileEl()).not.toHaveAttribute("aria-busy");
});

it("does not open a placeholder on click or Enter", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={() => {}} />);

  fireEvent.click(tileEl());
  fireEvent.keyDown(tileEl(), { key: "Enter" });

  expect(onOpen).not.toHaveBeenCalled();
});

// Selection is keyed on `tile.entry.id`, which the timeline index knows
// for every tile — so selecting across not-yet-hydrated photos works.
it("still toggles selection on a placeholder", () => {
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected={false} onToggle={onToggle} />);

  fireEvent.click(tileEl(), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);

  fireEvent.keyDown(tileEl(), { key: " " });
  expect(onToggle).toHaveBeenCalledWith(3, false);
});

it("still shows the selected check on a placeholder", () => {
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(checkEl()).toHaveAttribute("aria-pressed", "true");
});

it("still offers the check mark on a placeholder, and it toggles", async () => {
  const onCheckToggle = vi.fn();
  render(
    <Tile tile={tile({ index: 3 })} onOpen={() => {}} selected={false} onToggle={() => {}} onCheckToggle={onCheckToggle} />,
  );

  await userEvent.click(checkEl());

  expect(onCheckToggle).toHaveBeenCalledWith(3);
});

// The geometry and the rows are cached and refetched independently, so
// position N can briefly mean two different photos on the two sides. The
// tile is the paint site, so it is where the mismatch has to be caught.
it("renders a placeholder when the row handed to it is a different photo", () => {
  render(
    <Tile
      tile={tile({ entry: { id: 1, taken_at: null, width: 100, height: 200 } })}
      item={mediaItem(9)}
      onOpen={() => {}}
      selected={false}
      onToggle={() => {}}
    />,
  );

  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(tileEl()).toHaveAttribute("aria-busy", "true");
});

it("does not open a lightbox onto a row belonging to a different photo", () => {
  const onOpen = vi.fn();
  render(
    <Tile
      tile={tile({ index: 4, entry: { id: 1, taken_at: null, width: 100, height: 200 } })}
      item={mediaItem(9)}
      onOpen={onOpen}
      selected={false}
      onToggle={() => {}}
    />,
  );

  fireEvent.click(tileEl());
  expect(onOpen).not.toHaveBeenCalled();
});

// Selection is keyed off the tile's own entry, so it stays correct through
// the mismatch — the tile keeps acting as the photo it represents.
it("still toggles its own index when the row handed to it is a different photo", () => {
  const onToggle = vi.fn();
  render(
    <Tile
      tile={tile({ index: 4, entry: { id: 1, taken_at: null, width: 100, height: 200 } })}
      item={mediaItem(9)}
      onOpen={() => {}}
      selected={false}
      onToggle={onToggle}
    />,
  );

  fireEvent.click(tileEl(), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(4, false);
});

// ---------------------------------------------------------------------
// Google Photos selection (Phase 7.5): the hover checkmark, selection
// mode, and the pointer press that starts a drag-select.
// ---------------------------------------------------------------------

it("shows a checkmark button that selects without opening", async () => {
  const onOpen = vi.fn();
  const onCheckToggle = vi.fn();
  render(
    <Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={() => {}} onCheckToggle={onCheckToggle} />,
  );

  await userEvent.click(screen.getByRole("button", { name: /select/i }));

  expect(onCheckToggle).toHaveBeenCalledWith(3);
  expect(onOpen).not.toHaveBeenCalled();
});

// With no `onCheckToggle` wired the checkmark is still a working toggle —
// it just falls back to the tile's plain (non-range) toggle.
it("falls back to the plain toggle when no onCheckToggle is given", async () => {
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} item={item()} onOpen={() => {}} selected={false} onToggle={onToggle} />);

  await userEvent.click(checkEl());

  expect(onToggle).toHaveBeenCalledWith(3, false);
});

it("opens on a body click when not in selection mode", async () => {
  const onOpen = vi.fn();
  render(
    <Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={() => {}} selectionMode={false} />,
  );

  await userEvent.click(tileEl());

  expect(onOpen).toHaveBeenCalledWith(3);
});

it("toggles instead of opening on a body click in selection mode", async () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(
    <Tile tile={tile({ index: 3 })} item={item()} onOpen={onOpen} selected={false} onToggle={onToggle} selectionMode />,
  );

  await userEvent.click(tileEl());

  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

// A placeholder has no row to open, but it does have an id to select — so
// selection mode reaches it exactly like a hydrated tile.
it("toggles a placeholder on a body click in selection mode", async () => {
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={() => {}} selected={false} onToggle={onToggle} selectionMode />);

  await userEvent.click(tileEl());

  expect(onToggle).toHaveBeenCalledWith(3, false);
});

it("starts the drag gesture on a pointer press of the checkmark", async () => {
  const onCheckPointerDown = vi.fn();
  render(
    <Tile
      tile={tile({ index: 3 })}
      item={item()}
      onOpen={() => {}}
      selected={false}
      onToggle={() => {}}
      onCheckPointerDown={onCheckPointerDown}
    />,
  );

  await userEvent.pointer({ target: checkEl(), keys: "[MouseLeft>]" });

  expect(onCheckPointerDown).toHaveBeenCalledWith(3, expect.anything());
});

// The press already toggled (the gesture applies its origin immediately),
// so the click the browser synthesises on release must not undo it.
it("does not toggle a second time on the click that follows a pointer press", async () => {
  const onCheckPointerDown = vi.fn();
  const onCheckToggle = vi.fn();
  render(
    <Tile
      tile={tile({ index: 3 })}
      item={item()}
      onOpen={() => {}}
      selected={false}
      onToggle={() => {}}
      onCheckToggle={onCheckToggle}
      onCheckPointerDown={onCheckPointerDown}
    />,
  );

  await userEvent.click(checkEl());

  expect(onCheckPointerDown).toHaveBeenCalledTimes(1);
  expect(onCheckToggle).not.toHaveBeenCalled();
});

// ...but a keyboard activation sends no pointer press, so it must still
// toggle. This is the path that keeps the checkmark usable without a mouse.
it("toggles on a keyboard activation of the checkmark even with a drag handler wired", () => {
  const onCheckPointerDown = vi.fn();
  const onCheckToggle = vi.fn();
  render(
    <Tile
      tile={tile({ index: 3 })}
      item={item()}
      onOpen={() => {}}
      selected={false}
      onToggle={() => {}}
      onCheckToggle={onCheckToggle}
      onCheckPointerDown={onCheckPointerDown}
    />,
  );

  fireEvent.click(checkEl(), { detail: 0 });

  expect(onCheckToggle).toHaveBeenCalledWith(3);
  expect(onCheckPointerDown).not.toHaveBeenCalled();
});

// A press that wanders off and releases over another tile sends no click
// here — so the suppression flag must not survive it and swallow the next
// keyboard activation of this same checkmark.
it("does not swallow a later keyboard activation after a drag left the tile", async () => {
  const onCheckToggle = vi.fn();
  render(
    <Tile
      tile={tile({ index: 3 })}
      item={item()}
      onOpen={() => {}}
      selected={false}
      onToggle={() => {}}
      onCheckToggle={onCheckToggle}
      onCheckPointerDown={() => {}}
    />,
  );

  // Press the checkmark, then release somewhere else entirely.
  await userEvent.pointer({ target: checkEl(), keys: "[MouseLeft>]" });
  await userEvent.pointer({ target: document.body, keys: "[/MouseLeft]" });

  fireEvent.click(checkEl(), { detail: 0 });

  expect(onCheckToggle).toHaveBeenCalledWith(3);
});

it("reports the pointer entering the tile so a drag can extend to it", () => {
  const onPointerEnter = vi.fn();
  render(
    <Tile
      tile={tile({ index: 3 })}
      item={item()}
      onOpen={() => {}}
      selected={false}
      onToggle={() => {}}
      onPointerEnter={onPointerEnter}
    />,
  );

  fireEvent.pointerEnter(tileEl());

  expect(onPointerEnter).toHaveBeenCalledWith(3);
});

// The browser's own image drag would take the pointer stream away from the
// selection gesture.
it("is not natively draggable", () => {
  render(<Tile tile={tile()} item={item()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(tileEl()).toHaveAttribute("draggable", "false");
});
