import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
  useNavigate,
  type AnyRoute,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { FEATURES } from "./features";
import type { FeatureModule } from "./registry";

/**
 * A feature (or a sub-page's own `FeatureRoute`) is "active" — for sidebar
 * or sub-nav highlighting — at its own exact path or anywhere nested under
 * it. A child path like `/settings/library` must still highlight the
 * Settings sidebar item, not fail to match it. (`SettingsLayout`'s own
 * sub-nav deliberately does NOT use this: a sub-page link should light up
 * only on its own exact path, never on a sibling nested under it.)
 */
export function isActiveFeature(f: { path: string }, pathname: string): boolean {
  return pathname === f.path || pathname.startsWith(`${f.path}/`);
}

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const active = FEATURES.find((f) => isActiveFeature(f, pathname))?.id ?? FEATURES[0].id;
  return (
    <AppShell
      sidebar={<Sidebar items={FEATURES} activeId={active} onNavigate={(to) => navigate({ to })} />}
    >
      <Outlet />
    </AppShell>
  );
}
const rootRoute = createRootRoute({ component: RootLayout });

/**
 * Builds one route branch per feature under `parent`, nesting each
 * module's `children` (if any) as its own child routes. A child's `path`
 * is absolute (matching `FeatureModule.path`'s convention); the index
 * child (whose `path` equals its parent's own `path`) becomes the `"/"`
 * route so it renders at the parent's bare path, and every other child
 * becomes a path segment relative to the parent.
 *
 * Exported so route-building/nesting can be unit-tested directly against
 * synthetic modules, without a real router/IPC setup.
 */
export function buildFeatureRoutes(features: FeatureModule[], parent: AnyRoute) {
  return features.map((f) => {
    const Page = f.Page;
    const route = createRoute({ getParentRoute: () => parent, path: f.path, component: () => <Page /> });
    if (!f.children?.length) return route;
    const children = f.children.map((c) => {
      const ChildPage = c.Page;
      const relativePath = c.path === f.path ? "/" : c.path.slice(f.path.length + 1);
      return createRoute({ getParentRoute: () => route, path: relativePath, component: () => <ChildPage /> });
    });
    return route.addChildren(children);
  });
}

const routes = buildFeatureRoutes(FEATURES, rootRoute);
export const router = createRouter({ routeTree: rootRoute.addChildren(routes) });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
