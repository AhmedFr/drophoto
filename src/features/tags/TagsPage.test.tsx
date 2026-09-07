import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import { useGalleryStore } from "@/features/gallery/store/galleryStore";
import { TagsPage } from "./TagsPage";

/**
 * A real (in-memory) router with both `/tags` and a `/gallery` stub, so
 * `TagsPage`'s "open in gallery" navigation can be exercised end to end
 * rather than just asserted as an intent — same pattern as
 * `router.test.tsx`'s `buildFeatureRoutes` tests.
 */
function renderTagsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const tagsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tags",
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TagsPage />
      </QueryClientProvider>
    ),
  });
  const galleryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/gallery",
    component: () => <div>gallery stub</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([tagsRoute, galleryRoute]),
    history: createMemoryHistory({ initialEntries: ["/tags"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  useGalleryStore.setState({ tagId: null, selectedIds: [], anchorIndex: null });
  useGalleryStore.persist.clearStorage();
});

it("renders the Tags header", async () => {
  mockIPC(() => undefined);
  renderTagsPage();
  expect(await screen.findByRole("heading")).toHaveTextContent("TAGS");
});

describe("TagsPage", () => {
  function mockTagCommands(
    cards = [
      { tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false, cover_taken_at: null },
    ],
  ) {
    mockIPC((cmd) => {
      if (cmd === "list_tags_with_counts") return cards;
      return undefined;
    });
  }

  it("shows an empty state when there are no tags", async () => {
    mockTagCommands([]);
    renderTagsPage();
    expect(await screen.findByText(/No tags yet/)).toBeInTheDocument();
  });

  it("renders every tag as a card with its photo count", async () => {
    mockTagCommands([
      { tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false, cover_taken_at: null },
      { tag: { id: 2, name: "Trip" }, count: 0, thumb_path: null, has_thumb: false, cover_taken_at: null },
    ]);
    renderTagsPage();
    expect(await screen.findByText("Family")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Trip")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("clicking a tag card sets the gallery store's tagId and navigates to /gallery", async () => {
    mockTagCommands();
    const user = userEvent.setup();
    const router = renderTagsPage();

    await user.click(await screen.findByText("Family"));

    expect(useGalleryStore.getState().tagId).toBe(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/gallery"));
    expect(await screen.findByText("gallery stub")).toBeInTheDocument();
  });

  it("renames a tag through the overflow menu's Rename dialog", async () => {
    mockTagCommands();
    let renameArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "list_tags_with_counts") {
        return [{ tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false, cover_taken_at: null }];
      }
      if (cmd === "rename_tag") {
        renameArgs = args;
        return null;
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderTagsPage();

    await user.click(await screen.findByRole("button", { name: "Tag actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByDisplayValue("Family");
    await user.clear(input);
    await user.type(input, "Relatives");
    await user.click(within(dialog).getByRole("button", { name: "RENAME" }));

    await waitFor(() => expect(renameArgs).toEqual({ id: 1, newName: "Relatives" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("merges a tag into another through the overflow menu's Merge dialog", async () => {
    let mergeArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "list_tags_with_counts") {
        return [
          { tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false, cover_taken_at: null },
          { tag: { id: 2, name: "Relatives" }, count: 1, thumb_path: null, has_thumb: false, cover_taken_at: null },
        ];
      }
      if (cmd === "merge_tags") {
        mergeArgs = args;
        return null;
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderTagsPage();

    const overflowButtons = await screen.findAllByRole("button", { name: "Tag actions" });
    await user.click(overflowButtons[0]);
    await user.click(await screen.findByRole("menuitem", { name: "Merge into…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Relatives" }));
    await user.click(within(dialog).getByRole("button", { name: "MERGE" }));

    await waitFor(() => expect(mergeArgs).toEqual({ fromIds: [1], intoId: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes a tag through the overflow menu's Delete dialog, stating the photo count and that files are untouched", async () => {
    let deleteArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "list_tags_with_counts") {
        return [{ tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false, cover_taken_at: null }];
      }
      if (cmd === "delete_tag") {
        deleteArgs = args;
        return null;
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderTagsPage();

    await user.click(await screen.findByRole("button", { name: "Tag actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Removes this tag from 3 photos and queues their sidecars for a rewrite/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Never touches any photo file/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "DELETE" }));

    await waitFor(() => expect(deleteArgs).toEqual({ id: 1 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  /**
   * "Recently updated" is a genuine client-side sort by `cover_taken_at`,
   * not a pass-through of whatever order the server returned (the server
   * always orders by name — see `TagCard`'s doc comment). This fixture is
   * built so RECENT and NAME visibly disagree — proving RECENT is really
   * sorting by recency, not silently rendering the alphabetical order —
   * and also exercises the two edge cases the sort has to get right: a
   * tag with no cover (`cover_taken_at: null`) sorts last regardless of
   * its name, and two tags whose covers share the exact same instant fall
   * back to name order between themselves.
   */
  function mockRecencyFixture() {
    mockIPC((cmd) => {
      if (cmd === "list_tags_with_counts") {
        return [
          // Alphabetically first, but its cover is the oldest — RECENT
          // must not put this first the way NAME does.
          {
            tag: { id: 1, name: "Apple" },
            count: 1,
            thumb_path: null,
            has_thumb: false,
            cover_taken_at: "2020-01-01T00:00:00Z",
          },
          // Same cover instant as Cherry — the name tiebreaker decides
          // which of the two comes first.
          {
            tag: { id: 2, name: "Banana" },
            count: 1,
            thumb_path: null,
            has_thumb: false,
            cover_taken_at: "2022-01-01T00:00:00Z",
          },
          {
            tag: { id: 3, name: "Cherry" },
            count: 1,
            thumb_path: null,
            has_thumb: false,
            cover_taken_at: "2022-01-01T00:00:00Z",
          },
          // No cover at all — must sort last under RECENT despite an
          // alphabetically middling name.
          { tag: { id: 4, name: "Mango" }, count: 0, thumb_path: null, has_thumb: false, cover_taken_at: null },
          // Newest cover — must sort first under RECENT despite being
          // alphabetically last.
          {
            tag: { id: 5, name: "Zebra" },
            count: 1,
            thumb_path: null,
            has_thumb: false,
            cover_taken_at: "2024-01-01T00:00:00Z",
          },
        ];
      }
      return undefined;
    });
  }

  const NAMES = /^(Apple|Banana|Cherry|Mango|Zebra)$/;

  it("defaults to Recently updated: newest cover first, no-cover tags last, same-instant covers tied by name", async () => {
    mockRecencyFixture();
    renderTagsPage();

    await screen.findByText("Zebra");

    expect(screen.getAllByText(NAMES).map((el) => el.textContent)).toEqual([
      "Zebra",
      "Banana",
      "Cherry",
      "Apple",
      "Mango",
    ]);
  });

  it("switches to Name and Count via the sort menu", async () => {
    mockRecencyFixture();
    const user = userEvent.setup();
    renderTagsPage();

    await screen.findByText("Zebra");
    function cardOrder() {
      return screen.getAllByText(NAMES).map((el) => el.textContent);
    }

    await user.click(screen.getByRole("button", { name: /Recently updated/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Name" }));
    await waitFor(() =>
      expect(cardOrder()).toEqual(["Apple", "Banana", "Cherry", "Mango", "Zebra"]),
    );

    await user.click(screen.getByRole("button", { name: /^Name/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Count" }));
    // Every tag here has count 1 except Mango (0) — Count sorts
    // descending, so Mango lands last. `sortCards` always re-sorts from
    // the originally-fetched array (not from whichever sort was active
    // before), so the count-1 tags keep *that* array's relative order —
    // which happens to already be alphabetical in this fixture.
    await waitFor(() =>
      expect(cardOrder()).toEqual(["Apple", "Banana", "Cherry", "Zebra", "Mango"]),
    );
  });
});
