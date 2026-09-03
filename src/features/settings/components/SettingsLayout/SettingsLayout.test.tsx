import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { vi } from "vitest";
import { SettingsLayout } from "./SettingsLayout";

vi.mock("../../settings.routes", () => ({
  SETTINGS_ROUTES: [
    { id: "settings-general", title: "General", path: "/settings", Page: () => <div>general page</div> },
    { id: "settings-library", title: "Library", path: "/settings/library", Page: () => <div>library page</div> },
  ],
}));

function buildRouter(pathname: string) {
  const rootRoute = createRootRoute();
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsLayout,
  });
  const generalRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "/",
    component: () => <div>general page</div>,
  });
  const libraryRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "library",
    component: () => <div>library page</div>,
  });
  const tree = rootRoute.addChildren([settingsRoute.addChildren([generalRoute, libraryRoute])]);
  return createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [pathname] }) });
}

it("renders the Settings header and every sub-nav item", async () => {
  render(<RouterProvider router={buildRouter("/settings")} />);
  expect(await screen.findByRole("heading")).toHaveTextContent("SETTINGS");
  expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument();
});

it("marks the active group's sub-nav item with aria-current", async () => {
  render(<RouterProvider router={buildRouter("/settings/library")} />);
  expect(await screen.findByText("library page")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
});

it("renders the default group at the module's own path", async () => {
  render(<RouterProvider router={buildRouter("/settings")} />);
  expect(await screen.findByText("general page")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
});

it("navigates to a sub-page when its sub-nav item is clicked", async () => {
  render(<RouterProvider router={buildRouter("/settings")} />);
  await screen.findByText("general page");

  await userEvent.click(screen.getByRole("link", { name: "Library" }));

  expect(await screen.findByText("library page")).toBeInTheDocument();
});
