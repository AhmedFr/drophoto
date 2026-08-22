import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { ThumbGrid } from "./ThumbGrid";

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
    },
    thumb_path: "/tmp/thumbs/hash1/400.webp",
    drive_name: "Kodachrome",
    online: true,
    ...overrides,
  };
}

it("renders one img per item with alt set to rel_path", () => {
  const items = [
    item({ row: { ...item().row, id: 1, rel_path: "a.jpg" } }),
    item({ row: { ...item().row, id: 2, rel_path: "b.jpg" } }),
  ];
  render(<ThumbGrid items={items} />);
  const imgs = screen.getAllByRole("img");
  expect(imgs).toHaveLength(2);
  expect(imgs[0]).toHaveAttribute("alt", "a.jpg");
  expect(imgs[1]).toHaveAttribute("alt", "b.jpg");
});

it("shows the drive name badge for every item", () => {
  render(<ThumbGrid items={[item({ drive_name: "Kodachrome" })]} />);
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
});

it("shows an OFFLINE badge only for offline items", () => {
  const items = [item({ row: { ...item().row, id: 1 }, online: true }), item({ row: { ...item().row, id: 2 }, online: false })];
  render(<ThumbGrid items={items} />);
  expect(screen.getAllByText("OFFLINE")).toHaveLength(1);
});

it("hides the image on load error", () => {
  render(<ThumbGrid items={[item()]} />);
  const img = screen.getByRole("img");
  img.dispatchEvent(new Event("error", { bubbles: true }));
  expect(img).toHaveStyle({ opacity: "0" });
});

it("falls back to a 4/3 aspect ratio when dimensions are missing", () => {
  render(<ThumbGrid items={[item({ row: { ...item().row, width: null, height: null } })]} />);
  const img = screen.getByRole("img");
  expect(img.parentElement).toHaveStyle({ aspectRatio: "4 / 3" });
});

it("shows a video badge only for video items", () => {
  const items = [
    item({ row: { ...item().row, id: 1, kind: "photo" } }),
    item({ row: { ...item().row, id: 2, kind: "video" } }),
  ];
  render(<ThumbGrid items={items} />);
  expect(screen.getAllByTestId("video-badge")).toHaveLength(1);
});
