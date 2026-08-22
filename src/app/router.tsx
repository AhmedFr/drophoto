import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { FEATURES } from "./features";

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const active = FEATURES.find((f) => f.path === pathname)?.id ?? FEATURES[0].id;
  return (
    <AppShell
      sidebar={<Sidebar items={FEATURES} activeId={active} onNavigate={(to) => navigate({ to })} />}
    >
      <Outlet />
    </AppShell>
  );
}
const rootRoute = createRootRoute({ component: RootLayout });
const routes = FEATURES.map((f) => {
  const Page = f.Page;
  return createRoute({ getParentRoute: () => rootRoute, path: f.path, component: () => <Page /> });
});
export const router = createRouter({ routeTree: rootRoute.addChildren(routes) });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
