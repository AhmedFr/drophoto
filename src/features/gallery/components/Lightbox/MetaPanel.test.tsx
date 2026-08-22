import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { MetaPanel } from "./MetaPanel";

vi.mock("@tauri-apps/plugin-opener");

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    row: {
      id: 1,
      drive_id: 1,
      rel_path: "photos/family/beach.jpg",
      hash: "hash1",
      size: 2_500_000,
      kind: "photo",
      ext: "jpg",
      width: 4000,
      height: 3000,
      duration_ms: null,
      taken_at: "2024-06-15T12:30:00Z",
      camera: "Sony α7 IV",
      lens: "FE 35mm F1.4 GM",
      aperture: 2,
      shutter: 0.00125,
      iso: 100,
      focal_mm: 35,
      lat: 37.7749,
      lon: -122.4194,
      missing_at: null,
    },
    thumb_path: "/tmp/thumbs/hash1/400.webp",
    preview_path: "/tmp/thumbs/hash1/2000.webp",
    drive_name: "Kodachrome",
    online: true,
    original_path: "/Volumes/Kodachrome/photos/family/beach.jpg",
    ...overrides,
  };
}

it("shows the filename and dims/size/ext line", () => {
  render(<MetaPanel item={item()} />);

  expect(screen.getByText("beach.jpg")).toBeInTheDocument();
  expect(screen.getByText(/4000 × 3000/)).toBeInTheDocument();
  expect(screen.getByText(/JPG/)).toBeInTheDocument();
});

it("shows formatted camera rows", () => {
  render(<MetaPanel item={item()} />);

  expect(screen.getByText("Sony α7 IV")).toBeInTheDocument();
  expect(screen.getByText("FE 35mm F1.4 GM")).toBeInTheDocument();
  expect(screen.getByText("ƒ/2.0 · 1/800s")).toBeInTheDocument();
  expect(screen.getByText("100 · 35mm")).toBeInTheDocument();
});

it("shows the taken date and drive name", () => {
  render(<MetaPanel item={item()} />);

  expect(screen.getByText("15 Jun 2024 · 12:30")).toBeInTheDocument();
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
});

it("shows formatted coordinates when present", () => {
  render(<MetaPanel item={item()} />);

  expect(screen.getByText("37.77°N 122.42°W")).toBeInTheDocument();
});

it("shows 'No location data' when there are no coordinates", () => {
  render(<MetaPanel item={item({ row: { ...item().row, lat: null, lon: null } })} />);

  expect(screen.getByText("No location data")).toBeInTheDocument();
});

it("shows an OFFLINE badge and disables Reveal in Finder when offline", () => {
  render(<MetaPanel item={item({ online: false })} />);

  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeDisabled();
});

it("enables Reveal in Finder when online with an original_path", () => {
  render(<MetaPanel item={item()} />);

  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeEnabled();
});

it("disables Reveal in Finder when online but there is no original_path", () => {
  render(<MetaPanel item={item({ online: true, original_path: null })} />);

  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeDisabled();
});

it("shows an error message when revealing in Finder fails", async () => {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  vi.mocked(revealItemInDir).mockRejectedValue(new Error("no such file"));
  const user = userEvent.setup();
  render(<MetaPanel item={item()} />);

  await user.click(screen.getByRole("button", { name: /reveal in finder/i }));

  expect(await screen.findByText("no such file")).toBeInTheDocument();
});
