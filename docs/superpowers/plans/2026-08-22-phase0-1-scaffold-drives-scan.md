# drophoto Phase 0 + 1 — Scaffold, Drives & Scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Tauri desktop app with the design-system shell, feature registry, CI, and a working "register drive → scan → see thumbnails" vertical slice that survives unplugging the drive.

**Architecture:** Cargo workspace: `src-tauri` (Tauri wiring only) + `crates/dp-*` (one crate per capability trait/impl). Frontend: React 19 + TanStack Router built from a `FeatureModule` registry; components call typed API clients in `src/lib/api/*`, never `invoke` directly. Media decoding is delegated to exiftool / `sips` / ffmpeg / the `image` crate.

**Tech Stack:** Tauri 2, Rust 1.96 (tokio, sqlx/SQLite, blake3, walkdir, image, webp, sysinfo, thiserror, tracing), React 19, TypeScript, Vite, pnpm 11, Tailwind 4, shadcn/ui, TanStack Router + Query, Vitest + Testing Library, Storybook 8, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-drophoto-design.md`

## Global Constraints

- macOS only (dev machine: macOS 26.6, Xcode installed). `sips` comes from macOS.
- Package manager: **pnpm** only. Never npm/yarn.
- Component folder convention: `index.ts`, `Name.tsx`, `Name.types.ts`, optional `Name.constants.ts`, `Name.test.tsx`, `Name.stories.tsx`. Keep files short; split logic into hooks/utils.
- Rust: one crate per capability trait + impls (`crates/dp-<name>`); `src-tauri` only wires commands/events.
- Errors cross the bridge as `{ code: string, message: string, path?: string }`.
- Ingest/scan never modify or delete source files.
- **Always shippable**: every task ends with `pnpm tauri dev` launching a working app.
- Git flow: follow `.claude/skills/git-workflow` (issue → branch `feat/<n>-…` → conventional commits → PR). Each task = one commit minimum; each phase = one PR.
- Coverage thresholds: `.claude/skills/test-coverage` (FE 80/75, `src/lib/**` 90, Rust crates 80).
- Design tokens (from design): bg `#0a0a0a`, surface `#111110`, surface-2 `#141412`, border `#1e1e1c`, border-2 `#242422`, border-3 `#2e2e2a`, fg `#f4f4f2`, fg-muted `#8a8a86`, fg-dim `#6a6a66`, fg-faint `#57574f`, fg-ghost `#4e4e4a`; fonts Outfit (UI) and JetBrains Mono (data); radius `0`.
- Spec deviation (accepted): sqlx queries are runtime-checked (`sqlx::query`) rather than the `query!` macro, to avoid needing `DATABASE_URL`/offline data in CI.

---

## File structure (end state of this plan)

```
Cargo.toml                      # workspace: src-tauri, crates/*
package.json, pnpm-lock.yaml, vite.config.ts, vitest.config.ts, tsconfig.json, tailwind (in CSS), components.json
.github/workflows/ci.yml
fixtures/                       # tiny test media (generated JPG/PNG/HEIC/MP4; optional user RAW)
crates/
  dp-core/        src/lib.rs, error.rs, types.rs        # DpError, MediaKind, Volume, Drive, MediaMetadata, MediaRow
  dp-volumes/     src/lib.rs, sysinfo_volumes.rs        # VolumeProvider trait + SysinfoVolumes
  dp-catalog/     src/lib.rs, sqlite.rs, migrations/    # Catalog trait + SqliteCatalog
  dp-hash/        src/lib.rs                            # Hasher trait + Blake3Hasher
  dp-metadata/    src/lib.rs, exiftool.rs, parse.rs     # MetadataProvider trait + ExiftoolProvider
  dp-thumbs/      src/lib.rs, chain.rs, image_thumb.rs, exiftool_preview.rs, sips_thumb.rs, ffmpeg_thumb.rs, store.rs
  dp-jobs/        src/lib.rs, runner.rs, scan.rs        # Job trait, JobRunner, ScanJob
src-tauri/
  Cargo.toml, tauri.conf.json, capabilities/default.json
  src/main.rs, lib.rs, state.rs, commands/{mod.rs,volumes.rs,drives.rs,scan.rs,media.rs}
src/
  main.tsx, app/{App.tsx,router.tsx,registry.ts,registry.test.ts,features.ts}
  styles/globals.css
  lib/api/{client.ts,volumes.ts,drives.ts,scan.ts,media.ts}  lib/api/*.test.ts
  lib/format/{bytes.ts,bytes.test.ts}
  components/ui/*               # shadcn generated (excluded from coverage)
  components/Sidebar/{index.ts,Sidebar.tsx,Sidebar.types.ts,Sidebar.test.tsx,Sidebar.stories.tsx}
  components/AppShell/{index.ts,AppShell.tsx,AppShell.types.ts,AppShell.test.tsx}
  components/PageHeader/{index.ts,PageHeader.tsx,PageHeader.types.ts,PageHeader.test.tsx}
  features/<dashboard|drives|gallery|organize|search|tags|settings>/{index.ts,module.ts,<Name>Page.tsx,...}
  features/drives/components/VolumeList/*, RegisterDriveDialog/*, DriveCard/*, ScanProgress/*
  features/gallery/components/ThumbGrid/*
  test/setup.ts
```

---

## Phase 0 — Scaffold

### Task 0.1: Issue, branch, Tauri + React scaffold

**Files:**
- Create: everything `create-tauri-app` generates at repo root; `Cargo.toml` (workspace); `.gitignore` additions

**Interfaces:**
- Produces: `pnpm tauri dev` runs; `src-tauri` crate named `drophoto`; root Cargo workspace.

- [ ] **Step 1: Create GitHub issue and branch**

```bash
gh issue create --title "Phase 0: scaffold Tauri + React app shell" --label "phase:0,area:infra,type:feat" --body "Scaffold per docs/superpowers/plans/2026-08-22-phase0-1-scaffold-drives-scan.md"
# note the issue number N
git checkout -b feat/N-scaffold
```
(If labels don't exist yet: `gh label create "phase:0"`, `gh label create "area:infra"`, `gh label create "type:feat"` etc. Create all: `phase:0 phase:1 area:core area:ui area:ingest area:infra type:feat type:fix type:chore type:spike`.)

- [ ] **Step 2: Install missing dev tools**

```bash
brew install exiftool ffmpeg
exiftool -ver && ffmpeg -version | head -1
```

- [ ] **Step 3: Scaffold into a temp dir and copy in**

```bash
cd /private/tmp && rm -rf dp-scaffold && pnpm dlx create-tauri-app@latest dp-scaffold --template react-ts --manager pnpm --yes
rsync -a --exclude .git /private/tmp/dp-scaffold/ /Users/ahmedabouelleil/code/02-personal/drophoto/
cd /Users/ahmedabouelleil/code/02-personal/drophoto && pnpm install
```

- [ ] **Step 4: Make a Cargo workspace**

Create root `Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["src-tauri", "crates/*"]

[workspace.package]
edition = "2021"
version = "0.1.0"

[workspace.dependencies]
thiserror = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
tracing = "0.1"
async-trait = "0.1"
chrono = { version = "0.4", features = ["serde"] }
```
Add to `.gitignore`: `target/`, `fixtures/*.raf`, `fixtures/*.cr3`, `fixtures/*.arw` (user-provided RAWs are not committed).

Set in `src-tauri/Cargo.toml`: `name = "drophoto"`, `edition.workspace = true`, `version.workspace = true`. Set in `src-tauri/tauri.conf.json`: `"productName": "drophoto"`, `"identifier": "com.ahmed.drophoto"`, window `"title": "drophoto"`, `"width": 1280, "height": 820`.

- [ ] **Step 5: Verify it runs**

Run: `pnpm tauri dev`
Expected: a window titled "drophoto" opens with the template page. Close it.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Tauri 2 + React/TS app with cargo workspace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 0.2: Tailwind 4, shadcn, design tokens, fonts, Vitest

**Files:**
- Create: `src/styles/globals.css`, `components.json`, `vitest.config.ts`, `src/test/setup.ts`, `src/lib/format/bytes.ts`, `src/lib/format/bytes.test.ts`
- Modify: `vite.config.ts`, `tsconfig.json`, `package.json`, `src/main.tsx`
- Delete: `src/App.css`, `src/assets/*` template leftovers

**Interfaces:**
- Produces: `cn()` from `src/lib/utils.ts` (shadcn); CSS variables `--background`, `--foreground`, `--surface`, `--surface-2`, `--border`, `--border-2`, `--border-3`, `--muted-foreground`, `--dim`, `--faint`, `--ghost`; Tailwind classes `font-sans` (Outfit), `font-mono` (JetBrains Mono); `formatBytes(n: number): string`.

- [ ] **Step 1: Install deps**

```bash
pnpm add tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react @fontsource-variable/outfit @fontsource-variable/jetbrains-mono
pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/node
```

- [ ] **Step 2: Vite + TS path alias**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
});
```
In `tsconfig.json` `compilerOptions` add: `"baseUrl": ".", "paths": { "@/*": ["./src/*"] }, "types": ["vitest/globals", "@testing-library/jest-dom"]`.

- [ ] **Step 3: Global CSS with tokens**

`src/styles/globals.css`:
```css
@import "tailwindcss";
@import "@fontsource-variable/outfit";
@import "@fontsource-variable/jetbrains-mono";

:root {
  --background: #0a0a0a;
  --foreground: #f4f4f2;
  --surface: #111110;
  --surface-2: #141412;
  --border: #1e1e1c;
  --border-2: #242422;
  --border-3: #2e2e2a;
  --muted-foreground: #8a8a86;
  --dim: #6a6a66;
  --faint: #57574f;
  --ghost: #4e4e4a;
  --primary: #f4f4f2;
  --primary-foreground: #0a0a0a;
  --radius: 0px;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-border: var(--border);
  --color-border-2: var(--border-2);
  --color-border-3: var(--border-3);
  --color-muted-foreground: var(--muted-foreground);
  --color-dim: var(--dim);
  --color-faint: var(--faint);
  --color-ghost: var(--ghost);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --font-sans: "Outfit Variable", sans-serif;
  --font-mono: "JetBrains Mono Variable", monospace;
  --radius-sm: 0px; --radius-md: 0px; --radius-lg: 0px; --radius-xl: 0px;
}

* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; }
body { background: var(--background); color: var(--foreground); font-family: var(--font-sans); overflow: hidden; }
::selection { background: #f4f4f2; color: #0a0a0a; }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-thumb { background: #242422; }
::-webkit-scrollbar-track { background: transparent; }
```
In `src/main.tsx` replace the CSS import with `import "@/styles/globals.css";`. Delete `src/App.css` and `src/assets`.

- [ ] **Step 4: shadcn init + a few components**

```bash
pnpm dlx shadcn@latest init -d
# when prompted / or edit components.json: style "new-york", baseColor "neutral", cssVariables true, css "src/styles/globals.css", aliases "@/components", "@/lib/utils"
pnpm dlx shadcn@latest add button dialog input progress badge tooltip scroll-area separator
```
Verify `src/lib/utils.ts` exports `cn`. If `init` rewrote `globals.css`, re-apply the token block from Step 3 on top (keep shadcn's `@layer base` rules).

- [ ] **Step 5: Vitest config and first unit test (TDD)**

`vitest.config.ts`:
```ts
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/components/ui/**", "src/**/*.stories.tsx", "src/**/*.types.ts", "src/main.tsx", "src/test/**"],
      thresholds: { lines: 80, branches: 75, "src/lib/**": { lines: 90 } },
    },
  },
}));
```
`src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";
afterEach(() => { cleanup(); clearMocks(); });
```
`src/lib/format/bytes.test.ts`:
```ts
import { formatBytes } from "./bytes";
describe("formatBytes", () => {
  it("formats bytes, KB, MB, GB, TB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(17.4 * 1024 ** 2)).toBe("17.4 MB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2 TB");
  });
});
```
Run `pnpm vitest run` → FAIL (module not found). Then `src/lib/format/bytes.ts`:
```ts
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  let i = 0; let v = n;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${UNITS[i]}`;
}
```
Run `pnpm vitest run` → PASS. Add scripts to `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`, `"typecheck": "tsc --noEmit"`, `"lint": "eslint src"`, `"format": "prettier --write ."`.

- [ ] **Step 6: ESLint + Prettier**

```bash
pnpm add -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier eslint-config-prettier
```
`eslint.config.js`:
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
export default tseslint.config(
  { ignores: ["dist", "src-tauri", "target", "src/components/ui"] },
  js.configs.recommended, ...tseslint.configs.recommended, prettier,
  { files: ["**/*.{ts,tsx}"], plugins: { "react-hooks": reactHooks }, rules: { ...reactHooks.configs.recommended.rules } },
);
```
`.prettierrc`: `{ "printWidth": 100, "semi": true, "singleQuote": false }`.

- [ ] **Step 7: Verify app still runs with the new styling**

Replace `src/App.tsx` body with `<div className="h-full grid place-items-center font-mono text-xs tracking-[1.5px] text-muted-foreground">DROPHOTO</div>`. Run `pnpm tauri dev` → black window with the label in JetBrains Mono. Run `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(ui): tailwind 4, shadcn, design tokens, fonts, vitest + eslint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 0.3: Feature registry, router, Sidebar, AppShell, empty pages

