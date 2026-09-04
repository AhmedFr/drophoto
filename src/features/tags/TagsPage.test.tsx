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
  function mockTagCommands(tags = [{ tag: { id: 1, name: "Family" }, count: 3 }]) {
    mockIPC((cmd) => {
      if (cmd === "list_tags_with_counts") return tags;
      return undefined;
    });
  }

  it("shows an empty state when there are no tags", async () => {
    mockTagCommands([]);
    renderTagsPage();
    expect(await screen.findByText(/No tags yet/)).toBeInTheDocument();
  });

  it("renders every tag with its photo count", async () => {
    mockTagCommands([
      { tag: { id: 1, name: "Family" }, count: 3 },
      { tag: { id: 2, name: "Trip" }, count: 0 },
    ]);
    renderTagsPage();
    expect(await screen.findByText("Family")).toBeInTheDocument();
    expect(screen.getByText("3 photos")).toBeInTheDocument();
    expect(screen.getByText("Trip")).toBeInTheDocument();
    expect(screen.getByText("0 photos")).toBeInTheDocument();
  });

  it("clicking a tag sets the gallery store's tagId and navigates to /gallery", async () => {
    mockTagCommands();
    const user = userEvent.setup();
    const router = renderTagsPage();

    await user.click(await screen.findByText("Family"));

    expect(useGalleryStore.getState().tagId).toBe(1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/gallery"));
    expect(await screen.findByText("gallery stub")).toBeInTheDocument();
  });

  it("renames a tag through the Rename dialog", async () => {
    mockTagCommands();
    let renameArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "list_tags_with_counts") return [{ tag: { id: 1, name: "Family" }, count: 3 }];
      if (cmd === "rename_tag") {
        renameArgs = args;
        return null;
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderTagsPage();

    await user.click(await screen.findByRole("button", { name: "RENAME" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByDisplayValue("Family");
    await user.clear(input);
    await user.type(input, "Relatives");
    await user.click(within(dialog).getByRole("button", { name: "RENAME" }));

    await waitFor(() => expect(renameArgs).toEqual({ id: 1, newName: "Relatives" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("merges a tag into another through the Merge dialog", async () => {
    let mergeArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "list_tags_with_counts") {
        return [
          { tag: { id: 1, name: "Family" }, count: 3 },
          { tag: { id: 2, name: "Relatives" }, count: 1 },
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

    const rows = await screen.findAllByRole("button", { name: "MERGE INTO…" });
    await user.click(rows[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Relatives" }));
    await user.click(within(dialog).getByRole("button", { name: "MERGE" }));

    await waitFor(() => expect(mergeArgs).toEqual({ fromIds: [1], intoId: 2 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("deletes a tag through the Delete dialog, stating the photo count and that files are untouched", async () => {
    let deleteArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "list_tags_with_counts") return [{ tag: { id: 1, name: "Family" }, count: 3 }];
      if (cmd === "delete_tag") {
        deleteArgs = args;
        return null;
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderTagsPage();

    await user.click(await screen.findByRole("button", { name: "DELETE" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/Removes this tag from 3 photos and queues their sidecars for a rewrite/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Never touches any photo file/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "DELETE" }));

    await waitFor(() => expect(deleteArgs).toEqual({ id: 1 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
