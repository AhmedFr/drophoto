import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { MetaPanel } from "./MetaPanel";

vi.mock("@tauri-apps/plugin-opener");

beforeEach(() => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });
});

function renderPanel(item: MediaItem) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MetaPanel item={item} />
    </QueryClientProvider>,
  );
}

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
      organized_at: null,
      source_id: null,
    },
    thumb_path: "/tmp/thumbs/hash1/400.webp",
    preview_path: "/tmp/thumbs/hash1/2000.webp",
    drive_name: "Kodachrome",
    online: true,
    original_path: "/Volumes/Kodachrome/photos/family/beach.jpg",
    has_thumb: true,
    ...overrides,
  };
}

it("shows the filename and dims/size/ext line", () => {
  renderPanel(item());

  expect(screen.getByText("beach.jpg")).toBeInTheDocument();
  expect(screen.getByText(/4000 × 3000/)).toBeInTheDocument();
  expect(screen.getByText(/JPG/)).toBeInTheDocument();
});

it("shows formatted camera rows", () => {
  renderPanel(item());

  expect(screen.getByText("Sony α7 IV")).toBeInTheDocument();
  expect(screen.getByText("FE 35mm F1.4 GM")).toBeInTheDocument();
  expect(screen.getByText("ƒ/2.0 · 1/800s")).toBeInTheDocument();
  expect(screen.getByText("100 · 35mm")).toBeInTheDocument();
});

it("shows the taken date and drive name", () => {
  renderPanel(item());

  expect(screen.getByText("15 Jun 2024 · 12:30")).toBeInTheDocument();
  expect(screen.getByText("Kodachrome")).toBeInTheDocument();
});

it("shows formatted coordinates when present", () => {
  renderPanel(item());

  expect(screen.getByText("37.77°N 122.42°W")).toBeInTheDocument();
});

it("shows 'No location data' when there are no coordinates", () => {
  renderPanel(item({ row: { ...item().row, lat: null, lon: null } }));

  expect(screen.getByText("No location data")).toBeInTheDocument();
});

it("shows an OFFLINE badge and disables Reveal in Finder when offline", () => {
  renderPanel(item({ online: false }));

  expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeDisabled();
});

it("enables Reveal in Finder when online with an original_path", () => {
  renderPanel(item());

  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeEnabled();
});

it("disables Reveal in Finder when online but there is no original_path", () => {
  renderPanel(item({ online: true, original_path: null }));

  expect(screen.getByRole("button", { name: /reveal in finder/i })).toBeDisabled();
});

it("shows an error message when revealing in Finder fails", async () => {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  vi.mocked(revealItemInDir).mockRejectedValue(new Error("no such file"));
  const user = userEvent.setup();
  renderPanel(item());

  await user.click(screen.getByRole("button", { name: /reveal in finder/i }));

  expect(await screen.findByText("no such file")).toBeInTheDocument();
});

it("shows 'No tags' when the item has none", async () => {
  renderPanel(item());

  expect(await screen.findByText("No tags")).toBeInTheDocument();
});

it("shows the item's tags as chips", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") {
      return [
        { id: 1, name: "Family" },
        { id: 2, name: "Beach" },
      ];
    }
    if (cmd === "tags_for_media") return [[1, { id: 1, name: "Family" }]];
    return undefined;
  });
  renderPanel(item());

  expect(await screen.findByText("Family")).toBeInTheDocument();
  expect(screen.queryByText("Beach")).not.toBeInTheDocument();
  expect(screen.queryByText("No tags")).not.toBeInTheDocument();
});

it("removing a chip applies remove directly, without opening a dialog", async () => {
  let tagMediaArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [[1, { id: 1, name: "Family" }]];
    if (cmd === "tag_media") {
      tagMediaArgs = args;
      return null;
    }
    if (cmd === "start_sidecar_sync_all") return [];
    return undefined;
  });
  const user = userEvent.setup();
  renderPanel(item());

  await user.click(await screen.findByRole("button", { name: /remove family/i }));

  await waitFor(() =>
    expect(tagMediaArgs).toEqual({ mediaIds: [1], add: [], remove: [1] }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("the + button opens the TagPanel for this item", async () => {
  const user = userEvent.setup();
  renderPanel(item());

  await user.click(screen.getByRole("button", { name: /add tag/i }));

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("shows an inline error near the TAGS row when removing a chip fails", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [[1, { id: 1, name: "Family" }]];
    if (cmd === "tag_media") throw new Error("db locked");
    return undefined;
  });
  const user = userEvent.setup();
  renderPanel(item());

  await user.click(await screen.findByRole("button", { name: /remove family/i }));

  expect(await screen.findByText("db locked")).toBeInTheDocument();
});

it("disables the chip remove and + buttons while a tag mutation is in flight", async () => {
  let resolveTagMedia: (() => void) | undefined;
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [[1, { id: 1, name: "Family" }]];
    if (cmd === "tag_media") {
      return new Promise((resolve) => {
        resolveTagMedia = () => resolve(null);
      });
    }
    if (cmd === "start_sidecar_sync_all") return [];
    return undefined;
  });
  const user = userEvent.setup();
  renderPanel(item());

  const removeButton = await screen.findByRole("button", { name: /remove family/i });
  const addButton = screen.getByRole("button", { name: /add tag/i });
  expect(removeButton).toBeEnabled();
  expect(addButton).toBeEnabled();

  await user.click(removeButton);

  await waitFor(() => expect(removeButton).toBeDisabled());
  expect(addButton).toBeDisabled();

  await act(async () => {
    resolveTagMedia?.();
  });

  await waitFor(() => expect(addButton).toBeEnabled());
});

it("notifies the tag panel closed when unmounting (lightbox item change)", async () => {
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <MetaPanel item={item()} onTagPanelOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  unmount();
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});
