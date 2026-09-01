# Phase 5c Implementation Plan — map fix, scan-error severity, human place names, fullscreen viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix the black Places map, add severity-coded scan-error browsing, lead the lightbox metadata with the human place name, and add a fullscreen image viewer.

**Architecture:** One CSP line fixes the map (root cause verified by bisection: MapLibre loads raster tiles/sprites through an image path governed by `img-src`, and the app CSP only allowed the tiles host in `connect-src`). Severity is a pure frontend mapping over the existing `scan_errors.code` values, backed by one new count-by-code catalog method + command. The place-name and fullscreen tasks are lightbox-only frontend work.

**Tech Stack:** existing — Rust workspace (dp-catalog/dp-core, sqlx), Tauri 2 commands, React 19 + TS, TanStack Query, Radix (hover-card), Vitest + cargo test.

**Spec:** Issue #26 (user field reports 2026-09-01). No separate design doc — each task's behavior is fully specified below.

## Global Constraints

- Safety: never touch user photos, drives, or `.xmp` sidecars destructively.
- Migrations 0001–0009 are FROZEN. No task here needs a migration (severity derives from the existing `code` column).
- The dev-port lines (`src-tauri/tauri.conf.json` devUrl 1430, `vite.config.ts` 1430/1431) stay uncommitted — stash-protect when committing `tauri.conf.json`.
- The updater pubkey in `tauri.conf.json` must not be altered.
- TDD; tests assert real behavior. Component-folder convention for new components (folder: index.ts, Component.tsx, .types.ts, optional .constants.ts, test).
- Error codes emitted by jobs are exactly: `io`, `not_found`, `sidecar`, `db`, `unsupported` (see `dp_jobs::error_code`). The severity mapping must be total over these plus a fallback for unknown codes.

---

### Task 5c.1: Places map CSP fix (COORDINATOR-INLINE — already scoped, one line)

**Files:** Modify: `src-tauri/tauri.conf.json` (`app.security.csp`: add `https://tiles.openfreemap.org` to `img-src`); Modify: `src/features/places/components/PlacesMap/PlacesMap.constants.ts` (doc comment already references img-src — keep accurate).

Add `https://tiles.openfreemap.org` to the `img-src` directive. Stash-protect the devUrl line when committing. Commit: `fix(places): allow map tile images in the CSP — the map rendered black`.

### Task 5c.2: Scan-error severity — colored codes, counts, hover repartition

**Files:**
- Modify: `crates/dp-catalog/src/scan_errors.rs` (or wherever `list_scan_errors`/`count_scan_errors` live — locate with grep): add `scan_error_code_counts(drive_id) -> Vec<ScanErrorCodeCount>` (GROUP BY code, count DESC).
- Modify: `crates/dp-core/src/types.rs`: `ScanErrorCodeCount { code: String, count: u64 }` (Serialize).
- Modify: `crates/dp-catalog/src/lib.rs` Catalog trait + any test doubles that implement it.
- Modify: `src-tauri/src/commands/scan.rs`: `scan_error_code_counts` command; register in `src-tauri/src/lib.rs`.
- Test: `crates/dp-catalog/tests/scan_errors.rs` (counts grouped correctly, empty drive → empty vec, other drive's rows not counted).
- Create: `src/features/drives/components/ScanErrorSeverity/` — `severity.ts` (mapping + labels + tailwind color classes), `.types.ts`, test. Mapping: `db` → critical (red-400), `io`/`not_found` → error (orange-400), `sidecar` → warning (yellow-400), `unsupported` → info (text-faint), unknown code → error.
- Modify: `src/lib/api/scan.ts`: `scanErrorCodeCounts(driveId)` mirror + `ScanErrorCodeCount` type (+ round-trip test).
- Modify: `src/features/drives/components/ScanErrorsDialog/ScanErrorsDialog.tsx`: each row gets a severity-colored code chip; the header shows per-severity counts (e.g. `2 critical · 5 error · 2 warning`) from the code-counts query.
- Modify: `src/features/drives/components/ScanProgress/ScanProgress.tsx` (the terminal "N failed" button): wrap in Radix HoverCard (add `src/components/ui/hover-card.tsx` via shadcn pattern if absent) showing the severity repartition (colored dot + severity label + count per row). Query key `["scan-error-code-counts", driveId]`; invalidate it in `onTerminalEvent` alongside `["scan-errors"]`.
- Tests for dialog chips, header counts, and hover-card content (mockIPC).

Commit: `feat(drives): severity-coded scan errors with counts and hover repartition`.

### Task 5c.3: Human place name leads the lightbox metadata

**Files:**
- Modify: `src/features/gallery/components/Lightbox/MetaPanel.tsx`: merge the LOCATION and PLACE sections into one **PLACE** section. Primary line: the human-readable name — `[name, admin, country].filter(Boolean).join(", ")` (the geocoder's nearest known city; this is the reverse-geocoding standard — no neighborhood data exists in the GeoNames cities dataset). Secondary line under it, `text-faint text-[10px]`: the raw coordinates from `formatCoords`. States: place + coords → name primary, coords secondary; coords only (not yet geocoded or cleared) → coords primary with a faint "not placed yet — GEOCODE NOW on Places" hint; neither → "No location data". Keep the Change button (PlacePanel) exactly as is.
- Test: update `MetaPanel.test.tsx` for the three states.

Commit: `feat(gallery): human place name leads the lightbox location section`.

### Task 5c.4: Fullscreen viewer

**Files:**
- Modify: `src/features/gallery/components/Lightbox/Lightbox.tsx` + `.types.ts`: add fullscreen state. A button (Maximize2/Minimize2 lucide icons, aria-label "Enter full screen"/"Exit full screen") near the close button toggles it. Fullscreen: the meta panel is hidden and the image area fills the whole overlay (`fixed inset-0`), object-contain on black; prev/next arrows and ArrowLeft/ArrowRight keys keep working; Escape exits fullscreen FIRST (back to normal lightbox), a second Escape closes the lightbox — extend the existing Escape arbitration (TagPanel/PlacePanel precedence stays as is). Double-click on the image also toggles fullscreen.
- State is per-lightbox-session (reset on close); no persistence.
- Test: `Lightbox.test.tsx` — button toggles (meta panel disappears/reappears), Escape order, arrows still navigate while fullscreen, double-click toggles.

Commit: `feat(gallery): fullscreen image viewer without the metadata bar`.

### Task 5c.5: Finalize

- Full gates: cargo fmt/clippy/test --workspace, pnpm lint/typecheck/test:coverage, `pnpm tauri build --debug --no-bundle`.
- Whole-branch review (BASE = branch point from main) + ONE fix wave + scoped re-review.
- Bump versions to 0.5.0 (stash dance for tauri.conf.json), PR `Closes #26` titled `feat: map fix, scan-error severity, place names, fullscreen (Phase 5c)`, squash-merge, release v0.5.0 via `scripts/release.sh 0.5.0` (updater feed makes it an in-app update).
- Update memory + status artifact. Tell the user: update from Settings; the map now needs no re-scan — it just renders.