**Files:**
- Create: `src/app/registry.ts`, `src/app/registry.test.ts`, `src/app/features.ts`, `src/app/router.tsx`, `src/app/App.tsx`, `src/components/Sidebar/*`, `src/components/AppShell/*`, `src/components/PageHeader/*`, `src/features/{dashboard,drives,gallery,organize,search,tags,settings}/{index.ts,module.ts,<Name>Page.tsx}`
- Modify: `src/main.tsx`; delete `src/App.tsx`

**Interfaces:**
- Produces:
  ```ts
  // src/app/registry.ts
  export type FeatureModule = { id: string; title: string; path: string; icon: LucideIcon; order: number; Page: ComponentType };
  export function buildRegistry(modules: FeatureModule[]): FeatureModule[]; // sorted by order, unique ids/paths, throws on duplicates
  ```
  `src/app/features.ts` exports `FEATURES: FeatureModule[]`. `PageHeader` props: `{ title: string; children?: ReactNode }` (renders mono uppercase title + right slot, 52px, bottom border).

- [ ] **Step 1: Install router + query**

```bash
pnpm add @tanstack/react-router @tanstack/react-query
```

- [ ] **Step 2: Registry test (failing)**

`src/app/registry.test.ts`:
```ts
import { Image } from "lucide-react";
import { buildRegistry, type FeatureModule } from "./registry";
const mk = (id: string, order: number, path = `/${id}`): FeatureModule =>
  ({ id, title: id, path, icon: Image, order, Page: () => null });
describe("buildRegistry", () => {
  it("sorts by order", () => {
    expect(buildRegistry([mk("b", 2), mk("a", 1)]).map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("throws on duplicate id", () => {
    expect(() => buildRegistry([mk("a", 1), mk("a", 2, "/x")])).toThrow(/duplicate feature id/);
  });
  it("throws on duplicate path", () => {
    expect(() => buildRegistry([mk("a", 1, "/p"), mk("b", 2, "/p")])).toThrow(/duplicate feature path/);
  });
});
```
Run `pnpm test` → FAIL.

- [ ] **Step 3: Registry implementation**

`src/app/registry.ts`:
```ts
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

export type FeatureModule = {
  id: string; title: string; path: string; icon: LucideIcon; order: number; Page: ComponentType;
};

export function buildRegistry(modules: FeatureModule[]): FeatureModule[] {
  const ids = new Set<string>(); const paths = new Set<string>();
  for (const m of modules) {
    if (ids.has(m.id)) throw new Error(`duplicate feature id: ${m.id}`);
    if (paths.has(m.path)) throw new Error(`duplicate feature path: ${m.path}`);
    ids.add(m.id); paths.add(m.path);
  }
  return [...modules].sort((a, b) => a.order - b.order);
}
```
Run `pnpm test` → PASS.

- [ ] **Step 4: Seven feature modules (empty pages)**

For each of `dashboard(1, LayoutDashboard, "/")`, `drives(2, HardDrive, "/drives")`, `gallery(3, Image, "/gallery")`, `organize(4, FolderInput, "/organize")`, `search(5, Search, "/search")`, `tags(6, Tag, "/tags")`, `settings(7, Settings, "/settings")` create:

`src/features/gallery/GalleryPage.tsx` (pattern for all):
```tsx
import { PageHeader } from "@/components/PageHeader";
export function GalleryPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery" />
      <div className="flex-1 p-5 font-mono text-[11px] text-faint">Nothing here yet.</div>
    </div>
  );
}
```
`src/features/gallery/module.ts`:
```ts
import { Image } from "lucide-react";
import type { FeatureModule } from "@/app/registry";
import { GalleryPage } from "./GalleryPage";
export const galleryModule: FeatureModule = { id: "gallery", title: "Gallery", path: "/gallery", icon: Image, order: 3, Page: GalleryPage };
```
`src/features/gallery/index.ts`: `export { galleryModule } from "./module";`

`src/app/features.ts`:
```ts
import { buildRegistry } from "./registry";
import { dashboardModule } from "@/features/dashboard";
import { drivesModule } from "@/features/drives";
import { galleryModule } from "@/features/gallery";
import { organizeModule } from "@/features/organize";
import { searchModule } from "@/features/search";
import { tagsModule } from "@/features/tags";
import { settingsModule } from "@/features/settings";
export const FEATURES = buildRegistry([dashboardModule, drivesModule, galleryModule, organizeModule, searchModule, tagsModule, settingsModule]);
```

