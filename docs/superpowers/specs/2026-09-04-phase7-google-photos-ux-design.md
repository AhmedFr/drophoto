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

Plus the prerequisite that makes the third one worth having:

4. **Filename date recovery** — lifting date coverage from 35% to ~92%,
   so the timeline the scrubber scrubs is a real one (Part 5).

## Decisions taken during brainstorming

| Question | Decision |
| --- | --- |
| Date coverage is 35% — recover dates now or later? | **Now, in this phase** (Part 5). The scrubber is worth little over a library that is two-thirds "Undated". |
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
    /// RFC3339, matching `MediaRow::taken_at`'s serialization exactly so
    /// the frontend parses both with the same helpers — a second date
    /// representation would be a bug factory for ~150 KB of savings.
    /// `None` sorts last, the same `NULLS LAST` `query_media` uses, and
    /// groups under an "Undated" header.
    pub taken_at: Option<String>,
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

### Measured cost

Taken on the real catalog (17,405 rows) on 2026-09-05, warm:

| | |
| --- | --- |
| SQL (`SELECT id, taken_at, width, height, kind` + the sort) | 4 ms warm, 11 ms cold |
| Payload | 642 KB — **37.8 bytes per photo** |
| `JSON.parse` of all rows | 3 ms |

Roughly **40 ms end to end** including IPC. The existing `media_taken_at`
index already covers the sort, so this is one indexed scan of five narrow
columns — not a build step.

Projected: ~3.7 MB / ~40 ms CPU at 100k photos; ~18 MB / ~200 ms at 500k.

### Why not an approximate scrubber

An exact scrubber requires knowing the whole timeline's shape on the
client — there is no way around that, only the choice between knowing it
exactly (this index) and approximately (per-bucket counts with estimated
heights). Approximate means the label under your thumb disagrees with what
is on screen, and it does nothing for cross-library selection.

Google Photos' own scrubber is accurate from first paint, which is only
possible with the full timeline shape client-side; what it separates is
that cheap shape data from the thumbnails themselves, which is exactly the
split below. (Google's internals are not verifiable from here — the
constraint, not their implementation, is what this decision rests on.)

### Nothing blocks on the index

The index query and the first hydration chunk are fired **in parallel**.
The grid paints from chunk 0 as fast as it does today; the scrubber and
cross-library selection become live when the index lands a beat later.
There is no approximate phase to reconcile and only one layout path.

Until the index resolves, the grid renders from the hydrated chunks alone
(today's behavior), the scrubber renders in its at-rest state without
year labels, and the toolbar count shows its loading state.

**Documented fallback trigger, not built now (YAGNI):** if the index ever
exceeds ~200 ms on a real library, switch to a two-stage progressive load
— per-month counts for an approximate scrubber first, exact index second.
At 30× the current library that threshold is still not reached.

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

---

## Part 5 — Filename date recovery

### Why this is in the phase

The scrubber is only as good as the dates it scrubs. Measured on the real
catalog on 2026-09-05:

| | |
| --- | --- |
| Total rows | 17,405 |
| With an EXIF `taken_at` | **6,007 (35%)** |
| Without | 11,398 — of which 10,203 have already had metadata read |

So two-thirds of the library genuinely carries no EXIF date; it is not
waiting on a scan. As specced, the scrubber would show one enormous
"Undated" block covering most of the track.

### Why not file mtime

Tested and **rejected**. Where both dates exist (5,880 rows), `mtime` is
within a day of `taken_at` only 384 times (6.5%); 336 are off by over a
year. `COALESCE(taken_at, mtime)` collapses 88% of the library into
2024–2025. It records when files were copied, not when photos were taken.

### The filename

WhatsApp strips EXIF but names its exports `IMG-YYYYMMDD-WA####`.
Screenshots and camera exports embed dates the same way.

| Pattern | Undated rows matching |
| --- | --- |
| `IMG-20240816-WA0010.jpg` | **9,345** |
| `2019-03-12` dashed | 578 |
| `20190312_101530` | 127 |

Recovery takes date coverage from 35% to roughly **92%**, with real
capture dates.

### How it applies

`dp_metadata::date_from_filename` is a pure function, deliberately
conservative — only the basename is read (a dated folder names a batch,
not each photo), digit runs longer than a date are rejected as ids, and
every candidate must be a real calendar date between 1990 and 2100.

It is applied at the metadata-read seam in `ScanJob`, mutating
`metadata.taken_at` before both `upsert_media` and `update_media_metadata`
see it. That placement matters: a later full rescan re-derives the date
rather than wiping it back to NULL, so recovery is durable rather than a
one-shot that the next scan undoes.

Existing rows are handled by a Settings → Metadata action
(`recover_filename_dates`), which fills `taken_at` **only where it is
NULL**, in batches, guarded in the SQL itself so a concurrent scan's real
EXIF date always wins. No migration, no file on disk is touched.

Not addressed here: some undated rows are not photographs at all
(`June2023/Documents/.../Purple_Nebula_03-1024x1024.png` and similar
assets swept in from a Documents folder). That is a scan-source question,
not a date question.

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
| Index fetch is slower than expected on a much larger library | Measured at ~40 ms for 17k; nothing blocks on it (the grid paints from chunk 0 in parallel), so a slow index degrades the scrubber's arrival, not the gallery. Documented trigger at ~200 ms to switch to the progressive two-stage load. |
| Offset drift between index and chunk if rows change mid-scroll | Both share an invalidation set; worst case is one stale tile until the next invalidation. Accepted over cursor paging. |
| Drag-select fighting the browser's native text/image drag | Tiles set `draggable={false}` and the gesture calls `preventDefault` on `pointerdown`, the same guard the existing Shift+click `onMouseDown` uses. |
| Replacing infinite paging regresses the grid | The index/chunk split lands as its own task with the grid still rendering identically, before any new UI is built on it. |

## Task shape for the plan

1. `dp_metadata::date_from_filename` — pure, conservative, unit-tested
   against real paths from the catalog.
2. Apply it: the `ScanJob` metadata seam, plus a Settings → Metadata
   backfill for existing rows.
3. `MediaIndexEntry` + `Catalog::media_index` + the Tauri command, with
   catalog tests asserting index order matches `query_media` at the same
   offsets.
4. Frontend swap: `useMediaIndex` + `useMediaChunk` replace
   `useMediaInfinite`, fetched **in parallel** so the grid never waits on
   the index; `buildLayout` takes geometry; placeholder tiles;
   `useMediaCount` deleted and the toolbar count sourced from the index.
   The gallery must look and behave exactly as it does today.
5. Selection: hover checkmark, selection mode, `useDragSelect` with
   edge auto-scroll, Escape, month-header toggle.
6. Tags page as albums: `cover_hash`, the `TagCard` DTO, the card grid,
   the sort control, the overflow menu.
7. The date scrubber: `useTimelineTicks`, the scrubber component, hiding
   the native scrollbar, drag and click-to-jump.
8. Finalize: full `pnpm check`, version bump, PR, squash-merge, signed and
   notarized release.
