import { Image } from "lucide-react";
import { render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import type { FeatureModule } from "./registry";
import { buildFeatureRoutes, isActiveFeature } from "./router";

describe("isActiveFeature", () => {
  const settings: FeatureModule = {
    id: "settings",
    title: "Settings",
    path: "/settings",
    icon: Image,
    order: 1,
    Page: () => null,
  };

  it("matches the feature's own exact path", () => {
    expect(isActiveFeature(settings, "/settings")).toBe(true);
  });

  it("matches a nested child path", () => {
    expect(isActiveFeature(settings, "/settings/library")).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(isActiveFeature(settings, "/tags")).toBe(false);
  });

  it("does not match a different feature whose path merely starts with the same prefix", () => {
    // e.g. `/settings2` should not be treated as under `/settings`.
    expect(isActiveFeature(settings, "/settings2")).toBe(false);
  });
});

describe("buildFeatureRoutes", () => {
  function GeneralPage() {
    return <div>general content</div>;
  }
  function LibraryPage() {
    return <div>library content</div>;
  }

  const settingsModule: FeatureModule = {
    id: "settings",
    title: "Settings",
    path: "/settings",
    icon: Image,
    order: 1,
    // A module with `children` must render `<Outlet/>` itself — this
    // mirrors `SettingsPage` becoming the "layout host" (sub-nav +
    // `<Outlet/>`) for its own grouped sub-pages.
    Page: () => (
      <div>
        layout
        <Outlet />
      </div>
    ),
    children: [
      { id: "settings-general", title: "General", path: "/settings", Page: GeneralPage },
      { id: "settings-library", title: "Library", path: "/settings/library", Page: LibraryPage },
    ],
  };

  function renderAt(pathname: string) {
    const rootRoute = createRootRoute();
    const routes = buildFeatureRoutes([settingsModule], rootRoute);
    const router = createRouter({
      routeTree: rootRoute.addChildren(routes),
      history: createMemoryHistory({ initialEntries: [pathname] }),
    });
    return render(<RouterProvider router={router} />);
  }

  it("resolves the index child at the module's own path", async () => {
    renderAt("/settings");
    expect(await screen.findByText("general content")).toBeInTheDocument();
  });

  it("resolves a nested child route", async () => {
    renderAt("/settings/library");
    expect(await screen.findByText("library content")).toBeInTheDocument();
  });
});
