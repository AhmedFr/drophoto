import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlbumCard } from "./AlbumCard";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://mock/${path}`,
}));

const handlers = {
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onMerge: vi.fn(),
  onDelete: vi.fn(),
};

describe("AlbumCard", () => {
  it("shows the cover, name and count, and opens on click", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(
      <AlbumCard
        card={{
          tag: { id: 1, name: "Trip" },
          count: 42,
          thumb_path: "/t/x.webp",
          has_thumb: true,
          cover_taken_at: "2024-01-01T00:00:00Z",
        }}
        {...handlers}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("Trip")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Trip" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /trip/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("falls back to a placeholder when the tag has no cover", () => {
    render(
      <AlbumCard
        card={{ tag: { id: 2, name: "Empty" }, count: 0, thumb_path: null, has_thumb: false, cover_taken_at: null }}
        {...handlers}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("No preview")).toBeInTheDocument();
  });

  it("opens the overflow menu and fires rename/merge/delete without triggering onOpen", async () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const onMerge = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <AlbumCard
        card={{ tag: { id: 3, name: "Beach" }, count: 5, thumb_path: null, has_thumb: false, cover_taken_at: null }}
        onOpen={onOpen}
        onRename={onRename}
        onMerge={onMerge}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Tag actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename…" }));

    expect(onRename).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