- [ ] **Step 5: PageHeader, Sidebar, AppShell (test first)**

`src/components/PageHeader/PageHeader.types.ts`: `export type PageHeaderProps = { title: string; children?: React.ReactNode };`
`src/components/PageHeader/PageHeader.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";
it("renders uppercase title and right slot", () => {
  render(<PageHeader title="Gallery"><button>x</button></PageHeader>);
  expect(screen.getByRole("heading")).toHaveTextContent("GALLERY");
  expect(screen.getByRole("button")).toBeInTheDocument();
});
```
`src/components/PageHeader/PageHeader.tsx`:
```tsx
import type { PageHeaderProps } from "./PageHeader.types";
export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className="flex h-[52px] flex-none items-center gap-3.5 border-b border-border px-5">
      <h1 className="font-mono text-[10px] uppercase tracking-[1.5px]">{title}</h1>
      <div className="flex-1" />
      {children}
    </header>
  );
}
```
`src/components/Sidebar/Sidebar.types.ts`:
```ts
import type { FeatureModule } from "@/app/registry";
export type SidebarProps = { items: FeatureModule[]; activeId: string; onNavigate: (path: string) => void };
```
`src/components/Sidebar/Sidebar.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { Image, HardDrive } from "lucide-react";
import { Sidebar } from "./Sidebar";
const items = [
  { id: "drives", title: "Drives", path: "/drives", icon: HardDrive, order: 1, Page: () => null },
  { id: "gallery", title: "Gallery", path: "/gallery", icon: Image, order: 2, Page: () => null },
];
it("marks active item and navigates on click", () => {
  const onNavigate = vi.fn();
  render(<Sidebar items={items} activeId="gallery" onNavigate={onNavigate} />);
  expect(screen.getByRole("link", { name: /gallery/i })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("link", { name: /drives/i }));
  expect(onNavigate).toHaveBeenCalledWith("/drives");
});
```
`src/components/Sidebar/Sidebar.tsx`:
```tsx
import { cn } from "@/lib/utils";
import type { SidebarProps } from "./Sidebar.types";
export function Sidebar({ items, activeId, onNavigate }: SidebarProps) {
  return (
    <nav className="flex h-full w-[212px] flex-none flex-col border-r border-border bg-background">
      <div className="flex h-[52px] items-center px-5 font-mono text-[10px] tracking-[2.5px]">DROPHOTO</div>
      <ul className="flex flex-col gap-0.5 px-2 pt-2">
        {items.map((m) => {
          const active = m.id === activeId; const Icon = m.icon;
          return (
            <li key={m.id}>
              <a href={m.path} aria-current={active ? "page" : undefined}
                onClick={(e) => { e.preventDefault(); onNavigate(m.path); }}
                className={cn("flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
                  active ? "bg-surface text-foreground" : "text-muted-foreground hover:bg-surface hover:text-foreground")}>
                <Icon size={14} strokeWidth={1.6} />{m.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```
`src/components/Sidebar/Sidebar.stories.tsx` (add after Storybook in Task 0.5; create file now with a default export `{ title: "App/Sidebar", component: Sidebar }` and one story `Default` with `args: { items, activeId: "gallery", onNavigate: () => {} }`).

`src/components/AppShell/AppShell.types.ts`: `export type AppShellProps = { sidebar: React.ReactNode; children: React.ReactNode };`
`src/components/AppShell/AppShell.tsx`:
```tsx
import type { AppShellProps } from "./AppShell.types";
export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {sidebar}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
```
`AppShell.test.tsx`: render with `sidebar={<div>S</div>}` and child `<p>C</p>`, assert both in document. Each folder gets `index.ts` re-exporting the component and types.

- [ ] **Step 6: Router built from the registry**

`src/app/router.tsx`:
```tsx
import { createRootRoute, createRoute, createRouter, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Sidebar } from "@/components/Sidebar";
import { FEATURES } from "./features";

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const active = FEATURES.find((f) => f.path === pathname)?.id ?? FEATURES[0].id;
  return (
    <AppShell sidebar={<Sidebar items={FEATURES} activeId={active} onNavigate={(to) => navigate({ to })} />}>
      <Outlet />
    </AppShell>
  );
}
const rootRoute = createRootRoute({ component: RootLayout });
const routes = FEATURES.map((f) => createRoute({ getParentRoute: () => rootRoute, path: f.path, component: f.Page }));
export const router = createRouter({ routeTree: rootRoute.addChildren(routes) });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
```
`src/app/App.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } });
export function App() {
  return <QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>;
}
```
`src/main.tsx` renders `<App />` from `@/app/App`. Delete `src/App.tsx`.

- [ ] **Step 7: Verify**

`pnpm lint && pnpm typecheck && pnpm test` → all pass. `pnpm tauri dev` → sidebar with 7 entries, clicking switches pages and header.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(app): feature registry, router, sidebar and app shell with 7 empty screens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 0.4: `dp-core` + `dp-volumes` crates, `list_volumes` command, Drives page lists volumes

**Files:**
- Create: `crates/dp-core/{Cargo.toml,src/lib.rs,src/error.rs,src/types.rs}`, `crates/dp-volumes/{Cargo.toml,src/lib.rs,src/sysinfo_volumes.rs}`, `src-tauri/src/{lib.rs,state.rs,commands/mod.rs,commands/volumes.rs}`, `src/lib/api/{client.ts,volumes.ts,volumes.test.ts}`, `src/features/drives/components/VolumeList/*`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src/features/drives/DrivesPage.tsx`

**Interfaces:**
- Produces (Rust):
  ```rust
  // dp-core
  #[derive(Debug, thiserror::Error, Serialize)] #[serde(tag="code", rename_all="snake_case")]
  pub enum DpError { Io{message:String, path:Option<String>}, NotFound{message:String}, Sidecar{message:String, tool:String}, Db{message:String}, Unsupported{message:String, path:Option<String>} }
  pub type DpResult<T> = Result<T, DpError>;
  #[derive(Serialize, Deserialize, Clone, Debug, PartialEq)] pub struct Volume { pub name: String, pub mount_path: String, pub total_bytes: u64, pub free_bytes: u64, pub is_removable: bool }
  // dp-volumes
  #[async_trait] pub trait VolumeProvider: Send + Sync { async fn list(&self) -> DpResult<Vec<Volume>>; }
  pub struct SysinfoVolumes; impl VolumeProvider for SysinfoVolumes
  ```
- Produces (TS): `invokeApi<T>(cmd, args?)` wrapper in `src/lib/api/client.ts` throwing `ApiError{code,message,path?}`; `listVolumes(): Promise<Volume[]>`; `Volume` type mirrors Rust.

- [ ] **Step 1: dp-core crate**

`crates/dp-core/Cargo.toml`:
```toml
[package] name = "dp-core"; edition.workspace = true; version.workspace = true
[dependencies] thiserror.workspace = true; serde.workspace = true; chrono.workspace = true
```
(Write as proper TOML tables, one key per line.)

`crates/dp-core/src/error.rs`:
```rust
use serde::Serialize;
#[derive(Debug, thiserror::Error, Serialize, Clone)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum DpError {
    #[error("{message}")] Io { message: String, path: Option<String> },
    #[error("{message}")] NotFound { message: String },
    #[error("{tool}: {message}")] Sidecar { tool: String, message: String },
    #[error("{message}")] Db { message: String },
    #[error("{message}")] Unsupported { message: String, path: Option<String> },
}
pub type DpResult<T> = Result<T, DpError>;
impl DpError {
    pub fn io(e: &std::io::Error, path: impl Into<Option<String>>) -> Self { Self::Io { message: e.to_string(), path: path.into() } }
}
```
`crates/dp-core/src/types.rs`:
```rust
use serde::{Deserialize, Serialize};
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Volume { pub name: String, pub mount_path: String, pub total_bytes: u64, pub free_bytes: u64, pub is_removable: bool }
```
`lib.rs`: `pub mod error; pub mod types; pub use error::*; pub use types::*;`

Test in `error.rs`:
```rust
#[cfg(test)] mod tests { use super::*;
  #[test] fn serializes_with_code_tag() {
    let e = DpError::NotFound { message: "x".into() };
    assert_eq!(serde_json::to_string(&e).unwrap(), r#"{"code":"not_found","message":"x"}"#);
  } }
```
(add `serde_json` as dev-dependency). `cargo test -p dp-core` → PASS.

- [ ] **Step 2: dp-volumes failing test**

`crates/dp-volumes/Cargo.toml` deps: `dp-core = { path = "../dp-core" }`, `sysinfo = "0.33"`, `async-trait`, `tokio`.
`crates/dp-volumes/src/lib.rs`:
```rust
mod sysinfo_volumes;
pub use sysinfo_volumes::SysinfoVolumes;
use dp_core::{DpResult, Volume};
#[async_trait::async_trait]
pub trait VolumeProvider: Send + Sync { async fn list(&self) -> DpResult<Vec<Volume>>; }
#[cfg(test)] mod tests { use super::*;
  #[tokio::test] async fn lists_root_volume() {
    let v = SysinfoVolumes.list().await.unwrap();
    assert!(v.iter().any(|x| x.mount_path == "/"), "expected / in {v:?}");
    assert!(v.iter().all(|x| x.total_bytes >= x.free_bytes));
  } }
