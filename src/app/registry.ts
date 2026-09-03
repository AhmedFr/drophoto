import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * A sub-page nested under a top-level `FeatureModule`. `path` is the full
 * absolute route path (e.g. `/settings/library`) — for the module's
 * default/index child, `path` equals the parent module's own `path`
 * (there's no separate URL for "the module's landing page").
 */
export type FeatureRoute = {
  id: string;
  title: string;
  path: string;
  Page: ComponentType;
};

export type FeatureModule = {
  id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  order: number;
  Page: ComponentType;
  /** Nested sub-pages (e.g. Settings' grouped sub-nav). Omitted for a flat, single-page feature. */
  children?: FeatureRoute[];
};

export function buildRegistry(modules: FeatureModule[]): FeatureModule[] {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) throw new Error(`duplicate feature id: ${m.id}`);
    if (paths.has(m.path)) throw new Error(`duplicate feature path: ${m.path}`);
    ids.add(m.id);
    paths.add(m.path);
    for (const c of m.children ?? []) {
      if (ids.has(c.id)) throw new Error(`duplicate feature id: ${c.id}`);
      ids.add(c.id);
      // The index child intentionally shares its parent's own path — that's
      // not a collision, it's how "/settings" renders the default group.
      if (c.path === m.path) continue;
      if (paths.has(c.path)) throw new Error(`duplicate feature path: ${c.path}`);
      paths.add(c.path);
    }
  }
  return [...modules].sort((a, b) => a.order - b.order);
}
