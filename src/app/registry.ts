import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type FeatureModule = {
  id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  order: number;
  Page: ComponentType;
};

export function buildRegistry(modules: FeatureModule[]): FeatureModule[] {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) throw new Error(`duplicate feature id: ${m.id}`);
    if (paths.has(m.path)) throw new Error(`duplicate feature path: ${m.path}`);
    ids.add(m.id);
    paths.add(m.path);
  }
  return [...modules].sort((a, b) => a.order - b.order);
}