```
`cargo test -p dp-volumes` → FAIL (module missing).

- [ ] **Step 3: SysinfoVolumes**

`crates/dp-volumes/src/sysinfo_volumes.rs`:
```rust
use dp_core::{DpResult, Volume};
use sysinfo::Disks;
use crate::VolumeProvider;
pub struct SysinfoVolumes;
#[async_trait::async_trait]
impl VolumeProvider for SysinfoVolumes {
    async fn list(&self) -> DpResult<Vec<Volume>> {
        let disks = tokio::task::spawn_blocking(|| Disks::new_with_refreshed_list()).await
            .map_err(|e| dp_core::DpError::Io { message: e.to_string(), path: None })?;
        let mut out: Vec<Volume> = disks.iter().map(|d| Volume {
            name: d.name().to_string_lossy().to_string(),
            mount_path: d.mount_point().to_string_lossy().to_string(),
            total_bytes: d.total_space(), free_bytes: d.available_space(),
            is_removable: d.is_removable(),
        }).filter(|v| v.mount_path == "/" || v.mount_path.starts_with("/Volumes/")).collect();
        out.sort_by(|a, b| a.mount_path.cmp(&b.mount_path)); out.dedup_by(|a, b| a.mount_path == b.mount_path);
        Ok(out)
    }
}
```
`cargo test -p dp-volumes` → PASS.

- [ ] **Step 4: Tauri state + command**

`src-tauri/Cargo.toml` add deps: `dp-core`, `dp-volumes` (path), `tokio`, `serde`, `serde_json`, `tracing`, `tracing-subscriber = "0.3"`.

`src-tauri/src/state.rs`:
```rust
use std::sync::Arc;
use dp_volumes::{SysinfoVolumes, VolumeProvider};
pub struct AppState { pub volumes: Arc<dyn VolumeProvider> }
impl AppState { pub fn new() -> Self { Self { volumes: Arc::new(SysinfoVolumes) } } }
```
`src-tauri/src/commands/volumes.rs`:
```rust
use dp_core::{DpError, Volume};
use tauri::State;
use crate::state::AppState;
#[tauri::command]
pub async fn list_volumes(state: State<'_, AppState>) -> Result<Vec<Volume>, DpError> { state.volumes.list().await }
```
`commands/mod.rs`: `pub mod volumes;`
`src-tauri/src/lib.rs`:
```rust
mod commands; mod state;
pub fn run() {
    tracing_subscriber::fmt().with_env_filter("info").init();
    tauri::Builder::default()
        .manage(state::AppState::new())
        .invoke_handler(tauri::generate_handler![commands::volumes::list_volumes])
        .run(tauri::generate_context!()).expect("error while running tauri application");
}
```
`main.rs`: `fn main() { drophoto_lib::run(); }` (match the lib name create-tauri-app produced; rename to `drophoto_lib` in `[lib] name` if needed).

- [ ] **Step 5: TS API client (test first)**

`src/lib/api/client.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
export type ApiErrorShape = { code: string; message: string; path?: string | null };
export class ApiError extends Error { code: string; path?: string | null;
  constructor(e: ApiErrorShape) { super(e.message); this.code = e.code; this.path = e.path; } }
export async function invokeApi<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(cmd, args); }
  catch (e) { if (e && typeof e === "object" && "code" in e) throw new ApiError(e as ApiErrorShape); throw e; }
}
```
`src/lib/api/volumes.ts`:
```ts
import { invokeApi } from "./client";
export type Volume = { name: string; mount_path: string; total_bytes: number; free_bytes: number; is_removable: boolean };
export const listVolumes = () => invokeApi<Volume[]>("list_volumes");
```
`src/lib/api/volumes.test.ts`:
```ts
import { mockIPC } from "@tauri-apps/api/mocks";
import { listVolumes } from "./volumes";
import { ApiError } from "./client";
it("returns volumes from the backend", async () => {
  mockIPC((cmd) => cmd === "list_volumes" ? [{ name: "Kodachrome", mount_path: "/Volumes/Kodachrome", total_bytes: 10, free_bytes: 5, is_removable: true }] : undefined);
  await expect(listVolumes()).resolves.toHaveLength(1);
});
it("wraps structured errors", async () => {
  mockIPC(() => { throw { code: "io", message: "boom" }; });
  await expect(listVolumes()).rejects.toBeInstanceOf(ApiError);
});
```
`pnpm test` → PASS.

- [ ] **Step 6: VolumeList component + Drives page**

`src/features/drives/components/VolumeList/VolumeList.types.ts`: `export type VolumeListProps = { volumes: Volume[]; onRegister?: (v: Volume) => void };`
`VolumeList.test.tsx`: render two volumes, assert names and `formatBytes(free)` text appear.
`VolumeList.tsx`:
```tsx
import { formatBytes } from "@/lib/format/bytes";
import { Button } from "@/components/ui/button";
import type { VolumeListProps } from "./VolumeList.types";
export function VolumeList({ volumes, onRegister }: VolumeListProps) {
  return (
    <ul className="flex flex-col">
      {volumes.map((v) => (
        <li key={v.mount_path} className="flex items-center gap-4 border-b border-border px-5 py-3">
          <span className="text-[14px] font-medium">{v.name || v.mount_path}</span>
          <span className="font-mono text-[10px] text-dim">{v.mount_path}</span>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-muted-foreground">{formatBytes(v.free_bytes)} free / {formatBytes(v.total_bytes)}</span>
          {onRegister && <Button size="sm" variant="outline" onClick={() => onRegister(v)}>Register</Button>}
        </li>
      ))}
    </ul>
  );
}
```
`DrivesPage.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { listVolumes } from "@/lib/api/volumes";
import { VolumeList } from "./components/VolumeList";
export function DrivesPage() {
  const volumes = useQuery({ queryKey: ["volumes"], queryFn: listVolumes, refetchInterval: 5_000 });
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Drives" />
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-2 font-mono text-[9px] tracking-[2.5px] text-faint">MOUNTED VOLUMES</div>
        {volumes.isError && <p className="px-5 font-mono text-[11px] text-red-400">{(volumes.error as Error).message}</p>}
        <VolumeList volumes={volumes.data ?? []} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify — Phase 0 exit criterion**

`cargo test --workspace && pnpm lint && pnpm typecheck && pnpm test`. `pnpm tauri dev` → Drives shows `/` and any `/Volumes/*`; plug/unplug a USB drive → list updates within 5s.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(drives): dp-core + dp-volumes crates, list_volumes command, Drives page lists mounted volumes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 0.5: Storybook + CI + PR

**Files:**
- Create: `.storybook/main.ts`, `.storybook/preview.ts`, `.github/workflows/ci.yml`, `rustfmt.toml`, `clippy.toml`
- Modify: `package.json` scripts, `src/components/Sidebar/Sidebar.stories.tsx`

- [ ] **Step 1: Storybook**

```bash
pnpm dlx storybook@latest init --type react --builder vite --no-dev
```
`.storybook/preview.ts`: `import "../src/styles/globals.css";` and `export const parameters = { backgrounds: { default: "dark", values: [{ name: "dark", value: "#0a0a0a" }] } };`. Ensure `Sidebar.stories.tsx` renders: `pnpm storybook --ci --smoke-test`.

- [ ] **Step 2: Rust lint config**

`rustfmt.toml`: `max_width = 110`. Run `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings` and fix anything.

- [ ] **Step 3: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: { pull_request: {}, push: { branches: [main] } }
jobs:
  check:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with: { components: "rustfmt, clippy" }
      - uses: Swatinem/rust-cache@v2
      - run: brew install exiftool ffmpeg
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - run: cargo fmt --all --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo test --workspace
      - run: pnpm tauri build --debug --no-bundle
```

- [ ] **Step 4: Commit, push, PR**

```bash
git add -A && git commit -m "chore(ci): storybook, rust lint config, GitHub Actions pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --fill --body "Closes #N

Phase 0: scaffold, design tokens, registry/router/shell, dp-core + dp-volumes, Drives page lists volumes, CI.

Test plan: CI green; \`pnpm tauri dev\` shows sidebar + mounted volumes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
Wait for CI green, then squash-merge: `gh pr merge --squash --delete-branch`.

---

## Phase 1 — Drives & Scan

Create issue "Phase 1: drives catalog + scan + thumbnails", branch `feat/M-drives-scan` from updated `main`.

### Task 1.1: Thumbnail spike (throwaway) on real formats

**Files:**
- Create: `fixtures/README.md`, `fixtures/gen.sh`, `crates/dp-thumbs/examples/spike.rs` (deleted at end of task)

**Purpose:** prove each format path before building on it. Output = findings in the issue, not code.

- [ ] **Step 1: Generate fixtures**

`fixtures/gen.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -frames:v 1 sample.png
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -frames:v 1 -q:v 3 sample.jpg
exiftool -overwrite_original -DateTimeOriginal="2025:09:12 14:03:21" -Model="Sony ILCE-7M4" -LensModel="FE 35mm F1.4 GM" -FNumber=2.0 -ExposureTime=1/800 -ISO=100 -FocalLength=35 -GPSLatitude=38.71 -GPSLatitudeRef=N -GPSLongitude=9.13 -GPSLongitudeRef=W sample.jpg
sips -s format heic sample.jpg --out sample.heic >/dev/null
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -t 2 -pix_fmt yuv420p sample.mp4
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -t 2 -c:v prores sample.mov
echo "Generated. Optionally drop a real RAW as fixtures/sample.raf (gitignored)."
```
`chmod +x fixtures/gen.sh && ./fixtures/gen.sh`. `fixtures/README.md` explains the above and that `sample.raf`/`.cr3`/`.arw` are optional, user-supplied, gitignored.

- [ ] **Step 2: Spike commands (manual)**

Run and record output/timing for each:
```bash
exiftool -json -n fixtures/sample.jpg fixtures/sample.heic fixtures/sample.mp4 fixtures/sample.mov
sips -s format jpeg fixtures/sample.heic --out /tmp/heic.jpg && ls -la /tmp/heic.jpg
ffmpeg -y -ss 0.5 -i fixtures/sample.mp4 -frames:v 1 -vf scale=400:-1 /tmp/vid.jpg
ffprobe -v error -show_entries format=duration -of csv=p=0 fixtures/sample.mov
# if a RAW is present:
exiftool -b -PreviewImage fixtures/sample.raf > /tmp/raw_preview.jpg && sips -g pixelWidth /tmp/raw_preview.jpg
```
- [ ] **Step 3: Record findings** in the Phase 1 issue: which exiftool keys exist per format (`DateTimeOriginal` vs `CreateDate` for video; `ImageWidth/ImageHeight`; `Duration`; `GPSLatitude` signed with `-n`), whether the RAW preview is full-size, timings. Decide: keep the chain order `image → exiftool-preview → sips → ffmpeg` unless findings say otherwise.

- [ ] **Step 4: Commit fixtures only**

```bash
git add fixtures/ .gitignore && git commit -m "chore(fixtures): generated test media + gen script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1.2: `dp-catalog` — SQLite, migrations, drives CRUD; `register_drive` / `list_drives`; Drives UI registers a volume

**Files:**
- Create: `crates/dp-catalog/{Cargo.toml,src/lib.rs,src/sqlite.rs,src/drives.rs,migrations/0001_init.sql}`, `src-tauri/src/commands/drives.rs`, `src/lib/api/drives.ts`, `src/lib/api/drives.test.ts`, `src/features/drives/components/RegisterDriveDialog/*`, `src/features/drives/components/DriveCard/*`
- Modify: `crates/dp-core/src/types.rs`, `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src/features/drives/DrivesPage.tsx`

**Interfaces:**
- Produces (Rust):
  ```rust
  // dp-core
  pub enum DriveRole { Source, Archive }   // serde rename_all = "snake_case"
  pub struct Drive { pub id: i64, pub name: String, pub volume_uuid: Option<String>, pub mount_path: Option<String>, pub role: DriveRole, pub capacity: u64, pub free: u64, pub last_seen_at: Option<DateTime<Utc>>, pub online: bool }
  pub struct NewDrive { pub name: String, pub mount_path: String, pub role: DriveRole, pub capacity: u64, pub free: u64 }
  pub enum MediaKind { Photo, Video }
  pub struct MediaRow { pub id: i64, pub drive_id: i64, pub rel_path: String, pub hash: String, pub size: u64, pub kind: MediaKind, pub ext: String, pub width: Option<u32>, pub height: Option<u32>, pub duration_ms: Option<u64>, pub taken_at: Option<DateTime<Utc>>, pub camera: Option<String>, pub lens: Option<String>, pub aperture: Option<f64>, pub shutter: Option<f64>, pub iso: Option<u32>, pub focal_mm: Option<f64>, pub lat: Option<f64>, pub lon: Option<f64>, pub missing_at: Option<DateTime<Utc>> }
  pub struct NewMedia { /* same fields minus id, missing_at */ }
  // dp-catalog
  #[async_trait] pub trait Catalog: Send + Sync {
    async fn register_drive(&self, d: NewDrive) -> DpResult<Drive>;
    async fn list_drives(&self) -> DpResult<Vec<Drive>>;
    async fn set_drive_presence(&self, id: i64, mount_path: Option<&str>, free: Option<u64>) -> DpResult<()>;
    async fn upsert_media(&self, m: NewMedia) -> DpResult<i64>;
    async fn list_media(&self, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>>;
    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64>;
    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool>;
    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()>;
  }
  pub struct SqliteCatalog; impl SqliteCatalog { pub async fn open(path: &Path) -> DpResult<Self>; pub async fn open_in_memory() -> DpResult<Self>; }
  ```
  `online` is derived: `mount_path IS NOT NULL`.
- Produces (TS): `Drive`, `DriveRole`, `registerDrive(input: {name, mount_path, role, capacity, free}): Promise<Drive>`, `listDrives(): Promise<Drive[]>`.

- [ ] **Step 1: Types in dp-core** — add the structs above to `types.rs` with `Serialize, Deserialize, Clone, Debug, PartialEq`; `MediaKind`/`DriveRole` with `#[serde(rename_all = "snake_case")]` and `impl MediaKind { pub fn from_ext(ext: &str) -> Option<(MediaKind, &'static str)> }` mapping: photos `jpg jpeg png tif tiff webp heic heif raf cr2 cr3 arw nef dng orf rw2`, videos `mp4 mov m4v`. Unit test: `from_ext("HEIC")` → `Some((Photo,"heic"))`, `from_ext("txt")` → `None`.

- [ ] **Step 2: Migration**

`crates/dp-catalog/migrations/0001_init.sql`:
```sql
CREATE TABLE drives (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, volume_uuid TEXT, mount_path TEXT,
  role TEXT NOT NULL CHECK(role IN ('source','archive')), capacity INTEGER NOT NULL DEFAULT 0,
  free INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('photo','video')),
  ext TEXT NOT NULL, width INTEGER, height INTEGER, duration_ms INTEGER, taken_at TEXT,
  camera TEXT, lens TEXT, aperture REAL, shutter REAL, iso INTEGER, focal_mm REAL, lat REAL, lon REAL, place_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), missing_at TEXT,
  UNIQUE(drive_id, rel_path)
);
CREATE INDEX media_hash ON media(hash);
CREATE INDEX media_taken_at ON media(taken_at DESC);
CREATE TABLE scan_errors (id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL, path TEXT NOT NULL, code TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

- [ ] **Step 3: Failing catalog tests**

`crates/dp-catalog/Cargo.toml` deps: `dp-core`, `sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "migrate", "chrono"] }`, `async-trait`, `tokio`, `chrono`, `tracing`.
`crates/dp-catalog/src/lib.rs` declares the trait (above) and `mod sqlite; mod drives; mod media; pub use sqlite::SqliteCatalog;`.
Tests in `crates/dp-catalog/tests/drives.rs`:
```rust
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, NewDrive};
fn nd(name: &str) -> NewDrive { NewDrive { name: name.into(), mount_path: format!("/Volumes/{name}"), role: DriveRole::Archive, capacity: 100, free: 40 } }
#[tokio::test] async fn register_and_list() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("Kodachrome")).await.unwrap();
    assert_eq!(d.name, "Kodachrome"); assert!(d.online);
    assert_eq!(c.list_drives().await.unwrap().len(), 1);
}
#[tokio::test] async fn duplicate_name_is_db_error() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    c.register_drive(nd("A")).await.unwrap();
    assert!(matches!(c.register_drive(nd("A")).await, Err(dp_core::DpError::Db { .. })));
}
#[tokio::test] async fn presence_toggles_online() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("A")).await.unwrap();
    c.set_drive_presence(d.id, None, None).await.unwrap();
    assert!(!c.list_drives().await.unwrap()[0].online);
}
```
`cargo test -p dp-catalog` → FAIL.

- [ ] **Step 4: SqliteCatalog + drives impl**

`src/sqlite.rs`:
```rust
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool};
use std::{path::Path, str::FromStr};
use dp_core::{DpError, DpResult};
pub struct SqliteCatalog { pub(crate) pool: SqlitePool }
impl SqliteCatalog {
    pub async fn open(path: &Path) -> DpResult<Self> {
        let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display())).map_err(db)?
            .create_if_missing(true).foreign_keys(true).journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
        Self::from_opts(opts).await
    }
    pub async fn open_in_memory() -> DpResult<Self> {
        Self::from_opts(SqliteConnectOptions::from_str("sqlite::memory:").map_err(db)?.foreign_keys(true)).await
    }
    async fn from_opts(opts: SqliteConnectOptions) -> DpResult<Self> {
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await.map_err(db)?;
        sqlx::migrate!("./migrations").run(&pool).await.map_err(|e| DpError::Db { message: e.to_string() })?;
        Ok(Self { pool })
    }
}
pub(crate) fn db(e: impl std::fmt::Display) -> DpError { DpError::Db { message: e.to_string() } }
```
`src/drives.rs` implements the drive methods of `Catalog` for `SqliteCatalog` with `sqlx::query(...)` + `sqlx::Row` mapping (`online: row.get::<Option<String>,_>("mount_path").is_some()`), `register_drive` inserting with `last_seen_at = datetime('now')` then re-selecting by id. Put the `#[async_trait] impl Catalog for SqliteCatalog` in `lib.rs` delegating to `drives::*` and `media::*` free functions (media ones return `DpError::Unsupported` stubs only until Task 1.5 — but since the trait must compile now, implement `upsert_media`, `list_media`, `count_media`, `media_hash_exists`, `record_scan_error` fully here; they are small). Tests for media in `tests/media.rs`: upsert twice same `(drive_id, rel_path)` → one row with updated hash; `media_hash_exists` true/false; `count_media(Some(id))`.
`cargo test -p dp-catalog` → PASS.

