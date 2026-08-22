import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { Lightbox } from "./Lightbox";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://mock/${path}`,
}));

vi.mock("@tauri-apps/plugin-opener");

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
    },
    thumb_path: `/tmp/thumbs/hash${id}/400.webp`,
    preview_path: `/tmp/thumbs/hash${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: `/Volumes/Kodachrome/photos/${id}.jpg`,
    ...overrides,
  };
}

function items(n: number): MediaItem[] {
  return Array.from({ length: n }, (_, i) => item(i + 1));
}

it("shows the current position counter", () => {
  render(
    <Lightbox items={items(10)} index={2} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  expect(within(screen.getByRole("dialog")).getByText("03 / 10")).toBeInTheDocument();
});

it("shows the preview image for the current item", () => {
  render(
    <Lightbox items={items(10)} index={2} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  const img = screen.getByRole("img") as HTMLImageElement;
  expect(img.src).toContain("/tmp/thumbs/hash3/2000.webp");
});

it("calls onClose when clicking the backdrop", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <Lightbox items={items(3)} index={0} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  await user.click(screen.getByRole("dialog"));

  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not close when clicking the image or the metadata panel", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <Lightbox items={items(3)} index={0} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  await user.click(screen.getByRole("img"));
  await user.click(screen.getByRole("button", { name: /reveal in finder/i }));

  expect(onClose).not.toHaveBeenCalled();
});

it("calls onPrev and onNext when clicking the nav buttons", async () => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const user = userEvent.setup();
  render(
    <Lightbox items={items(3)} index={1} onClose={vi.fn()} onPrev={onPrev} onNext={onNext} />,
  );

  await user.click(screen.getByRole("button", { name: /previous/i }));
  await user.click(screen.getByRole("button", { name: /next/i }));

  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
});

it("falls back to the thumb image when the preview fails to load", () => {
  render(
    <Lightbox items={items(3)} index={0} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  const img = screen.getByRole("img") as HTMLImageElement;
  fireEvent.error(img);

  expect(img.src).toContain("/tmp/thumbs/hash1/400.webp");
});

it("calls onNext when pressing ArrowRight", () => {
  const onNext = vi.fn();
  render(
    <Lightbox items={items(3)} index={0} onClose={vi.fn()} onPrev={vi.fn()} onNext={onNext} />,
  );

  fireEvent.keyDown(window, { key: "ArrowRight" });

  expect(onNext).toHaveBeenCalledTimes(1);
});

it("calls onClose exactly once when clicking CLOSE", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <Lightbox items={items(3)} index={0} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  await user.click(screen.getByRole("button", { name: "CLOSE" }));

  expect(onClose).toHaveBeenCalledTimes(1);
});

it("closes when pressing Escape", async () => {
  const onClose = vi.fn();
  render(
    <Lightbox items={items(3)} index={0} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("closes when clicking the overlay behind the dialog", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <Lightbox items={items(3)} index={0} onClose={onClose} onPrev={vi.fn()} onNext={vi.fn()} />,
  );

  await user.click(screen.getByTestId("lightbox-overlay"));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("moves focus inside the dialog when opened", async () => {
  render(<Lightbox items={items(3)} index={0} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);

  await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
});

it("traps Tab focus within the dialog", async () => {
  const user = userEvent.setup();
  render(<Lightbox items={items(3)} index={0} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);

  const dialog = screen.getByRole("dialog");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

  await user.tab();
  await user.tab();

  expect(dialog.contains(document.activeElement)).toBe(true);
});

it("locks page scroll while open", async () => {
  render(<Lightbox items={items(3)} index={0} onClose={vi.fn()} onPrev={vi.fn()} onNext={vi.fn()} />);

  await waitFor(() => {
    const locked =
      document.body.style.overflow === "hidden" || document.body.style.pointerEvents === "none";
    expect(locked).toBe(true);
  });
});
