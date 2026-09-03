import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { SETTINGS_ROUTES } from "../../settings.routes";

/**
 * Settings' layout host: the page header, a left sub-nav listing each
 * grouped sub-page (General/Library/Maintenance/Danger zone), and the
 * `<Outlet/>` the active group renders into. Mounted once at `/settings`
 * (and every path nested under it) — see `buildFeatureRoutes`, which
 * requires a module with `children` to render its own `<Outlet/>`.
 */
export function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="flex min-h-0 flex-1">
        <nav className="w-[160px] flex-none border-r border-border py-3">
          <ul className="flex flex-col gap-0.5 px-2">
            {SETTINGS_ROUTES.map((r) => {
              // Exact match only — unlike the top-level `Sidebar` (which
              // must keep "Settings" highlighted for every path nested
              // under it), General's own path *is* `/settings`, so a
              // prefix match here would wrongly keep General active while
              // on Library/Maintenance/Danger zone too.
              const active = pathname === r.path;
              return (
                <li key={r.id}>
                  <a
                    href={r.path}
                    aria-current={active ? "page" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate({ to: r.path });
                    }}
                    className={cn(
                      "flex items-center px-3 py-1.5 text-[12px] transition-colors",
                      active
                        ? "bg-surface text-foreground"
                        : "text-muted-foreground hover:bg-surface hover:text-foreground",
                    )}
                  >
                    {r.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
