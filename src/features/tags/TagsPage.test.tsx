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
    cards = [{ tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false }],
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
      { tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false },
      { tag: { id: 2, name: "Trip" }, count: 0, thumb_path: null, has_thumb: false },
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
        return [{ tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false }];
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
          { tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false },
          { tag: { id: 2, name: "Relatives" }, count: 1, thumb_path: null, has_thumb: false },
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
        return [{ tag: { id: 1, name: "Family" }, count: 3, thumb_path: null, has_thumb: false }];
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

  it("sorts the grid by name and by count via the sort menu", async () => {
    mockIPC((cmd) => {
      if (cmd === "list_tags_with_counts") {
        return [
          { tag: { id: 1, name: "Zebra" }, count: 1, thumb_path: null, has_thumb: false },
          { tag: { id: 2, name: "Apple" }, count: 9, thumb_path: null, has_thumb: false },
        ];
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderTagsPage();

    await screen.findByText("Zebra");

    function cardOrder() {
      return screen.getAllByText(/^(Zebra|Apple)$/).map((el) => el.textContent);
    }

    // Default "Recently updated" keeps the fetched (server) order.
    expect(cardOrder()).toEqual(["Zebra", "Apple"]);

    await user.click(screen.getByRole("button", { name: /Recently updated/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Name" }));
    await waitFor(() => expect(cardOrder()).toEqual(["Apple", "Zebra"]));

    await user.click(screen.getByRole("button", { name: /^Name/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Count" }));
    await waitFor(() => expect(cardOrder()).toEqual(["Apple", "Zebra"]));
  });
});
