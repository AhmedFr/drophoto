# Phase 7 — Google Photos gallery experience

**Status:** approved design, ready for an implementation plan
**Date:** 2026-09-04
**Supersedes nothing.** Extends the Phase 6 gallery (PR #40, v0.7.0).

## Goal

Bring three parts of drophoto's gallery up to the interaction quality of
Google Photos:

1. **Selection** — a hover checkmark that selects without opening, a
   selection mode where a plain click toggles, and drag-across-tiles to
   select a swath.
2. **Tags page as albums** — a grid of album cards with cover art,
   replacing today's list of rows.
3. **A date-scrubbing scrollbar** — a slim right-edge scrollbar that
   expands on hover, shows the date at the current position, and can be
   dragged to jump anywhere in the library.

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Which selection behaviors? | Hover checkmark + selection mode, and drag-to-select. The existing selection bar and month-header select stay as they are, refitted to the new model. |
| Albums: new concept or restyled tags? | **Restyled tags.** No new data model, no migration. One photo still carries many tags, still written to `.xmp` sidecars. |
| Grid grouping granularity? | **Keep month grouping.** Day detail lives in the scrollbar tooltip instead. |
| Timeline foundation? | **Full lightweight index (Approach A).** See below. |

## Global constraints

These come from the project's standing rules and bind every task.

- Migrations 0001–0009 are **FROZEN**. This phase adds **no migration**.
- Tag mutations must never write `.xmp` directly — they only set
  `sidecar_pending`.
- RESET APP DATA / UNINSTALL must never touch photos, drives, or `.xmp`
  sidecars. This phase does not go near them.
- The dev-port edits in `src-tauri/tauri.conf.json` (devUrl 1430) and
  `vite.config.ts` (1430/1431) stay **uncommitted**.
- Each component lives in its own folder with `index.ts`, the component
  file, a `.types.ts`, and — where meaningful — `.constants.ts` and a
  test file.
- `pnpm check` is the only gate; GitHub Actions is `workflow_dispatch`
  only.

---

## Part 1 — The timeline index (foundation)

### Why it exists

Today `useMediaInfinite` pages 500 items at a time and the layout is built
only from what has loaded. Three consequences: the scroll height is
unknown until you reach the bottom, no offset can be mapped to a date, and
any selection that spans unloaded photos (Shift+click, select-all) is
wrong. All three of this phase's features need the opposite.

### The shape

One new catalog method and one new Tauri command return a compact entry
per matching row, in the query's own sort order, for the **entire**
filtered set:

```rust
/// One row of the gallery's timeline index: the minimum needed to place
/// a tile in the justified layout and to group it under a month header,
/// without the strings that make `MediaItem` expensive to send in bulk.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MediaIndexEntry {
    pub id: i64,
    /// Epoch milliseconds, or `None` for rows with no `taken_at` — these
    /// sort last under `TakenDesc`/`TakenAsc` and group under an
    /// "Undated" header, matching `query_media`'s `NULLS LAST`.
    pub taken_at: Option<i64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub kind: MediaKind,
}
```

`Catalog::media_index(&MediaQuery) -> DpResult<Vec<MediaIndexEntry>>`
reuses the exact `where_clause` and `ORDER BY` composition that
`query_media` and `count_media_query` already share, so index position N
is guaranteed to be the same row `query_media` returns at `offset = N`.
It ignores the query's `limit`/`offset`.

Size check: 17,405 rows × ~40 bytes ≈ 700 KB of JSON, well under 100 ms
from local SQLite. The plan's first task measures this on the real
catalog and records the number; if it ever exceeds ~300 ms the fallback is
to send the index as a typed array rather than JSON, but that is not
expected at this library size and is **not** built now (YAGNI).

### Hydration

The index gives geometry; tiles still need `thumb_path`, `drive_name`,
`online`, `has_thumb`, `missing_at`. Those arrive through the **existing**
`query_media` command — no second new command — fetched in fixed chunks of
200 aligned to chunk boundaries, each its own react-query key
(`["media-chunk", ...filters, chunkIndex]`). Scrolling therefore reuses
cached chunks, and a chunk maps to `query_media` with
`offset = chunkIndex * 200, limit = 200`.

A tile whose chunk has not arrived renders as a plain `bg-surface-2`
placeholder at its correct size — the layout never shifts, because
geometry came from the index.

### What this replaces and what it fixes

- `useMediaInfinite` is replaced by `useMediaIndex` + `useMediaChunk`.
- `useMediaCount` is deleted; the toolbar count becomes the index length,
  which makes the Phase 6 count/grid disagreement structurally impossible.
- `buildLayout` is refactored to take the minimal geometry shape rather
  than a full `MediaItem`, with the hydrated item passed to `Tile`
  separately (or `undefined` while pending).

### Consistency and staleness

Index and chunks share one react-query key prefix, so any filter change
invalidates both together. Scans and tag mutations already invalidate the
media queries; the index joins that same invalidation set. A row inserted
between the index fetch and a chunk fetch would shift offsets — in
practice a scan invalidates both, and the cost of the rare miss is one
tile showing a neighbour's thumbnail until the next invalidation. Ruled
acceptable rather than adding cursor-based paging.

---

## Part 2 — Selection

### The model

Selection mode is derived, not stored: `selectedIds.size > 0`. Nothing new
persists.

| Gesture | Behavior |
| --- | --- |
| Hover a tile | A circular checkmark button fades in at the top-left. |
| Click the checkmark | Toggles that tile. Never opens the lightbox. |
| Click the tile body, not in selection mode | Opens the lightbox (unchanged). |
| Click the tile body, in selection mode | Toggles that tile. |
| Shift+click | Extends the range from the anchor, over the **index**, so it spans photos that have not loaded. |
| Cmd/Ctrl+click | Toggles, as today. |
| Press the checkmark and drag | Selects (or deselects) every tile from the origin to the tile under the pointer. |
| Escape | Clears the selection and leaves selection mode. |

The drag's direction of effect is fixed at its origin: if the origin tile
became selected, the drag selects; if it became deselected, the drag
deselects. Dragging back toward the origin reverts tiles it passed, so a
mistaken drag is undone by reversing it — the Google Photos behavior.

### Implementation

A `useDragSelect` hook owns the gesture: `pointerdown` on a checkmark
captures the pointer and records the origin index and mode; each tile's
`onPointerEnter` reports its index while a drag is live; the hook applies
origin→current as a range against the store; `pointerup` on `document`
ends it. Pointer capture means the gesture survives leaving the grid, and
`document`-level cleanup means it cannot get stuck if the pointer is
released outside the window.

Auto-scroll while dragging near the top or bottom edge of the scroll
container is **in scope** — a drag-select that cannot pass the fold is not
the Google Photos experience.

The existing `SelectionBar` and month-header select keep working; the
month header's select action now toggles rather than only adding, so it
reads as a checkbox for that section.

### Testing

`useDragSelect` is unit-tested against a fake index (origin, direction,
reversal, release outside the grid). Tile behavior is tested through the
existing gallery tests: checkmark click does not open, body click opens
only outside selection mode, Escape clears.

---

## Part 3 — Tags page as albums

### The page

A responsive grid of album cards replacing `TagRow`'s list:

- A square cover image — the newest photo carrying that tag — with the
  same `ImageOff` placeholder the gallery uses when no thumbnail exists,
  and a neutral tile for a tag with no photos.
- The tag name below the cover, then the item count.
- Clicking a card opens the gallery filtered to that tag (the existing
  `setTagId` + navigate path, unchanged).
- Rename, merge and delete move into a per-card overflow menu; the three
  existing dialogs are reused untouched.
- A sort control: **Recently updated** (default), **Name**, **Count**.
  Sorting is client-side over the already-fetched list.

### The cover query

`Catalog::list_tags_with_counts` gains `cover_hash: Option<String>` on
`TagWithCount` — the `hash` of the tag's newest photo by `taken_at DESC
NULLS LAST, id DESC`, computed in the same statement via a correlated
subquery. Rows whose media are all missing still return a cover; a cover
is art, not a claim that the file is present.

The Tauri command layer (which owns `ThumbStore`) maps each entry into the
DTO the page consumes:

```rust
pub struct TagCard {
    pub tag: Tag,
    pub count: u64,
    /// `None` when the tag has no media at all.
    pub thumb_path: Option<String>,
    pub has_thumb: bool,
}
```

This mirrors `to_item`'s existing split: the catalog returns hashes, the
command layer resolves them through the thumbnail store.

Note: tags have no colour field, and this phase does not add one.

---

## Part 4 — The date scrubber

### Behavior

A custom scrollbar overlays the right edge of the gallery's scroll
container; the native scrollbar is hidden there.

- **At rest:** a thin, low-contrast track — present but quiet.
- **On hover or while scrolling:** the track widens and year labels fade
  in, positioned at each year's real offset in the timeline.
- **A pill** tracks the current scroll position showing the **exact date**
  of the topmost photo at that offset ("12 March 2019"). This is where the
  day detail lives, given the grid itself stays grouped by month — and it
  is available because the index carries every photo's `taken_at`, not
  just the month headers'. A photo with no date reads "Undated".
- **Dragging the pill** scrolls live, the grid following under it.
- **Clicking the track** jumps to that position.

Because the index covers the whole library, every one of these positions
is exact — no estimation, no drift.

### Implementation

The layout already yields month headers with known offsets from the
virtualizer. A `useTimelineTicks` hook reduces those into

```ts
type Tick = { label: string; offsetRatio: number; isYearStart: boolean };
```

The scrubber component consumes ticks plus the live `scrollTop` and
`scrollHeight`. Dragging maps pointer Y to a scroll offset and calls
`scrollTo`.

The two labels come from different sources, deliberately: the **track's
year labels** come from the month headers via `useTimelineTicks`, because
they must sit at layout offsets; the **pill's exact date** comes from the
index entry of the topmost tile at the current offset, since only the
index knows individual photos' dates.

Year labels are dropped when they would overlap — the track's height
divided by a minimum label spacing caps how many render, keeping the
earliest year, the latest, and an even spread between.

Accessibility: the scrubber is a supplement, never the only way to
navigate. The native scroll behavior of the container is untouched — the
wheel, trackpad, keyboard, and Page Up/Down all still work. The pill
carries `role="slider"` with `aria-valuetext` set to its date label, and
respects `prefers-reduced-motion` by dropping the expand transition.

### Testing

`useTimelineTicks` is unit-tested (tick derivation, year detection,
overlap culling) against synthetic layouts. The component is tested for
pointer-drag → `scrollTo` mapping and label selection with a stubbed
scroll element.

---

## Out of scope

Explicitly not in this phase, to keep it shippable:

- Faces (Apple Vision + ONNX embedding model) — that remains its own
  phase, next.
- Real albums as a curated concept, ordering, or chosen covers.
- Day-level grid grouping.
- Any change to the lightbox, Places, Settings, or the organize flow.
- Tag colours.

## Risks

| Risk | Mitigation |
| --- | --- |
| Index fetch is slower than expected on a much larger library | First task measures it on the real 17k catalog and records the number. The chunked hydration means only the index itself is on the critical path. |
| Offset drift between index and chunk if rows change mid-scroll | Both share an invalidation set; worst case is one stale tile until the next invalidation. Accepted over cursor paging. |
| Drag-select fighting the browser's native text/image drag | Tiles set `draggable={false}` and the gesture calls `preventDefault` on `pointerdown`, the same guard the existing Shift+click `onMouseDown` uses. |
| Replacing infinite paging regresses the grid | The index/chunk split lands as its own task with the grid still rendering identically, before any new UI is built on it. |

## Task shape for the plan

1. `MediaIndexEntry` + `Catalog::media_index` + the Tauri command, with
   catalog tests asserting index order matches `query_media` at the same
   offsets. Measure and record fetch time.
2. Frontend swap: `useMediaIndex` + `useMediaChunk` replace
   `useMediaInfinite`; `buildLayout` takes geometry; placeholder tiles;
   `useMediaCount` deleted and the toolbar count sourced from the index.
   The gallery must look and behave exactly as it does today.
3. Selection: hover checkmark, selection mode, `useDragSelect` with
   edge auto-scroll, Escape, month-header toggle.
4. Tags page as albums: `cover_hash`, the `TagCard` DTO, the card grid,
   the sort control, the overflow menu.
5. The date scrubber: `useTimelineTicks`, the scrubber component, hiding
   the native scrollbar, drag and click-to-jump.
6. Finalize: full `pnpm check`, version bump, PR, squash-merge, signed and
   notarized release.
