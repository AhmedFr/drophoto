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
    },
    thumb_path: "/tmp/thumbs/hash1/400.webp",
    preview_path: "/tmp/thumbs/hash1/2000.webp",
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    ...overrides,
  };
}

function tile(overrides: Partial<TileT> = {}): TileT {
  return { item: item(), width: 240, height: 160, index: 0, ...overrides };
}

it("sets the img alt to rel_path", () => {
  render(<Tile tile={tile({ item: item({ row: { ...item().row, rel_path: "b.jpg" } }) })} onOpen={() => {}} />);
  expect(screen.getByRole("img")).toHaveAttribute("alt", "b.jpg");
});

it("calls onOpen with the tile index on click", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onOpen with the tile index on Enter", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} onOpen={onOpen} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("calls onOpen with the tile index on Space", () => {
  const onOpen = vi.fn();
  render(<Tile tile={tile({ index: 7 })} onOpen={onOpen} />);
  fireEvent.keyDown(screen.getByRole("button"), { key: " " });
  expect(onOpen).toHaveBeenCalledWith(7);
});

it("shows a video badge with the formatted duration", () => {
  const t = tile({ item: item({ row: { ...item().row, kind: "video", duration_ms: 42_000 } }) });
  render(<Tile tile={t} onOpen={() => {}} />);
  expect(screen.getByTestId("video-badge")).toHaveTextContent("0:42");
});

it("does not show a video badge for photos", () => {
  render(<Tile tile={tile()} onOpen={() => {}} />);
  expect(screen.queryByTestId("video-badge")).not.toBeInTheDocument();
});

it("shows an OFFLINE label only when the item is offline", () => {
  const { rerender } = render(<Tile tile={tile({ item: item({ online: true }) })} onOpen={() => {}} />);
  expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();

  rerender(<Tile tile={tile({ item: item({ online: false }) })} onOpen={() => {}} />);
  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
});

it("hides the image on load error", () => {
  render(<Tile tile={tile()} onOpen={() => {}} />);
  const img = screen.getByRole("img");
  img.dispatchEvent(new Event("error", { bubbles: true }));
  expect(img).toHaveStyle({ opacity: "0" });
});