- [ ] **Step 5: Wire into Tauri**

`state.rs`: add `pub catalog: Arc<dyn Catalog>`; `AppState::init(app: &tauri::AppHandle) -> DpResult<Self>` opening `app.path().app_data_dir()?.join("catalog.db")` (create dir). In `lib.rs` use `.setup(|app| { let st = tauri::async_runtime::block_on(AppState::init(app.handle()))?; app.manage(st); Ok(()) })`.
`commands/drives.rs`:
```rust
#[tauri::command] pub async fn register_drive(state: State<'_, AppState>, input: NewDrive) -> Result<Drive, DpError> { state.catalog.register_drive(input).await }
#[tauri::command] pub async fn list_drives(state: State<'_, AppState>) -> Result<Vec<Drive>, DpError> { state.catalog.list_drives().await }
```
Register both in `generate_handler!`.

- [ ] **Step 6: TS client + UI**

`src/lib/api/drives.ts`: types + `registerDrive`, `listDrives` (test with `mockIPC` like volumes).
`RegisterDriveDialog` (shadcn `Dialog` + `Input` + role toggle via two `Button`s): props `{ volume: Volume | null; onClose(): void; onSubmit(input: RegisterDriveInput): void }`; default name = volume name; test: typing a name and submitting calls `onSubmit` with `{ name, mount_path, role: "archive", capacity, free }`.
`DriveCard`: props `{ drive: Drive }`; shows name, role badge, online/offline badge (`Badge` variant `outline`, text `ONLINE`/`OFFLINE`), `formatBytes(free)`; test asserts OFFLINE when `online=false`.
`DrivesPage`: queries `["drives"]` + `["volumes"]`; section "REGISTERED DRIVES" with `DriveCard`s; section "MOUNTED VOLUMES" with `VolumeList onRegister={setPending}` hiding volumes whose `mount_path` matches a registered drive; `useMutation(registerDrive)` invalidating `["drives"]`.

