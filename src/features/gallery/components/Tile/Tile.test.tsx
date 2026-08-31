import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import type { Tile as TileT } from "@/lib/media/layout";
import { Tile } from "./Tile";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://mock/${path}`,
}));

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    row: {
      id: 1,
      drive_id: 1,
      rel_path: "photos/a.jpg",
      hash: "hash1",
      size: 1234,
      kind: "photo",
      ext: "jpg",
      width: 100,
      height: 200,
      duration_ms: null,
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
    thumb_path: "/tmp/thumbs/hash1/400.webp",
    preview_path: "/tmp/thumbs/hash1/2000.webp",
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    has_thumb: true,
    ...overrides,
  };
}

function tile(overrides: Partial<TileT> = {}): TileT {
  return { item: item(), width: 240, height: 160, index: 0, ...overrides };
}

it("sets the img alt to rel_path", () => {
  render(<Tile tile={tile({ item: item({ row: { ...item().row, rel_path: "b.jpg" } }) })} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("img")).toHaveAttribute("alt", "b.jpg");
});

it("calls onOpen with the tile index on click", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} onOpen={onOpen} selected={false} onToggle={() => {}} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onOpen with the tile index on Enter", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} onOpen={onOpen} selected={false} onToggle={() => {}} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onOpen with the tile index on Space", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} onOpen={onOpen} selected={false} onToggle={() => {}} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: " " });
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("shows a video badge with the formatted duration", () => {
  const t = tile({ item: item({ row: { ...item().row, kind: "video", duration_ms: 42_000 } }) });
  render(<Tile tile={t} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByTestId("video-badge")).toHaveTextContent("0:42");
});

it("does not show a video badge for photos", () => {
  render(<Tile tile={tile()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.queryByTestId("video-badge")).not.toBeInTheDocument();
});

it("shows an OFFLINE label only when the item is offline", () => {
  const { rerender } = render(<Tile tile={tile({ item: item({ online: true }) })} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();

  rerender(<Tile tile={tile({ item: item({ online: false }) })} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
});

it("hides the image on load error", () => {
  render(<Tile tile={tile()} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  const img = screen.getByRole("img");
  img.dispatchEvent(new Event("error", { bubbles: true }));
  expect(img).toHaveStyle({ opacity: "0" });
});

it("renders a placeholder with the uppercased extension instead of an img when has_thumb is false", () => {
  const t = tile({ item: item({ has_thumb: false, row: { ...item().row, ext: "heic" } }) });
  render(<Tile tile={t} onOpen={() => {}} selected={false} onToggle={() => {}} />);

  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByLabelText("No preview")).toBeInTheDocument();
  expect(screen.getByText("HEIC")).toBeInTheDocument();
});

it("calls onToggle instead of onOpen on a cmd/ctrl-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"), { metaKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onToggle on a ctrl-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"), { ctrlKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, false);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onToggle with shiftKey true on a shift-click", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"), { shiftKey: true });
  expect(onToggle).toHaveBeenCalledWith(3, true);
  expect(onOpen).not.toHaveBeenCalled();
});

it("calls onOpen on a plain click even when the tile is already selected", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledWith(3);
  expect(onToggle).not.toHaveBeenCalled();
});

it("prevents default on shift-mousedown to avoid text selection", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  const event = new MouseEvent("mousedown", { shiftKey: true, bubbles: true, cancelable: true });
  screen.getByRole("button").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it("does not prevent default on a plain mousedown", () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile tile={tile({ index: 3 })} onOpen={onOpen} selected={false} onToggle={onToggle} />);
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  screen.getByRole("button").dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it("shows a selected ring and check mark when selected", () => {
  const t = tile({ index: 3 });
  render(<Tile tile={t} onOpen={() => {}} selected onToggle={() => {}} />);
  expect(screen.getByRole("button")).toHaveClass("ring-2");
  expect(screen.getByTestId("tile-selected-check")).toBeInTheDocument();
});

it("does not show a selected ring or check mark when not selected", () => {
  const t = tile({ index: 3 });
  render(<Tile tile={t} onOpen={() => {}} selected={false} onToggle={() => {}} />);
  expect(screen.getByRole("button")).not.toHaveClass("ring-2");
  expect(screen.queryByTestId("tile-selected-check")).not.toBeInTheDocument();
});
