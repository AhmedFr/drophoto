import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

/**
 * Renders `element` inside a minimal TanStack Router router backed by an
 * in-memory history. For components that render `<Link>` (or otherwise
 * need router context) but don't need real route matching in their tests.
 */
export function renderWithRouter(element: ReactElement, initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return render(<RouterProvider router={router} />);
}