- [ ] **Step 7: Verify** — `cargo test --workspace && pnpm test && pnpm lint && pnpm typecheck`; `pnpm tauri dev`: register a volume as "Kodachrome", restart app → still listed. Commit:

```bash
git add -A && git commit -m "feat(catalog): sqlite catalog with drives, register/list drive commands and UI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1.3: `dp-hash` (blake3) and `dp-metadata` (exiftool)

**Files:**
- Create: `crates/dp-hash/{Cargo.toml,src/lib.rs}`, `crates/dp-metadata/{Cargo.toml,src/lib.rs,src/exiftool.rs,src/parse.rs,tests/exiftool.rs}`
- Modify: `crates/dp-core/src/types.rs`

**Interfaces:**
- Produces:
  ```rust
  // dp-hash
  #[async_trait] pub trait Hasher: Send + Sync { async fn hash_file(&self, path: &Path) -> DpResult<String>; } // lowercase hex
  pub struct Blake3Hasher;
  // dp-core
  pub struct MediaMetadata { pub width: Option<u32>, pub height: Option<u32>, pub duration_ms: Option<u64>, pub taken_at: Option<DateTime<Utc>>, pub camera: Option<String>, pub lens: Option<String>, pub aperture: Option<f64>, pub shutter: Option<f64>, pub iso: Option<u32>, pub focal_mm: Option<f64>, pub lat: Option<f64>, pub lon: Option<f64> }
  // dp-metadata
  #[async_trait] pub trait MetadataProvider: Send + Sync { async fn read(&self, path: &Path) -> DpResult<MediaMetadata>; }
  pub struct ExiftoolProvider { bin: PathBuf }  impl ExiftoolProvider { pub fn new(bin: impl Into<PathBuf>) -> Self; pub fn from_path() -> Self /* "exiftool" */ }
  pub fn parse_exiftool_json(json: &str) -> DpResult<MediaMetadata>; // in parse.rs, pure
  ```

- [ ] **Step 1: dp-hash (test first)** — test: write `b"hello"` to a temp file (`tempfile` dev-dep), expect `Blake3Hasher.hash_file` == `blake3::hash(b"hello").to_hex()`. Impl: `spawn_blocking`, `blake3::Hasher::new()`, read in 1 MiB chunks via `std::io::Read`, `update`, return hex. Deps: `blake3 = "1"`, `tokio`, `async-trait`, `dp-core`.

- [ ] **Step 2: parse.rs (pure, test first)**

Test with a literal JSON string (what exiftool `-json -n` emits for the generated `sample.jpg`):
```rust
#[test] fn parses_photo() {
  let j = r#"[{"SourceFile":"x.jpg","ImageWidth":640,"ImageHeight":480,"DateTimeOriginal":"2025:09:12 14:03:21","Model":"Sony ILCE-7M4","LensModel":"FE 35mm F1.4 GM","FNumber":2.0,"ExposureTime":0.00125,"ISO":100,"FocalLength":35,"GPSLatitude":38.71,"GPSLongitude":-9.13}]"#;
  let m = parse_exiftool_json(j).unwrap();
  assert_eq!(m.width, Some(640)); assert_eq!(m.camera.as_deref(), Some("Sony ILCE-7M4"));
  assert_eq!(m.taken_at.unwrap().to_rfc3339(), "2025-09-12T14:03:21+00:00");
  assert_eq!(m.lon, Some(-9.13)); assert_eq!(m.shutter, Some(0.00125));
}
#[test] fn parses_video_duration_and_createdate() {
  let j = r#"[{"SourceFile":"x.mp4","ImageWidth":640,"ImageHeight":480,"Duration":2.0,"CreateDate":"2025:01:02 03:04:05"}]"#;
  let m = parse_exiftool_json(j).unwrap();
  assert_eq!(m.duration_ms, Some(2000)); assert!(m.taken_at.is_some());
}
#[test] fn empty_array_is_not_found() { assert!(parse_exiftool_json("[]").is_err()); }
```
Impl: `serde_json::Value`, helpers `num(v,"Key")->Option<f64>`, `s(v,"Key")->Option<String>`, date parse of `"%Y:%m:%d %H:%M:%S"` (strip trailing subsec/offset with `split_once('.')`/`split_once('+')`, also accept `"%Y:%m:%d %H:%M:%S%:z"`), `taken_at = DateTimeOriginal || CreateDate || MediaCreateDate`. Treat exiftool's `"0000:00:00 00:00:00"` as `None`.

- [ ] **Step 3: ExiftoolProvider (integration test over fixtures)**

`tests/exiftool.rs`: skip with `eprintln!("skipping: exiftool not installed")` if `which::which("exiftool")` fails (dev-dep `which = "7"`); read `fixtures/sample.jpg` (path via `env!("CARGO_MANIFEST_DIR")/../../fixtures`), assert camera & gps; read `sample.mp4`, assert `duration_ms == Some(2000)`; read `sample.heic`, assert width 640.
Impl `exiftool.rs`: `tokio::process::Command::new(&self.bin).args(["-json","-n","-fast2","-DateTimeOriginal","-CreateDate","-MediaCreateDate","-Model","-LensModel","-FNumber","-ExposureTime","-ISO","-FocalLength","-ImageWidth","-ImageHeight","-GPSLatitude","-GPSLongitude","-Duration"]).arg(path)`; non-zero status or spawn error → `DpError::Sidecar{tool:"exiftool", message}` (spawn `NotFound` → message "exiftool not found on PATH"); parse stdout. (Batch `-stay_open` mode is a later optimisation; per-file spawn is fine for v1 scanning.)

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(core): blake3 hasher and exiftool metadata provider

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1.4: `dp-thumbs` — provider chain + WebP store

**Files:**
- Create: `crates/dp-thumbs/{Cargo.toml,src/lib.rs,src/chain.rs,src/image_thumb.rs,src/exiftool_preview.rs,src/sips_thumb.rs,src/ffmpeg_thumb.rs,src/store.rs,tests/chain.rs}`

**Interfaces:**
- Produces:
  ```rust
  #[async_trait] pub trait ThumbnailProvider: Send + Sync {
      fn supports(&self, ext: &str) -> bool;                       // ext lowercase, no dot
      async fn render(&self, path: &Path, max_px: u32) -> DpResult<image::RgbImage>;
  }
  pub struct ImageCrateThumb; pub struct ExiftoolPreviewThumb{bin}; pub struct SipsThumb; pub struct FfmpegThumb{bin}
  pub struct ThumbChain(Vec<Arc<dyn ThumbnailProvider>>); impl ThumbChain { pub fn default_chain() -> Self; pub async fn render(&self, path, ext, max_px) -> DpResult<RgbImage> } // first supporting provider; Unsupported if none
  pub struct ThumbStore { root: PathBuf }  // root/<hash>/400.webp, root/<hash>/2000.webp
  impl ThumbStore { pub fn new(root) -> Self; pub fn path(&self, hash:&str, size:u32) -> PathBuf; pub fn exists(&self, hash, size) -> bool;
                    pub async fn write(&self, hash:&str, size:u32, img:&RgbImage) -> DpResult<PathBuf> } // lossy WebP q=82
  pub const THUMB_SIZES: [u32; 2] = [400, 2000];
  ```

- [ ] **Step 1: Deps** — `image = { version = "0.25", default-features = false, features = ["jpeg","png","tiff","webp"] }`, `webp = "0.3"`, `tokio`, `async-trait`, `dp-core`, `tempfile`(dev), `which`(dev).

- [ ] **Step 2: Tests (fixtures)**

`tests/chain.rs`:
```rust
use dp_thumbs::{ThumbChain, ThumbStore, THUMB_SIZES};
fn fx(n: &str) -> std::path::PathBuf { std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(n) }
fn tool(n: &str) -> bool { which::which(n).is_ok() }
#[tokio::test] async fn jpg_and_png_resize_to_max_edge() {
    let c = ThumbChain::default_chain();
    for (f, e) in [("sample.jpg","jpg"),("sample.png","png")] {
        let img = c.render(&fx(f), e, 400).await.unwrap();
        assert_eq!(img.width().max(img.height()), 400);
    }
}
#[tokio::test] async fn heic_via_sips() { let img = ThumbChain::default_chain().render(&fx("sample.heic"), "heic", 400).await.unwrap(); assert_eq!(img.width(), 400); }
#[tokio::test] async fn video_via_ffmpeg() { if !tool("ffmpeg") { return; } let img = ThumbChain::default_chain().render(&fx("sample.mp4"), "mp4", 400).await.unwrap(); assert_eq!(img.width(), 400); }
#[tokio::test] async fn raw_via_exiftool_preview_if_present() {
    let p = fx("sample.raf"); if !p.exists() || !tool("exiftool") { return; }
    let img = ThumbChain::default_chain().render(&p, "raf", 2000).await.unwrap(); assert!(img.width() >= 1000);
}
#[tokio::test] async fn unsupported_ext_errors() { assert!(ThumbChain::default_chain().render(&fx("sample.jpg"), "txt", 400).await.is_err()); }
#[tokio::test] async fn store_writes_webp_under_hash() {
    let dir = tempfile::tempdir().unwrap(); let st = ThumbStore::new(dir.path());
    let img = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 10, 10]));
    let p = st.write("abc", THUMB_SIZES[0], &img).await.unwrap();
    assert!(p.ends_with("abc/400.webp") && p.exists() && st.exists("abc", 400));
}
```

- [ ] **Step 3: Implementations**

- `image_thumb.rs`: supports `jpg jpeg png tif tiff webp`; `spawn_blocking(image::open(path))` → `to_rgb8()` → `resize_fit(img, max_px)` shared helper in `lib.rs` (`image::imageops::resize` with `FilterType::Triangle`, keeping aspect so the longest edge = `max_px`, never upscales beyond source).
- `exiftool_preview.rs`: supports `raf cr2 cr3 arw nef dng orf rw2`; run `exiftool -b -PreviewImage path`; if stdout empty try `-JpgFromRaw`, then `-ThumbnailImage`; `image::load_from_memory` → resize.
- `sips_thumb.rs`: supports `heic heif`; `sips -s format jpeg -Z <max_px> <path> --out <tmpfile.jpg>` (tempfile), load, resize.
- `ffmpeg_thumb.rs`: supports `mp4 mov m4v`; `ffmpeg -y -loglevel error -ss 0.5 -i <path> -frames:v 1 -vf scale='min(<max_px>,iw)':-2 -f image2 <tmp.jpg>`; load. (Fallback `-ss 0` if the first attempt produces no file — short clips.)
- `chain.rs`: `default_chain()` = `[ImageCrateThumb, ExiftoolPreviewThumb::from_path(), SipsThumb, FfmpegThumb::from_path()]`.
- `store.rs`: `write` → `webp::Encoder::from_rgb(&img, w, h).encode(82.0)` → `tokio::fs::create_dir_all` + `write`.
- All sidecar failures → `DpError::Sidecar { tool, message }` including stderr.

`cargo test -p dp-thumbs` → PASS. Commit:
```bash
git add -A && git commit -m "feat(thumbs): thumbnail provider chain (image/exiftool/sips/ffmpeg) and webp store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1.5: `dp-jobs` — Job trait, runner, ScanJob with progress

