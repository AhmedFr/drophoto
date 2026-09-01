import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { Lightbox } from "./Lightbox";
import type { LightboxProps } from "./Lightbox.types";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, convertFileSrc: (path: string) => `asset://mock/${path}` };
});

vi.mock("@tauri-apps/plugin-opener");

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
});

function renderLightbox(props: LightboxProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Lightbox {...props} />
    </QueryClientProvider>,
  );
}

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
      taken_at: null,
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
    original_path: `/Volumes/Kodachrome/photos/${id}.jpg`,
    has_thumb: true,
    ...overrides,
  };
}

function items(n: number): MediaItem[] {
  return Array.from({ length: n }, (_, i) => item(i + 1));
}

it("shows the current position counter", () => {
  renderLightbox({ items: items(10), index: 2, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  expect(within(screen.getByRole("dialog")).getByText("03 / 10")).toBeInTheDocument();
});

it("shows the preview image for the current item", () => {
  renderLightbox({ items: items(10), index: 2, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/tmp/thumbs/hash3/2000.webp");
});

it("calls onClose when clicking the backdrop", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: onClose, onPrev: vi.fn(), onNext: vi.fn() });

  await user.click(screen.getByRole("dialog"));

  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not close when clicking the image or the metadata panel", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: onClose, onPrev: vi.fn(), onNext: vi.fn() });

  await user.click(screen.getByRole("img"));
  await user.click(screen.getByRole("button", { name: /reveal in finder/i }));

  expect(onClose).not.toHaveBeenCalled();
});

it("calls onPrev and onNext when clicking the nav buttons", async () => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 1, onClose: vi.fn(), onPrev: onPrev, onNext: onNext });

  await user.click(screen.getByRole("button", { name: /previous/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
});

it("falls back to the thumb image when the preview fails to load", () => {
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  const img = screen.getByRole("img") as HTMLImageElement;
  fireEvent.error(img);

  expect(img.src).toContain("/tmp/thumbs/hash1/400.webp");
});

it("shows a placeholder instead of an img when the current item has no thumbnail", () => {
  renderLightbox({ items: [item(1, { has_thumb: false, row: { ...item(1).row, ext: "arw" } })], index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByLabelText("No preview")).toBeInTheDocument();
  expect(screen.getByText("ARW")).toBeInTheDocument();
});

it("calls onNext when pressing ArrowRight", () => {
  const onNext = vi.fn();
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: onNext });

  fireEvent.keyDown(window, { key: "ArrowRight" });

  expect(onNext).toHaveBeenCalledTimes(1);
});

it("calls onClose exactly once when clicking CLOSE", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: onClose, onPrev: vi.fn(), onNext: vi.fn() });

  await user.click(screen.getByRole("button", { name: "CLOSE" }));

  expect(onClose).toHaveBeenCalledTimes(1);
});

it("closes when pressing Escape", async () => {
  const onClose = vi.fn();
  renderLightbox({ items: items(3), index: 0, onClose: onClose, onPrev: vi.fn(), onNext: vi.fn() });

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("closes when clicking the overlay behind the dialog", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: onClose, onPrev: vi.fn(), onNext: vi.fn() });

  await user.click(screen.getByTestId("lightbox-overlay"));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("moves focus inside the dialog when opened", async () => {
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
});

it("traps Tab focus within the dialog", async () => {
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

  await user.tab();
  await user.tab();

  expect(dialog.contains(document.activeElement)).toBe(true);
});

it("locks page scroll while open", async () => {
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  await waitFor(() => {
    const locked =
      document.body.style.overflow === "hidden" || document.body.style.pointerEvents === "none";
    expect(locked).toBe(true);
  });
});

it("toggles fullscreen, hiding and reshowing the metadata panel", async () => {
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Enter full screen" }));

  expect(screen.queryByRole("button", { name: /reveal in finder/i })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Exit full screen" }));

  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeInTheDocument();
});

it("exits fullscreen on the first Escape, and closes on the second", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose, onPrev: vi.fn(), onNext: vi.fn() });

  await user.click(screen.getByRole("button", { name: "Enter full screen" }));
  expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  await waitFor(() => expect(screen.getByRole("button", { name: "Enter full screen" })).toBeInTheDocument());
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it("still navigates with the arrow keys while fullscreen", async () => {
  const onNext = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext });

  await user.click(screen.getByRole("button", { name: "Enter full screen" }));
  fireEvent.keyDown(window, { key: "ArrowRight" });

  expect(onNext).toHaveBeenCalledTimes(1);
});

it("keeps the prev/next buttons working while fullscreen", async () => {
  const onNext = vi.fn();
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext });

  await user.click(screen.getByRole("button", { name: "Enter full screen" }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  expect(onNext).toHaveBeenCalledTimes(1);
});

it("toggles fullscreen on double-clicking the image", async () => {
  const user = userEvent.setup();
  renderLightbox({ items: items(3), index: 0, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() });

  await user.dblClick(screen.getByRole("img"));

  expect(screen.getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();

  await user.dblClick(screen.getByRole("img"));

  expect(screen.getByRole("button", { name: "Enter full screen" })).toBeInTheDocument();
});

// The end-to-end shape of the arrow-keys-in-a-text-field bug: the tag
// panel's filter is a plain `<input>` inside the open lightbox, and the
// arrow-key listener is bound on `window`, so moving the caret inside it
// used to flip to another photo mid-typing.
it("does not navigate when arrow keys are pressed inside the tag panel filter", async () => {
  const user = userEvent.setup();
  const onPrev = vi.fn();
  const onNext = vi.fn();
  renderLightbox({ items: items(3), index: 1, onClose: vi.fn(), onPrev, onNext });

  await user.click(screen.getByRole("button", { name: "Add tag" }));
  const filter = await screen.findByPlaceholderText("Filter or create a tag…");
  await user.click(filter);
  await user.type(filter, "wed{ArrowLeft}{ArrowRight}");

  expect(filter).toHaveValue("wed");
  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});