**Files:**
- Create: `crates/dp-jobs/{Cargo.toml,src/lib.rs,src/runner.rs,src/scan.rs,tests/scan.rs}`

**Interfaces:**
- Produces:
  ```rust
  #[derive(Serialize, Clone, Debug)] #[serde(rename_all="snake_case", tag="kind")]
  pub enum JobEvent { Started{job_id:String}, Progress{job_id:String, done:u64, total:u64, current:Option<String>}, ItemError{job_id:String, path:String, code:String, message:String}, Finished{job_id:String, ok:u64, failed:u64, skipped:u64}, Cancelled{job_id:String} }
  #[async_trait] pub trait Job: Send + Sync { fn id(&self) -> &str; async fn run(&self, ctx: JobCtx) -> DpResult<()>; }
  #[derive(Clone)] pub struct JobCtx { pub events: tokio::sync::mpsc::Sender<JobEvent>, pub cancel: tokio_util::sync::CancellationToken }
  pub struct JobRunner { .. } impl JobRunner { pub fn new(events: Sender<JobEvent>) -> Self; pub fn spawn(&self, job: Arc<dyn Job>) -> String /*job_id*/; pub fn cancel(&self, job_id:&str); }
  pub struct ScanDeps { pub catalog: Arc<dyn Catalog>, pub hasher: Arc<dyn Hasher>, pub metadata: Arc<dyn MetadataProvider>, pub thumbs: Arc<ThumbChain>, pub store: Arc<ThumbStore> }
  pub struct ScanJob { .. } impl ScanJob { pub fn new(id: String, drive: Drive, deps: ScanDeps) -> Self }
  ```
- Scan algorithm: `walkdir` over `drive.mount_path` (skip hidden dirs, `.Trashes`, `.Spotlight-V100`, `.fseventsd`); keep files whose ext maps via `MediaKind::from_ext`; `total` = count; per file: hash → if `!store.exists(hash, 400)` render+write 400 & 2000 (each size independently; a failed thumb is an `ItemError` but the media row is still upserted) → metadata (failure → `ItemError`, row still upserted with metadata `None`s) → `upsert_media`. Errors also go to `record_scan_error`. Check `cancel` between files. Concurrency: `futures::stream::iter(...).for_each_concurrent(4, ...)`.

- [ ] **Step 1: Tests** — `tests/scan.rs`: build a temp "drive" dir containing copies of `fixtures/sample.jpg`, `sample.png`, a `notes.txt`, and a corrupt `bad.jpg` (write 10 bytes). Use `SqliteCatalog::open_in_memory`, register a drive with `mount_path = tempdir`, `ThumbStore` in another tempdir, real `ExiftoolProvider` (skip test if exiftool missing). Run `ScanJob` via `JobRunner`, collect events until `Finished`. Assert: `count_media == 3` (jpg, png, bad.jpg), `ok == 2`, `failed == 1`, at least one `ItemError` for `bad.jpg`, `store.exists(hash_of_sample_jpg, 400)` and `2000`, source files untouched (mtime + size unchanged). Second test: cancel immediately → `Cancelled` event, job exits.

- [ ] **Step 2: Implement** `runner.rs` (map of `job_id → CancellationToken`, `tokio::spawn`, `job_id = format!("scan-{}", counter.fetch_add(1))`, wraps `run` to emit `Finished/Cancelled`); `scan.rs` per the algorithm. Deps: `walkdir = "2"`, `futures = "0.3"`, `tokio-util = "0.7"`, crates `dp-core dp-catalog dp-hash dp-metadata dp-thumbs`. `cargo test -p dp-jobs` → PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(jobs): job runner and scan job with progress events

Co-Authored-By: Claude Fable 5 <noreply@antropic.com>"
```
(Fix the trailer typo — it must be `noreply@anthropic.com`.)

---

### Task 1.6: Scan from the UI — `start_scan`/`cancel_job` commands, events, `ScanProgress`, drive presence watcher

**Files:**
- Create: `src-tauri/src/commands/scan.rs`, `src-tauri/src/presence.rs`, `src/lib/api/scan.ts`, `src/lib/api/scan.test.ts`, `src/lib/api/events.ts`, `src/features/drives/components/ScanProgress/*`, `src/features/drives/hooks/useJobEvents.ts`, `src/features/drives/hooks/useJobEvents.test.ts`
- Modify: `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src/features/drives/components/DriveCard/*`, `src/features/drives/DrivesPage.tsx`

**Interfaces:**
- Rust commands: `start_scan(drive_id: i64) -> Result<String /*job_id*/, DpError>` (`NotFound` if drive offline), `cancel_job(job_id: String)`. Events: Tauri event name `"job"` with `JobEvent` payload; event `"drives:changed"` (no payload) emitted by the presence watcher.
- Presence watcher: `presence::spawn(app: AppHandle)` — every 5s `volumes.list()`, for each registered drive set `mount_path` to the matching volume's mount (match by `name == drive.name` or previously stored `mount_path`), `free` updated; emit `drives:changed` only when something changed.
- TS: `startScan(driveId: number): Promise<string>`, `cancelJob(jobId: string)`, `onJobEvent(cb: (e: JobEvent) => void): Promise<UnlistenFn>` (wraps `listen` from `@tauri-apps/api/event`), `JobEvent` discriminated union mirroring Rust. Hook `useJobEvents(): Record<jobId, JobEvent>` (latest event per job).

- [ ] **Step 1: State + commands** — `AppState` gains `hasher`, `metadata`, `thumbs`, `store` (root `app_data_dir/thumbs`), `runner: JobRunner` whose receiver is drained by a spawned task doing `app.emit("job", &ev)`. `start_scan` builds `ScanJob::new(id_placeholder, drive, deps)` — make `JobRunner::spawn` take `Box<dyn FnOnce(String) -> Arc<dyn Job>>` so the runner assigns the id, or simpler: `JobRunner::next_id()` then `ScanJob::new(id.clone(), ...)`, `runner.spawn(id, job)`. Pick the second; update Task 1.5 signatures accordingly (`pub fn next_id(&self) -> String; pub fn spawn(&self, id: String, job: Arc<dyn Job>)`).
- [ ] **Step 2: Presence watcher** in `presence.rs`, started in `setup`. Unit-test the pure matching function `resolve_presence(drives: &[Drive], volumes: &[Volume]) -> Vec<(i64, Option<String>, Option<u64>)>` in Rust (lives in `dp-volumes` as `pub fn resolve_presence` so it's testable without Tauri): test matches by name, by prior mount_path, and returns `None` for unplugged.
- [ ] **Step 3: TS** — `events.ts`: `export const onEvent = <T,>(name: string, cb: (p: T) => void) => listen<T>(name, (e) => cb(e.payload));` `scan.ts` as above; tests with `mockIPC`. `useJobEvents` test: mock `@tauri-apps/api/event` `listen` with `vi.mock`, emit a Progress then a Finished, assert the hook state. 
- [ ] **Step 4: UI** — `ScanProgress` props `{ event: JobEvent | undefined; onCancel(): void }` renders shadcn `Progress` (`done/total`), current filename (mono, truncated), counts on `finished`; test: Progress 3/10 shows "3 / 10". `DriveCard` gains `onScan?(): void`, `scanEvent?: JobEvent` and renders `ScanProgress` while a job is running; "Scan" button disabled when offline. `DrivesPage` wires `useJobEvents`, `startScan` mutation, and listens to `drives:changed` to invalidate `["drives"]`.
- [ ] **Step 5: Capabilities** — `src-tauri/capabilities/default.json` permissions include `"core:event:default"` (and `"core:default"`).
- [ ] **Step 6: Verify** — all tests/lints; `pnpm tauri dev`: register an external drive, Scan → progress advances, finished counts; unplug → card flips to OFFLINE within 5s; Scan disabled. Commit:

```bash
git add -A && git commit -m "feat(drives): start/cancel scan from UI with live progress and drive presence watcher

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1.7: Minimal offline gallery slice — `list_media` + `ThumbGrid`

**Files:**
- Create: `src-tauri/src/commands/media.rs`, `src/lib/api/media.ts`, `src/lib/api/media.test.ts`, `src/lib/media/thumbUrl.ts`, `src/lib/media/thumbUrl.test.ts`, `src/features/gallery/components/ThumbGrid/*`
- Modify: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src/features/gallery/GalleryPage.tsx`

**Interfaces:**
- Rust: `list_media(limit: u32, offset: u32) -> Result<Vec<MediaItem>, DpError>` where `MediaItem { row: MediaRow, thumb_path: String /* absolute 400.webp */, drive_name: String, online: bool }` (add `Catalog::list_media_with_drive` returning `(MediaRow, Drive)` pairs, ordered by `taken_at DESC NULLS LAST, id DESC`).
- TS: `listMedia(limit, offset): Promise<MediaItem[]>`; `thumbUrl(path: string): string` = `convertFileSrc(path)`.

- [ ] **Step 1: Asset protocol** — `tauri.conf.json` → `"app": { "security": { "assetProtocol": { "enable": true, "scope": ["$APPDATA/thumbs/**"] } } }`; capability `"core:default"` already covers asset fetch in Tauri 2.
- [ ] **Step 2: Rust** — catalog method + command registered; test in `dp-catalog/tests/media.rs` that ordering puts newest `taken_at` first and rows without `taken_at` last.
- [ ] **Step 3: TS (test first)** — `thumbUrl.test.ts` mocks `@tauri-apps/api/core` `convertFileSrc` and asserts passthrough; `media.test.ts` with `mockIPC`.
- [ ] **Step 4: ThumbGrid** — props `{ items: MediaItem[] }`; CSS `columns` masonry (`[column-width:240px] gap-2`), each tile `aspect-ratio: width/height` (fallback `4/3`), `<img loading="lazy" src={thumbUrl(item.thumb_path)}>`, bottom-right mono badge with `drive_name` and a dim "OFFLINE" badge when `!online`, video play glyph when `kind === "video"`. Test: renders N `img` with `alt = rel_path` and shows OFFLINE badge for offline items.
- [ ] **Step 5: GalleryPage** — `useQuery(["media", 0], () => listMedia(500, 0))`, header shows `"{n} items"` in mono; empty state "No media yet — register and scan a drive." linking to `/drives`.
- [ ] **Step 6: Verify — Phase 1 exit criterion** — scan a drive, open Gallery: thumbnails render; **unplug the drive**: Gallery still renders every thumbnail with OFFLINE badges. All tests/lints pass. Commit:

```bash
git add -A && git commit -m "feat(gallery): minimal offline thumbnail grid from the catalog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: PR** — `git push -u origin HEAD`, `gh pr create` (body: `Closes #M`, summary, test plan incl. the unplug test, screenshots of Drives + Gallery, generated-with trailer). CI green → `gh pr merge --squash --delete-branch`.

---

## Self-review notes

- Spec coverage (Phases 0–1): tokens/fonts/shadcn ✔ (0.2); registry + modules ✔ (0.3); `VolumeProvider` ✔ (0.4); CI + git flow ✔ (0.5); thumbnail spike ✔ (1.1); `Catalog`/schema (drives, media, scan_errors, settings — `places`, `tags`, `ingest_*`, `media_fts` deferred to their phases) ✔ (1.2); `Hasher`, `MetadataProvider` ✔ (1.3); `ThumbnailProvider` chain + 400/2000 WebP store ✔ (1.4); `Job`/runner/scan + progress events ✔ (1.5–1.6); drive presence online/offline ✔ (1.6); offline-browsable gallery ✔ (1.7). Not in this plan by design: `Geocoder`, `IngestStrategy`, `NamingTemplate`, virtualized grid, lightbox, sidecar bundling, Zustand (no ephemeral state needed yet).
- Type consistency: `Volume`/`Drive`/`MediaRow`/`MediaMetadata` field names match between Rust (snake_case serde) and TS types. `JobRunner` API is `next_id()` + `spawn(id, job)` (1.5 text amended by 1.6 Step 1 — implement that form in 1.5).
- Placeholders: none; each step has concrete code or commands.
