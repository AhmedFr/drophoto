# Phase 7 — Google Photos gallery experience: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the gallery a Google Photos-grade experience — filename date recovery, an exact timeline index, hover/drag selection, tags as album cards, and a date-scrubbing scrollbar.

**Architecture:** A compact timeline index of the whole filtered set (`id`, `taken_at`, `width`, `height`, `kind`) is fetched **in parallel** with the first hydration chunk, so the grid paints as fast as today while the index gives exact scroll height, exact offset→date mapping, and correct selection across photos that have not loaded. Full `MediaItem` detail arrives per 200-row chunk through the existing `query_media` command. Date coverage is lifted from 35% to ~92% first, so the scrubber has a real timeline to scrub.

**Tech Stack:** Rust (sqlx/SQLite, chrono, async-trait), Tauri 2, React 19 + TypeScript, TanStack Virtual + Query, Zustand, Tailwind 4 + shadcn/Radix, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-phase7-google-photos-ux-design.md`

## Global Constraints

- Migrations 0001–0009 are **FROZEN**. This phase adds **no migration**.
- Tag mutations must never write `.xmp` directly — they only set `sidecar_pending`.
- RESET APP DATA / UNINSTALL must never touch photos, drives, or `.xmp` sidecars.
- The dev-port edits in `src-tauri/tauri.conf.json` (devUrl 1430) and `vite.config.ts` (1430/1431) must stay **uncommitted**. Never `git add` either file.
- Each component lives in its own folder: `index.ts`, the component file, `.types.ts`, and where meaningful `.constants.ts` and a test file.
- `pnpm check` is the only gate — GitHub Actions is `workflow_dispatch` only. `pnpm check` = `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `pnpm tauri build --debug --no-bundle`.
- Date recovery fills `taken_at` **only where it is currently NULL**. It must never overwrite an EXIF date and never touch a file on disk.
- Every task leaves the app runnable.

## File Structure

**Rust — new**
- `crates/dp-metadata/src/filename_date.rs` — pure `date_from_filename`.
- `crates/dp-catalog/src/index.rs` — `media_index`, `list_undated`, `set_taken_at_bulk`.

**Rust — modified**
- `crates/dp-core/src/types.rs` — add `MediaIndexEntry`; add `cover_hash` to `TagWithCount`.
- `crates/dp-metadata/src/lib.rs` — export `date_from_filename`.
- `crates/dp-jobs/src/scan.rs:791-798` — filename fallback after the metadata read.
- `crates/dp-catalog/src/lib.rs` — three new `Catalog` trait methods + impls.
- `crates/dp-catalog/src/query.rs` — reuse `where_clause`/`order_by` from `index.rs`.
- `crates/dp-catalog/src/tags.rs:29-48` — `cover_hash` subquery.
- `src-tauri/src/commands/media.rs` — `media_index`, `recover_filename_dates`, `count_undated`.
- `src-tauri/src/commands/tags.rs` — `TagCard` DTO.

**Frontend — new**
- `src/features/gallery/hooks/useMediaIndex.ts`, `useMediaChunks.ts`
- `src/features/gallery/hooks/useDragSelect.ts`
- `src/features/gallery/components/DateScrubber/` (component, `.types.ts`, `.constants.ts`, test)
- `src/lib/media/timelineTicks.ts`
- `src/features/tags/components/AlbumCard/`

**Frontend — modified**
- `src/lib/media/layout.ts` — `buildLayout` takes geometry entries.
- `src/features/gallery/components/{VirtualGrid,Tile,JustifiedRow}` — placeholders, hover checkmark, pointer handlers.
- `src/features/gallery/GalleryPage.tsx` — wire index/chunks/scrubber/drag.
- `src/features/tags/TagsPage.tsx` — album grid.
- `src/features/settings/` — Metadata sub-page recovery action.

**Frontend — deleted**
- `src/features/gallery/hooks/useMediaInfinite.ts` (+ test)
- `src/features/gallery/hooks/useMediaCount.ts` (+ test)

---

### Task 1: `date_from_filename` — pure filename date parsing

**Files:**
- Create: `crates/dp-metadata/src/filename_date.rs`
- Modify: `crates/dp-metadata/src/lib.rs:1-14`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn date_from_filename(rel_path: &str) -> Option<chrono::DateTime<chrono::Utc>>`

**Context:** 11,398 of 17,405 rows in the real catalog have no EXIF `taken_at`, but 9,345 of those are WhatsApp exports named `IMG-YYYYMMDD-WA####.jpg`, which carry the true capture date. This function recovers it. It must be conservative: a false positive silently misfiles a photo, which is worse than leaving it undated.

- [ ] **Step 1: Write the failing tests**

Create `crates/dp-metadata/src/filename_date.rs` with only this test module (no implementation yet):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ymd(s: &str) -> Option<DateTime<Utc>> {
        Some(DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc))
    }

    #[test]
    fn parses_whatsapp_export() {
        assert_eq!(
            date_from_filename("Photos/whatsapp/IMG-20240816-WA0010.jpg"),
            ymd("2024-08-16T00:00:00+00:00")
        );
    }

    #[test]
    fn parses_whatsapp_video_export() {
        assert_eq!(
            date_from_filename("VID-20211203-WA0001.mp4"),
            ymd("2021-12-03T00:00:00+00:00")
        );
    }

    #[test]
    fn parses_screenshot_with_time() {
        assert_eq!(
            date_from_filename("youtube/Screenshot_20221225_0954.png"),
            ymd("2022-12-25T09:54:00+00:00")
        );
    }

    #[test]
    fn parses_camera_datetime() {
        assert_eq!(
            date_from_filename("DCIM/20190312_101530.jpg"),
            ymd("2019-03-12T10:15:30+00:00")
        );
    }

    #[test]
    fn parses_dashed_date() {
        assert_eq!(
            date_from_filename("trip/2019-03-12 sunset.jpg"),
            ymd("2019-03-12T00:00:00+00:00")
        );
    }

    // Guards against false positives — these are real paths from the
    // catalog that must NOT yield a date.
    #[test]
    fn rejects_resolution_in_filename() {
        assert_eq!(date_from_filename("Sujets/Purple_Nebula_03-1024x1024.png"), None);
        assert_eq!(date_from_filename("rtype-arcadeflier-255x360.jpg"), None);
    }

    #[test]
    fn rejects_impossible_dates() {
        // day 00 — real path `jpg_april_2023_20130700.jpg`
        assert_eq!(date_from_filename("Personal/jpg_april_2023_20130700.jpg"), None);
        // month 13
        assert_eq!(date_from_filename("IMG-20241301-WA0001.jpg"), None);
        // 31 February
        assert_eq!(date_from_filename("20230231_120000.jpg"), None);
    }

    #[test]
    fn rejects_years_outside_the_plausible_range() {
        assert_eq!(date_from_filename("scan_18750101.jpg"), None);
        assert_eq!(date_from_filename("scan_29990101.jpg"), None);
    }

    #[test]
    fn rejects_digit_runs_longer_than_a_date() {
        // A 9+ digit run is an id, not a date.
        assert_eq!(date_from_filename("photo_201903121.jpg"), None);
        assert_eq!(date_from_filename("1234567890.jpg"), None);
    }

    #[test]
    fn returns_none_when_no_date_present() {
        assert_eq!(date_from_filename("holiday/beach.jpg"), None);
    }

    #[test]
    fn uses_the_basename_not_the_directories() {
        // The folder carries a date-like run; the file does not. Directory
        // names describe a batch, not this photo — so no date.
        assert_eq!(date_from_filename("20190312_album/beach.jpg"), None);
    }

    #[test]
    fn takes_the_first_valid_date_in_the_basename() {
        assert_eq!(
            date_from_filename("IMG-20240816-WA0010-20250101.jpg"),
            ymd("2024-08-16T00:00:00+00:00")
        );
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cargo test -p dp-metadata filename_date
```
Expected: FAIL — `cannot find function date_from_filename in this scope`.

- [ ] **Step 3: Write the implementation**

Prepend to `crates/dp-metadata/src/filename_date.rs`:

```rust
//! Recovers a capture date from a file's own name.
//!
//! Many real photos carry no EXIF date at all — WhatsApp strips it on
//! export but names the file `IMG-YYYYMMDD-WA####`, and screenshots embed
//! the date the same way. This module reads that date back so those photos
//! land on the timeline instead of piling up under "Undated".
//!
//! It is deliberately conservative: a wrong date silently misfiles a
//! photo, which is worse than no date at all. Only the *basename* is
//! considered (a dated folder describes a batch, not each photo), digit
//! runs longer than a date are rejected as ids, and every candidate must
//! be a real calendar date in a plausible year.

use chrono::{DateTime, NaiveDate, TimeZone, Utc};

/// Years outside this range are rejected — before it, digital photos did
/// not exist; after it, the run is far more likely to be an id.
const MIN_YEAR: i32 = 1990;
const MAX_YEAR: i32 = 2100;

/// Parses a capture date out of `rel_path`'s basename, or `None` when the
/// name carries no plausible date. Time defaults to midnight UTC when the
/// name has only a date; `taken_at` is stored as UTC throughout the app.
pub fn date_from_filename(rel_path: &str) -> Option<DateTime<Utc>> {
    let name = rel_path.rsplit('/').next()?;
    let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);

    for run in digit_runs(stem) {
        if let Some(dt) = date_from_run(stem, run) {
            return Some(dt);
        }
    }
    // `YYYY-MM-DD`: three separate runs, so it needs its own pass.
    dashed_date(stem)
}

/// Byte ranges of every maximal run of ASCII digits in `s`.
fn digit_runs(s: &str) -> Vec<(usize, usize)> {
    let bytes = s.as_bytes();
    let mut runs = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            runs.push((start, i));
        } else {
            i += 1;
        }
    }
    runs
}

/// Interprets one digit run as a date. An 8-digit run is `YYYYMMDD`; a
/// 14-digit run is `YYYYMMDDHHMMSS`. An 8-digit run directly followed by
/// `_HHMM` or `_HHMMSS` (screenshot and camera conventions) picks the time
/// up from the next run. Every other length is rejected: shorter runs
/// cannot be a date, longer ones are ids.
fn date_from_run(stem: &str, (start, end): (usize, usize)) -> Option<DateTime<Utc>> {
    let run = &stem[start..end];
    match run.len() {
        8 => {
            let date = ymd(run)?;
            // An adjacent `_HHMM`/`_HHMMSS` run supplies the time.
            let rest = &stem[end..];
            let time = rest.strip_prefix('_').and_then(|r| {
                let t: String = r.chars().take_while(|c| c.is_ascii_digit()).collect();
                match t.len() {
                    4 => hms(&t[0..2], &t[2..4], "00"),
                    6 => hms(&t[0..2], &t[2..4], &t[4..6]),
                    _ => None,
                }
            });
            let (h, m, s) = time.unwrap_or((0, 0, 0));
            Utc.from_utc_datetime(&date.and_hms_opt(h, m, s)?).into()
        }
        14 => {
            let date = ymd(&run[0..8])?;
            let (h, m, s) = hms(&run[8..10], &run[10..12], &run[12..14])?;
            Utc.from_utc_datetime(&date.and_hms_opt(h, m, s)?).into()
        }
        _ => None,
    }
}

/// `YYYYMMDD` → a real calendar date in a plausible year.
fn ymd(run: &str) -> Option<NaiveDate> {
    let year: i32 = run[0..4].parse().ok()?;
    if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
        return None;
    }
    let month: u32 = run[4..6].parse().ok()?;
    let day: u32 = run[6..8].parse().ok()?;
    // `from_ymd_opt` rejects month 0/13 and day 0/31-February for us.
    NaiveDate::from_ymd_opt(year, month, day)
}

fn hms(h: &str, m: &str, s: &str) -> Option<(u32, u32, u32)> {
    let (h, m, s) = (h.parse().ok()?, m.parse().ok()?, s.parse().ok()?);
    (h < 24 && m < 60 && s < 60).then_some((h, m, s))
}

/// `YYYY-MM-DD` anywhere in the stem.
fn dashed_date(stem: &str) -> Option<DateTime<Utc>> {
    let bytes = stem.as_bytes();
    for i in 0..bytes.len().saturating_sub(9) {
        let window = &stem[i..i + 10];
        let b = window.as_bytes();
        let shaped = b[0..4].iter().all(u8::is_ascii_digit)
            && b[4] == b'-'
            && b[5..7].iter().all(u8::is_ascii_digit)
            && b[7] == b'-'
            && b[8..10].iter().all(u8::is_ascii_digit);
        if !shaped {
            continue;
        }
        // Reject a longer digit run bleeding in on either side.
        if i > 0 && bytes[i - 1].is_ascii_digit() {
            continue;
        }
        if bytes.get(i + 10).is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        let compact = format!("{}{}{}", &window[0..4], &window[5..7], &window[8..10]);
        if let Some(date) = ymd(&compact) {
            return Some(Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0)?));
        }
    }
    None
}
```

- [ ] **Step 4: Export it**

In `crates/dp-metadata/src/lib.rs`, add `mod filename_date;` to the module list (line 1-5, alphabetical: after `mod exiftool;`) and `pub use filename_date::date_from_filename;` to the exports (after the `parse` re-export).

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cargo test -p dp-metadata filename_date
```
Expected: PASS, 11 tests.

- [ ] **Step 6: Verify against the real catalog**

This proves the parser recovers what the spec claims and produces no absurd dates:

```bash
sqlite3 "$HOME/Library/Application Support/com.ahmed.drophoto/catalog.db" \
  "select rel_path from media where taken_at is null;" > /tmp/undated.txt
wc -l /tmp/undated.txt
```
Write a scratch `#[test] fn scratch_corpus()` that reads `/tmp/undated.txt`, runs `date_from_filename` on each line, and prints how many parsed plus the min/max year. Expected: **≥ 9,000 parsed**, all years between 2005 and 2026. Delete the scratch test before committing — it depends on a local file and must not enter the suite.

- [ ] **Step 7: Commit**

```bash
git add crates/dp-metadata/src/filename_date.rs crates/dp-metadata/src/lib.rs
git commit -m "feat(metadata): recover capture dates from filenames"
```

---

### Task 2: Apply recovered dates — scan path, backfill command, Settings action

**Files:**
- Modify: `crates/dp-jobs/src/scan.rs:791-798`
- Create: `crates/dp-catalog/src/index.rs` (the undated helpers; `media_index` lands here in Task 3)
- Modify: `crates/dp-catalog/src/lib.rs` (trait + impl + `mod index;`)
- Modify: `src-tauri/src/commands/media.rs`
- Modify: the Settings **Metadata** sub-page
- Test: `crates/dp-catalog/tests/undated.rs`

**Interfaces:**
- Consumes: `dp_metadata::date_from_filename`
- Produces:
  - `Catalog::list_undated(&self, limit: u32) -> DpResult<Vec<(i64, String)>>` — `(id, rel_path)` for rows with `taken_at IS NULL`, ordered by id.
  - `Catalog::set_taken_at_bulk(&self, rows: &[(i64, DateTime<Utc>)]) -> DpResult<u64>` — one transaction; updates **only** rows still `taken_at IS NULL`; returns rows changed.
  - `Catalog::count_undated(&self) -> DpResult<u64>`
  - Tauri commands `count_undated() -> u64` and `recover_filename_dates() -> u64`.

- [ ] **Step 1: Write the failing catalog test**

Create `crates/dp-catalog/tests/undated.rs`. Follow the existing harness in `crates/dp-catalog/tests/job_runs.rs` for building an in-memory catalog and inserting media (read it first and mirror its helpers exactly).

```rust
#[tokio::test]
async fn set_taken_at_bulk_fills_only_null_dates() {
    let cat = new_catalog().await;
    let drive = insert_drive(&cat, "D").await;
    // `insert_media` is the harness helper; the third argument is taken_at.
    let undated = insert_media(&cat, drive, "IMG-20240816-WA0010.jpg", None).await;
    let dated = insert_media(&cat, drive, "kept.jpg", Some(exif_date())).await;

    assert_eq!(cat.count_undated().await.unwrap(), 1);

    let recovered = Utc.with_ymd_and_hms(2024, 8, 16, 0, 0, 0).unwrap();
    let changed = cat
        .set_taken_at_bulk(&[(undated, recovered), (dated, recovered)])
        .await
        .unwrap();

    // Only the NULL row is written — the EXIF date is never overwritten.
    assert_eq!(changed, 1);
    assert_eq!(cat.get_media_with_drive(undated).await.unwrap().0.taken_at, Some(recovered));
    assert_eq!(cat.get_media_with_drive(dated).await.unwrap().0.taken_at, Some(exif_date()));
    assert_eq!(cat.count_undated().await.unwrap(), 0);
}

#[tokio::test]
async fn list_undated_returns_id_and_path() {
    let cat = new_catalog().await;
    let drive = insert_drive(&cat, "D").await;
    let id = insert_media(&cat, drive, "sub/IMG-20240816-WA0010.jpg", None).await;
    insert_media(&cat, drive, "dated.jpg", Some(exif_date())).await;

    let rows = cat.list_undated(100).await.unwrap();
    assert_eq!(rows, vec![(id, "sub/IMG-20240816-WA0010.jpg".to_string())]);
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cargo test -p dp-catalog --test undated
```
Expected: FAIL — no method `count_undated` on `dyn Catalog`.

- [ ] **Step 3: Implement the catalog side**

Create `crates/dp-catalog/src/index.rs`:

```rust
//! Read paths that serve the gallery's timeline: the undated-row helpers
//! behind filename date recovery, and (see `media_index`) the compact
//! whole-set index the grid's layout and date scrubber are built from.

use chrono::{DateTime, Utc};
use dp_core::DpResult;
use sqlx::SqlitePool;

use crate::db_err as db;
use crate::media::to_rfc3339;

pub(crate) async fn count_undated(pool: &SqlitePool) -> DpResult<u64> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE taken_at IS NULL")
        .fetch_one(pool)
        .await
        .map_err(db)?;
    Ok(count as u64)
}

pub(crate) async fn list_undated(pool: &SqlitePool, limit: u32) -> DpResult<Vec<(i64, String)>> {
    let rows: Vec<(i64, String)> =
        sqlx::query_as("SELECT id, rel_path FROM media WHERE taken_at IS NULL ORDER BY id LIMIT ?")
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(db)?;
    Ok(rows)
}

/// Writes recovered dates in one transaction. The `taken_at IS NULL`
/// guard is in the statement itself, not just the caller's selection: a
/// scan finishing mid-recovery could have filled a real EXIF date since
/// `list_undated` ran, and that date must win.
pub(crate) async fn set_taken_at_bulk(
    pool: &SqlitePool,
    rows: &[(i64, DateTime<Utc>)],
) -> DpResult<u64> {
    if rows.is_empty() {
        return Ok(0);
    }
    let mut tx = pool.begin().await.map_err(db)?;
    let mut changed = 0u64;
    for (id, taken_at) in rows {
        let result = sqlx::query("UPDATE media SET taken_at = ? WHERE id = ? AND taken_at IS NULL")
            .bind(to_rfc3339(Some(*taken_at)))
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        changed += result.rows_affected();
    }
    tx.commit().await.map_err(db)?;
    Ok(changed)
}
```

If `db_err`/`to_rfc3339` are not visible under those paths, match whatever `crates/dp-catalog/src/tags.rs` imports for the same purposes — do not invent new helpers.

Add `mod index;` to `crates/dp-catalog/src/lib.rs`, then the three trait methods (near `count_media_query`, line ~68) and their impls (near line ~311), each delegating to `index::`.

- [ ] **Step 4: Run the catalog tests**

```bash
cargo test -p dp-catalog --test undated
```
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire the scan path**

In `crates/dp-jobs/src/scan.rs`, change line 791 to bind `mut metadata` and insert the fallback immediately after the match:

```rust
    let (mut metadata, metadata_read_ok) = match deps.metadata.read(&file.path).await {
        Ok(m) => (m, true),
        Err(e) => {
            had_error = true;
            report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
            (MediaMetadata::default(), false)
        }
    };

    // Files with no EXIF date (WhatsApp exports, screenshots) still carry
    // their real capture date in the name. Applying the fallback here — to
    // `metadata` itself — means both `upsert_media` below and
    // `update_media_metadata` persist the same derived date, and a later
    // full rescan re-derives it rather than wiping it back to NULL.
    if metadata.taken_at.is_none() {
        metadata.taken_at = dp_metadata::date_from_filename(&rel);
    }
```

Add `dp-metadata` to `crates/dp-jobs/Cargo.toml` dependencies if it is not already there (check first — the crate already imports `dp_metadata::{sidecar_path, Sidecars}` in `sidecar_sync.rs`, so it almost certainly is).

- [ ] **Step 6: Add a scan regression test**

In `crates/dp-jobs/src/scan.rs`'s existing test module (or the scan integration test file, whichever the crate already uses for scan behavior — mirror its fake `MetadataProvider`), add:

```rust
#[tokio::test]
async fn scan_recovers_a_date_from_the_filename_when_exif_has_none() {
    // Fake metadata provider returns MediaMetadata::default() (taken_at: None).
    let (catalog, drive, dir) = scan_fixture().await;
    write_file(&dir, "IMG-20240816-WA0010.jpg");

    run_scan(&catalog, &drive).await;

    let row = only_media_row(&catalog).await;
    assert_eq!(
        row.taken_at,
        Some(Utc.with_ymd_and_hms(2024, 8, 16, 0, 0, 0).unwrap())
    );
}
```

Adapt the helper names to the fixtures that file already has — do not add new fixtures if equivalents exist.

- [ ] **Step 7: Add the Tauri commands**

In `src-tauri/src/commands/media.rs`, following the file's existing command style (state extraction, error mapping):

```rust
/// How many rows currently have no `taken_at` — the number the Settings
/// action offers to recover.
#[tauri::command]
pub async fn count_undated(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    state.catalog.count_undated().await.map_err(|e| e.to_string())
}

/// Fills `taken_at` from the filename for every row that has no date,
/// in batches so a large library doesn't build one enormous transaction.
/// Returns how many rows were actually given a date.
#[tauri::command]
pub async fn recover_filename_dates(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    const BATCH: u32 = 2000;
    let mut total = 0u64;
    loop {
        let batch = state.catalog.list_undated(BATCH).await.map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        let parsed: Vec<_> = batch
            .iter()
            .filter_map(|(id, path)| dp_metadata::date_from_filename(path).map(|d| (*id, d)))
            .collect();
        // Nothing in this batch was parseable — every following batch is
        // the same rows again, so stop rather than loop forever.
        if parsed.is_empty() {
            break;
        }
        total += state.catalog.set_taken_at_bulk(&parsed).await.map_err(|e| e.to_string())?;
    }
    Ok(total)
}
```

Register both in the `invoke_handler!` list in `src-tauri/src/lib.rs`.

> **Note the termination condition.** `list_undated` returns the *same* rows every call, because unparseable rows stay NULL forever. Breaking when a batch parses nothing is what makes this terminate. Do not replace it with an offset — a row that just got a date leaves the result set and would shift the window.

- [ ] **Step 8: Add the Settings action**

On the Settings **Metadata** sub-page, add a row beneath the existing tools section:

- Label: `PHOTOS WITHOUT A DATE`, value: the `count_undated` result.
- A button `RECOVER FROM FILENAMES`, disabled when the count is 0 or while running.
- On click: call `recover_filename_dates`, then `toast.success(\`Recovered dates for ${n} photos\`)` (or `toast.info("No dates could be recovered")` when `n === 0`), and invalidate the `count_undated` query plus the gallery's media queries.

Match the existing sub-page's markup, spacing, and uppercase-label conventions exactly — read a neighbouring row first.

- [ ] **Step 9: Write the frontend test**

Create a test beside the Metadata sub-page mirroring the existing settings tests' `mockIPC` style:

```tsx
it("recovers dates and reports how many", async () => {
  mockIPC((cmd) => {
    if (cmd === "count_undated") return 11398;
    if (cmd === "recover_filename_dates") return 9950;
    return undefined;
  });

  render(<MetadataSettings />, { wrapper });

  expect(await screen.findByText("11398")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /recover from filenames/i }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Recovered dates for 9950 photos"));
});
```

- [ ] **Step 10: Run all gates**

```bash
cargo test --workspace && pnpm vitest run && pnpm lint && pnpm typecheck
```
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add crates/ src-tauri/ src/features/settings/
git commit -m "feat(metadata): apply filename dates on scan and backfill existing rows"
```

- [ ] **Step 12: Run it on the real library**

Launch the app (`pnpm tauri dev`), open Settings → Metadata, and press RECOVER FROM FILENAMES. Expected: ~9,900 recovered, and the gallery's Undated section shrinks dramatically. **Record the actual number in the ledger** — the scrubber's value in Task 8 depends on it.

---

### Task 3: `MediaIndexEntry` and `Catalog::media_index`

**Files:**
- Modify: `crates/dp-core/src/types.rs` (after `MediaQuery`, ~line 560)
- Modify: `crates/dp-catalog/src/index.rs`
- Modify: `crates/dp-catalog/src/query.rs` (expose the shared clause builders)
- Modify: `crates/dp-catalog/src/lib.rs`
- Modify: `src-tauri/src/commands/media.rs`
- Test: `crates/dp-catalog/tests/media_index.rs`

**Interfaces:**
- Consumes: the existing `where_clause` / `order_by` helpers in `query.rs`.
- Produces:
  - `dp_core::MediaIndexEntry { id: i64, taken_at: Option<String>, width: Option<u32>, height: Option<u32>, kind: MediaKind }`
  - `Catalog::media_index(&self, q: &MediaQuery) -> DpResult<Vec<MediaIndexEntry>>`
  - Tauri command `media_index(query: MediaQuery) -> Vec<MediaIndexEntry>`

> **`taken_at` is an RFC3339 string, not epoch millis.** `MediaRow::taken_at` already serializes that way and the frontend's `monthKey`/`monthLabel` in `src/lib/media/format.ts` parse exactly that. A second date representation would be a bug factory for ~150 KB of savings. Measured cost with strings is 642 KB total.

- [ ] **Step 1: Write the failing test**

Create `crates/dp-catalog/tests/media_index.rs`, reusing the harness style of `crates/dp-catalog/tests/query.rs` (read it first):

```rust
/// The index is the gallery's source of positions: entry N must be the
/// same row `query_media` returns at `offset = N`, or every hydrated tile
/// lands in the wrong place.
#[tokio::test]
async fn index_order_matches_query_media_at_the_same_offsets() {
    let cat = seeded_catalog().await; // ≥ 25 rows, mixed taken_at incl. NULLs
    let q = MediaQuery { sort: MediaSort::TakenDesc, limit: 1000, offset: 0, ..Default::default() };

    let index = cat.media_index(&q).await.unwrap();
    let paged = cat.query_media(&q).await.unwrap();

    assert_eq!(index.len(), paged.len());
    for (i, entry) in index.iter().enumerate() {
        assert_eq!(entry.id, paged[i].0.id, "index position {i} disagrees");
    }
}

#[tokio::test]
async fn index_ignores_limit_and_offset() {
    let cat = seeded_catalog().await;
    let all = MediaQuery { limit: 1000, offset: 0, ..Default::default() };
    let narrow = MediaQuery { limit: 3, offset: 5, ..Default::default() };

    assert_eq!(
        cat.media_index(&all).await.unwrap().len(),
        cat.media_index(&narrow).await.unwrap().len()
    );
}

#[tokio::test]
async fn index_honors_every_filter() {
    let cat = seeded_catalog().await;
    for q in [
        MediaQuery { kinds: vec![MediaKind::Video], limit: 1000, ..Default::default() },
        MediaQuery { missing: Some(true), limit: 1000, ..Default::default() },
        MediaQuery { query: Some("beach".into()), limit: 1000, ..Default::default() },
    ] {
        let index = cat.media_index(&q).await.unwrap();
        let count = cat.count_media_query(&q).await.unwrap();
        assert_eq!(index.len() as u64, count, "index disagrees with count for {q:?}");
    }
}

#[tokio::test]
async fn index_carries_geometry_and_kind() {
    let cat = seeded_catalog().await;
    let entry = &cat.media_index(&Default::default()).await.unwrap()[0];
    assert!(entry.width.is_some() && entry.height.is_some());
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cargo test -p dp-catalog --test media_index
```
Expected: FAIL — no method `media_index`.

- [ ] **Step 3: Add the type**

In `crates/dp-core/src/types.rs`, after `MediaQuery`:

```rust
/// One row of the gallery's timeline index: the minimum needed to place a
/// tile in the justified layout and group it under a month header,
/// without the strings that make [`MediaItem`] expensive to send in bulk.
///
/// The gallery fetches one of these per matching row — the *whole*
/// filtered set, not a page — so that scroll height, the date scrubber's
/// offset→date mapping, and selection across not-yet-loaded photos are
/// exact rather than estimated. Measured at ~38 bytes/row.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MediaIndexEntry {
    pub id: i64,
    /// RFC3339, matching [`MediaRow::taken_at`]'s serialization exactly —
    /// the frontend parses both with the same helpers. `None` sorts last,
    /// the same `NULLS LAST` ordering `query_media` uses.
    pub taken_at: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub kind: MediaKind,
}
```

- [ ] **Step 4: Implement `media_index`**

In `crates/dp-catalog/src/query.rs`, make the existing `where_clause` and order-by helpers `pub(crate)` if they are not already. **Do not duplicate them** — the whole guarantee of this task is that the index and `query_media` compose identical SQL.

Add to `crates/dp-catalog/src/index.rs`:

```rust
/// Every row matching `q`, in `q`'s sort order, as compact index entries.
/// `q.limit`/`q.offset` are deliberately ignored: the caller wants the
/// whole set, and the same `MediaQuery` is reused for paged hydration.
pub(crate) async fn media_index(
    pool: &SqlitePool,
    q: &MediaQuery,
) -> DpResult<Vec<MediaIndexEntry>> {
    let (where_sql, binds) = crate::query::where_clause(q);
    let sql = format!(
        "SELECT m.id, m.taken_at, m.width, m.height, m.kind FROM media m {where_sql} {}",
        crate::query::order_by(q.sort)
    );
    let mut query = sqlx::query(&sql);
    for bind in binds {
        query = crate::query::bind_value(query, bind);
    }
    let rows = query.fetch_all(pool).await.map_err(db)?;
    rows.iter().map(row_to_index_entry).collect()
}
```

Mirror `query.rs`'s existing binding mechanism exactly — if it builds its binds differently (e.g. a closure or an enum), use that, and adapt the code above rather than introducing `bind_value`. Write `row_to_index_entry` beside it, mapping `kind` with the same helper `crates/dp-catalog/src/media.rs` uses.

Add the trait method and impl in `lib.rs` beside `count_media_query`.

- [ ] **Step 5: Run the tests**

```bash
cargo test -p dp-catalog --test media_index
```
Expected: PASS, 4 tests.

- [ ] **Step 6: Add the Tauri command**

```rust
/// The whole filtered set as compact index entries — the gallery's
/// timeline. Fetched in parallel with the first hydration chunk, so
/// nothing on screen waits for it.
#[tauri::command]
pub async fn media_index(
    state: tauri::State<'_, AppState>,
    query: MediaQuery,
) -> Result<Vec<MediaIndexEntry>, String> {
    state.catalog.media_index(&query).await.map_err(|e| e.to_string())
}
```

Register it in `invoke_handler!`.

- [ ] **Step 7: Measure it end to end**

Add a temporary `#[tokio::test]` (or a `dbg!` timing in the command) against the real catalog path, or simply run the app and time the IPC round trip in the devtools network/console. Record the number in the ledger. Expected ~40 ms for 17k rows. **If it exceeds 200 ms, stop and flag it** — the spec's documented trigger for switching to a progressive load.

- [ ] **Step 8: Commit**

```bash
git add crates/ src-tauri/
git commit -m "feat(catalog): compact whole-set media index for the gallery timeline"
```

---

### Task 4: Frontend swap — index + chunked hydration replace infinite paging

**Files:**
- Create: `src/features/gallery/hooks/useMediaIndex.ts`, `src/features/gallery/hooks/useMediaChunks.ts` (+ tests)
- Modify: `src/lib/media/layout.ts`, `src/lib/api/media.ts`, `src/features/gallery/components/VirtualGrid/*`, `src/features/gallery/components/Tile/*`, `src/features/gallery/components/JustifiedRow.tsx`, `src/features/gallery/GalleryPage.tsx`
- Delete: `src/features/gallery/hooks/useMediaInfinite.ts` (+ test), `src/features/gallery/hooks/useMediaCount.ts` (+ test)

**Interfaces:**
- Consumes: `media_index` command; `MediaIndexEntry`.
- Produces:
  - `useMediaIndex(): { entries: MediaIndexEntry[]; isLoading: boolean; isError: boolean; error: unknown }`
  - `useMediaChunks(visibleRange: { start: number; end: number }): (MediaItem | undefined)[]` — indexed **parallel to `entries`**; `undefined` where not yet hydrated.
  - `CHUNK_SIZE = 200`
  - `buildLayout(entries: LayoutEntry[], containerWidth: number, targetRowHeight: number): LayoutItem[]` where `LayoutEntry = { id: number; taken_at: string | null; width: number | null; height: number | null }`
  - `Tile` gains `item?: MediaItem` (undefined ⇒ placeholder).

> **This task must produce no visible change.** The gallery looks and behaves exactly as it does today. That is the whole point of sequencing it separately — a regression here is unambiguous.

- [ ] **Step 1: Write the failing hook tests**

`src/features/gallery/hooks/useMediaIndex.test.tsx`:

```tsx
it("fetches the whole filtered set with the store's filters", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "media_index") { args = a; return [entry(1), entry(2)]; }
    return undefined;
  });
  useGalleryStore.setState({ query: "beach", tagId: 7 });

  const { result } = renderHook(() => useMediaIndex(), { wrapper });

  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  expect(args).toMatchObject({ query: { query: "beach", tag_ids: [7] } });
});
```

`src/features/gallery/hooks/useMediaChunks.test.tsx`:

```tsx
it("fetches only the chunks covering the visible range", async () => {
  const offsets: number[] = [];
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      offsets.push((a as { query: { offset: number } }).query.offset);
      return [];
    }
    return undefined;
  });

  renderHook(() => useMediaChunks({ start: 250, end: 260 }), { wrapper });

  // 250-260 sits entirely inside chunk 1 (200-399).
  await waitFor(() => expect(offsets).toEqual([200]));
});

it("fetches both chunks when the range straddles a boundary", async () => {
  const offsets: number[] = [];
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      offsets.push((a as { query: { offset: number } }).query.offset);
      return [];
    }
    return undefined;
  });

  renderHook(() => useMediaChunks({ start: 190, end: 210 }), { wrapper });

  await waitFor(() => expect(offsets.sort((a, b) => a - b)).toEqual([0, 200]));
});

it("places hydrated items at their absolute index", async () => {
  mockIPC((cmd) => (cmd === "query_media" ? [item(11), item(12)] : undefined));

  const { result } = renderHook(() => useMediaChunks({ start: 200, end: 201 }), { wrapper });

  await waitFor(() => expect(result.current[200]?.row.id).toBe(11));
  expect(result.current[201]?.row.id).toBe(12);
  expect(result.current[0]).toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm vitest run src/features/gallery/hooks/useMediaIndex.test.tsx src/features/gallery/hooks/useMediaChunks.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write `useMediaIndex`**

```ts
import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { mediaIndex, type MediaIndexEntry } from "@/lib/api/media";
import { buildQuery, useGalleryStore } from "../store/galleryStore";

/**
 * The whole filtered set as compact entries — the gallery's timeline.
 *
 * Fetched in parallel with the first hydration chunk (see
 * `useMediaChunks`), never in front of it: the grid paints from chunk 0
 * as fast as it ever did, and the scrubber and cross-library selection
 * light up when this lands a beat later. Measured at ~40 ms for 17k rows.
 *
 * `limit`/`offset` are placeholders here — `media_index` ignores both by
 * design and always returns the whole set.
 */
export function useMediaIndex() {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const searchQuery = useGalleryStore((s) => s.query);
  const tagId = useGalleryStore((s) => s.tagId);

  const query = useQuery({
    queryKey: ["media-index", typeFilter, sort, missingOnly, searchQuery, tagId],
    queryFn: () =>
      mediaIndex(buildQuery({ typeFilter, sort, missingOnly, query: searchQuery, tagId }, 0, 0)),
    placeholderData: keepPreviousData,
  });

  return {
    entries: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}

/** Stable identity so `buildLayout`'s memo doesn't rerun on every render. */
const EMPTY: MediaIndexEntry[] = [];
```

Add `mediaIndex` to `src/lib/api/media.ts` beside `queryMedia`, following that file's `invoke` conventions, plus the `MediaIndexEntry` type.

- [ ] **Step 4: Write `useMediaChunks`**

```ts
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { queryMedia, type MediaItem } from "@/lib/api/media";
import { buildQuery, useGalleryStore } from "../store/galleryStore";

/**
 * Rows are hydrated in fixed, boundary-aligned chunks so that scrolling
 * reuses cached results instead of refetching a sliding window. Chunk
 * `c` is exactly `query_media` at `offset = c * CHUNK_SIZE`, which lines
 * up with the index because both compose the same filters and sort.
 */
export const CHUNK_SIZE = 200;

export function useMediaChunks(range: { start: number; end: number }): (MediaItem | undefined)[] {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const searchQuery = useGalleryStore((s) => s.query);
  const tagId = useGalleryStore((s) => s.tagId);

  const first = Math.max(0, Math.floor(range.start / CHUNK_SIZE));
  const last = Math.max(first, Math.floor(range.end / CHUNK_SIZE));
  const chunkIndices = useMemo(
    () => Array.from({ length: last - first + 1 }, (_, i) => first + i),
    [first, last],
  );

  const results = useQueries({
    queries: chunkIndices.map((chunk) => ({
      queryKey: ["media-chunk", typeFilter, sort, missingOnly, searchQuery, tagId, chunk],
      queryFn: () =>
        queryMedia(
          buildQuery(
            { typeFilter, sort, missingOnly, query: searchQuery, tagId },
            CHUNK_SIZE,
            chunk * CHUNK_SIZE,
          ),
        ),
      staleTime: 5 * 60 * 1000,
    })),
  });

  // A sparse array indexed parallel to the timeline index, so a tile at
  // index N reads `items[N]` with no offset arithmetic at the call site.
  return useMemo(() => {
    const items: (MediaItem | undefined)[] = [];
    results.forEach((result, i) => {
      const base = chunkIndices[i] * CHUNK_SIZE;
      result.data?.forEach((item, j) => {
        items[base + j] = item;
      });
    });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `results` is a
    // new array identity every render; the data it carries is keyed by the
    // chunk indices and the query keys, so those are the real dependencies.
  }, [chunkIndices, results.map((r) => r.dataUpdatedAt).join(",")]);
}
```

- [ ] **Step 5: Run the hook tests**

```bash
pnpm vitest run src/features/gallery/hooks/useMediaIndex.test.tsx src/features/gallery/hooks/useMediaChunks.test.tsx
```
Expected: PASS.

- [ ] **Step 6: Refactor `buildLayout` onto geometry**

In `src/lib/media/layout.ts`, replace the `MediaItem`-shaped input:

```ts
/** The minimum a tile needs to be *placed*; hydrated detail arrives separately. */
export type LayoutEntry = {
  id: number;
  taken_at: string | null;
  width: number | null;
  height: number | null;
};

export type Tile = { entry: LayoutEntry; width: number; height: number; index: number };
```

Update `tileRatio` to read `entry.width`/`entry.height` directly (not `item.row.*`), `buildLayout(entries: LayoutEntry[], ...)`, and the grouping to use `entries[i].taken_at` and `entry.id`. The month `ids` array stays `group.map((e) => e.id)`.

Update `src/lib/media/layout.test.ts` fixtures to the new shape. The layout's behavior must not change — if any existing layout assertion needs its *expected values* edited (as opposed to its fixture shape), stop: that is a real regression.

- [ ] **Step 7: Thread hydration through the grid**

- `Tile` takes `item?: MediaItem` alongside `tile`. When `item` is undefined, render the existing `bg-surface-2` box at `tile.width`/`tile.height` with no image, no badges, and `aria-busy="true"` — and skip the click handlers (a tile with no id-bearing item cannot be opened or toggled meaningfully; `tile.entry.id` still identifies it for selection, so selection *does* work — only `onOpen` is suppressed).
- `JustifiedRow` takes `items: (MediaItem | undefined)[]` and passes `items[tile.index]` down.
- `VirtualGrid` takes `entries: LayoutEntry[]` plus `items`, and reports its visible index range upward via a new `onRangeChange?: (range: { start: number; end: number }) => void`, computed from `virtualizer.getVirtualItems()` mapped through the layout rows to tile indices, widened by the existing overscan.

- [ ] **Step 8: Rewire `GalleryPage`**

Replace `useMediaInfinite` with `useMediaIndex` + `useMediaChunks`, driven by the range `VirtualGrid` reports. Delete `onNearEnd`/`fetchNextPage` wiring — there is no paging any more. Replace `useMediaCount()` with `entries.length`. Keyboard navigation, month-header select, and Shift+Arrow all now operate over `entries` rather than the loaded items array; their logic is unchanged, only the array they read.

- [ ] **Step 9: Delete the superseded hooks**

```bash
git rm src/features/gallery/hooks/useMediaInfinite.ts src/features/gallery/hooks/useMediaInfinite.test.tsx \
       src/features/gallery/hooks/useMediaCount.ts src/features/gallery/hooks/useMediaCount.test.tsx
```

Grep for any remaining reference to either and fix it:

```bash
grep -rn "useMediaInfinite\|useMediaCount" src/
```
Expected: no matches.

- [ ] **Step 10: Run the full frontend suite**

```bash
pnpm vitest run && pnpm lint && pnpm typecheck
```
Expected: all pass. Existing gallery tests may need their `mockIPC` handlers extended to answer `media_index` — that is expected; changing what a gallery test *asserts about behavior* is not.

- [ ] **Step 11: Verify by eye**

`pnpm tauri dev`, open the gallery. It must look and behave exactly as before: same grid, same month headers, same scroll feel, correct toolbar count, working search/filters/sort. Scroll to the very bottom — no loading stalls.

- [ ] **Step 12: Commit**

```bash
git add src/ && git commit -m "refactor(gallery): timeline index and chunked hydration replace infinite paging"
```

---

### Task 5: Google Photos selection — hover checkmark, selection mode, drag-select

**Files:**
- Create: `src/features/gallery/hooks/useDragSelect.ts` (+ test)
- Modify: `src/features/gallery/components/Tile/Tile.tsx`, `Tile.types.ts`
- Modify: `src/features/gallery/components/VirtualGrid/JustifiedRow.tsx`
- Modify: `src/features/gallery/GalleryPage.tsx`

**Interfaces:**
- Consumes: `entries` (from `useMediaIndex`), the gallery store's selection actions.
- Produces:
  - `useDragSelect({ entries, onApply }): { onCheckPointerDown(index, event), onTileEnter(index), isDragging }`
  - `Tile` gains `onCheckToggle: (index: number) => void`, `onCheckPointerDown`, `onPointerEnter`, `selectionMode: boolean`.

**Behavior (from the spec):**

| Gesture | Behavior |
| --- | --- |
| Hover a tile | Circular checkmark button fades in top-left |
| Click the checkmark | Toggles; never opens |
| Click tile body, not in selection mode | Opens the lightbox |
| Click tile body, in selection mode | Toggles |
| Shift+click | Range from anchor, over `entries` |
| Cmd/Ctrl+click | Toggles |
| Press checkmark and drag | Selects (or deselects) origin→current |
| Escape | Clears selection |

Selection mode is **derived**: `selectedIds.length > 0`. Nothing new persists.

- [ ] **Step 1: Write the failing `useDragSelect` tests**

```tsx
const entries = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, taken_at: null, width: 1, height: 1 }));

it("selects the range from origin to the tile under the pointer", () => {
  const onApply = vi.fn();
  const { result } = renderHook(() => useDragSelect({ entries, onApply }));

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(5));

  expect(onApply).toHaveBeenLastCalledWith({ ids: [3, 4, 5, 6], mode: "select" });
});

it("deselects when the origin tile was already selected", () => {
  const onApply = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, onApply, isSelected: (id) => id === 3 }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(4));

  expect(onApply).toHaveBeenLastCalledWith({ ids: [3, 4, 5], mode: "deselect" });
});

it("reverts tiles when the drag reverses back toward the origin", () => {
  const onApply = vi.fn();
  const { result } = renderHook(() => useDragSelect({ entries, onApply }));

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(6));
  act(() => result.current.onTileEnter(3));

  // The range shrinks — 5,6,7 are no longer part of it.
  expect(onApply).toHaveBeenLastCalledWith({ ids: [3, 4], mode: "select" });
});

it("selects backwards when dragging above the origin", () => {
  const onApply = vi.fn();
  const { result } = renderHook(() => useDragSelect({ entries, onApply }));

  act(() => result.current.onCheckPointerDown(5, pointerEvent()));
  act(() => result.current.onTileEnter(2));

  expect(onApply).toHaveBeenLastCalledWith({ ids: [3, 4, 5, 6], mode: "select" });
});

it("ends the drag when the pointer is released outside the grid", () => {
  const { result } = renderHook(() => useDragSelect({ entries, onApply: vi.fn() }));

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  expect(result.current.isDragging).toBe(true);

  act(() => { document.dispatchEvent(new Event("pointerup")); });
  expect(result.current.isDragging).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm vitest run src/features/gallery/hooks/useDragSelect.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useDragSelect`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutEntry } from "@/lib/media/layout";

export type DragApply = { ids: number[]; mode: "select" | "deselect" };

type Args = {
  entries: LayoutEntry[];
  onApply: (apply: DragApply) => void;
  /** Whether an id is currently selected — decides the drag's direction. */
  isSelected?: (id: number) => boolean;
};

/**
 * The Google Photos drag-select gesture: press a tile's checkmark and
 * sweep across its neighbours.
 *
 * The drag's *direction of effect* is fixed at its origin — if the origin
 * became selected the sweep selects, if it became deselected it
 * deselects. That is what makes reversing a drag undo it: the range is
 * recomputed from the origin every move rather than accumulated, so
 * pulling back releases the tiles it passed instead of stranding them.
 */
export function useDragSelect({ entries, onApply, isSelected }: Args) {
  const [isDragging, setIsDragging] = useState(false);
  const origin = useRef<number | null>(null);
  const mode = useRef<"select" | "deselect">("select");

  const onCheckPointerDown = useCallback(
    (index: number, event: { preventDefault: () => void }) => {
      // Stops the browser starting a native image drag mid-gesture.
      event.preventDefault();
      origin.current = index;
      mode.current = isSelected?.(entries[index].id) ? "deselect" : "select";
      setIsDragging(true);
      onApply({ ids: [entries[index].id], mode: mode.current });
    },
    [entries, isSelected, onApply],
  );

  const onTileEnter = useCallback(
    (index: number) => {
      const from = origin.current;
      if (from === null) return;
      const [lo, hi] = from <= index ? [from, index] : [index, from];
      onApply({ ids: entries.slice(lo, hi + 1).map((e) => e.id), mode: mode.current });
    },
    [entries, onApply],
  );

  // Listening on `document` (not the grid) means a release anywhere —
  // outside the window included — ends the gesture, so a drag can never
  // get stuck "live" after the mouse is already up.
  useEffect(() => {
    if (!isDragging) return;
    const end = () => {
      origin.current = null;
      setIsDragging(false);
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    return () => {
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };
  }, [isDragging]);

  return { onCheckPointerDown, onTileEnter, isDragging };
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm vitest run src/features/gallery/hooks/useDragSelect.test.tsx
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing Tile tests**

```tsx
it("shows a checkmark button that selects without opening", async () => {
  const onOpen = vi.fn();
  const onCheckToggle = vi.fn();
  render(<Tile {...props} onOpen={onOpen} onCheckToggle={onCheckToggle} />);

  await userEvent.click(screen.getByRole("button", { name: /select/i }));

  expect(onCheckToggle).toHaveBeenCalledWith(props.tile.index);
  expect(onOpen).not.toHaveBeenCalled();
});

it("opens on a body click when not in selection mode", async () => {
  const onOpen = vi.fn();
  render(<Tile {...props} selectionMode={false} onOpen={onOpen} />);

  await userEvent.click(screen.getByLabelText(props.item.row.rel_path));

  expect(onOpen).toHaveBeenCalledWith(props.tile.index);
});

it("toggles instead of opening on a body click in selection mode", async () => {
  const onOpen = vi.fn();
  const onToggle = vi.fn();
  render(<Tile {...props} selectionMode onOpen={onOpen} onToggle={onToggle} />);

  await userEvent.click(screen.getByLabelText(props.item.row.rel_path));

  expect(onToggle).toHaveBeenCalledWith(props.tile.index, false);
  expect(onOpen).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Implement the Tile changes**

In `Tile.tsx`:
- Add `draggable={false}` to the root so the browser's native image drag never competes with the gesture.
- Replace the `selected &&` check block with an always-mounted checkmark button, visible when `selected` or on hover:

```tsx
<button
  type="button"
  aria-label={selected ? "Deselect" : "Select"}
  aria-pressed={selected}
  data-testid="tile-check"
  className={cn(
    "absolute top-1.5 left-1.5 z-10 flex size-5 items-center justify-center rounded-full transition-opacity",
    selected
      ? "bg-foreground text-background opacity-100"
      : "bg-black/40 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
  )}
  onClick={(e) => {
    // The body handler below would otherwise open the lightbox too.
    e.stopPropagation();
    onCheckToggle(index);
  }}
  onPointerDown={(e) => {
    e.stopPropagation();
    onCheckPointerDown(index, e);
  }}
>
  <Check size={12} strokeWidth={2.5} />
</button>
```

- Change the body `onClick` so selection mode wins:

```tsx
onClick={(e) => {
  if (e.metaKey || e.ctrlKey) onToggle(index, false);
  else if (e.shiftKey) onToggle(index, true);
  else if (selectionMode) onToggle(index, false);
  else onOpen(index);
}}
```

- Add `onPointerEnter={() => onPointerEnter?.(index)}` to the root.
- When `item` is undefined (placeholder from Task 4), still render the checkmark — selection works on unhydrated tiles because `tile.entry.id` identifies them.

- [ ] **Step 7: Wire `GalleryPage`**

- `const selectionMode = selectedIds.length > 0;` — passed down through `VirtualGrid` → `JustifiedRow` → `Tile`.
- Instantiate `useDragSelect({ entries, onApply, isSelected })` where `onApply` calls `selectRange(ids)` for `"select"` and `deselectRange(ids)` for `"deselect"`.
- Escape already clears via the existing document keydown handler — confirm it calls `clearSelection()` and add it if not.

- [ ] **Step 8: Add edge auto-scroll during a drag**

In `VirtualGrid`, while `isDragging`, a `pointermove` within 60px of the scroll container's top or bottom edge scrolls by a `requestAnimationFrame` loop at up to 15px/frame, proportional to how deep into the zone the pointer is. Stop the loop when the drag ends or the pointer leaves the zone. Put the loop in its own `useEdgeAutoScroll` hook beside `VirtualGrid` so it is independently testable, and guard it with `prefers-reduced-motion` (respect it by scrolling without smoothing, not by disabling the feature).

- [ ] **Step 9: Run the gates**

```bash
pnpm vitest run && pnpm lint && pnpm typecheck
```

- [ ] **Step 10: Verify by hand**

`pnpm tauri dev`. Confirm each row of the behavior table above, then specifically: drag from a checkmark down past the bottom edge (the grid should auto-scroll and keep selecting), release outside the window (the drag must end), and press Escape (selection clears).

- [ ] **Step 11: Commit**

```bash
git add src/ && git commit -m "feat(gallery): hover checkmark, selection mode and drag-select"
```

---

### Task 6: Tags page as album cards

**Files:**
- Modify: `crates/dp-core/src/types.rs` (`TagWithCount`), `crates/dp-catalog/src/tags.rs:29-48`, `src-tauri/src/commands/tags.rs`
- Create: `src/features/tags/components/AlbumCard/` (component, `.types.ts`, `index.ts`, test)
- Modify: `src/features/tags/TagsPage.tsx`, `src/features/tags/hooks/useTagsWithCounts.ts`
- Delete: `src/features/tags/components/TagRow/` (+ test)
- Test: `crates/dp-catalog/tests/tags.rs` (extend the existing file)

**Interfaces:**
- Produces:
  - `TagWithCount` gains `pub cover_hash: Option<String>`
  - `TagCard { tag: Tag, count: u64, thumb_path: Option<String>, has_thumb: bool }` (command layer)
  - Frontend `AlbumCard` props: `{ card: TagCard; onOpen: () => void; onRename: () => void; onMerge: () => void; onDelete: () => void }`

- [ ] **Step 1: Write the failing catalog test**

Add to `crates/dp-catalog/tests/tags.rs`:

```rust
#[tokio::test]
async fn tags_with_counts_carry_the_newest_photos_hash_as_cover() {
    let cat = new_catalog().await;
    let drive = insert_drive(&cat, "D").await;
    let older = insert_media_with_hash(&cat, drive, "a.jpg", "hash-old", Some(ymd(2020, 1, 1))).await;
    let newer = insert_media_with_hash(&cat, drive, "b.jpg", "hash-new", Some(ymd(2024, 1, 1))).await;
    let tag = cat.create_tag("trip").await.unwrap();
    cat.tag_media(&[older, newer], &[tag], &[]).await.unwrap();

    let tags = cat.list_tags_with_counts().await.unwrap();
    let entry = tags.iter().find(|t| t.tag.id == tag).unwrap();

    assert_eq!(entry.count, 2);
    assert_eq!(entry.cover_hash.as_deref(), Some("hash-new"));
}

#[tokio::test]
async fn a_tag_with_no_media_has_no_cover() {
    let cat = new_catalog().await;
    let tag = cat.create_tag("empty").await.unwrap();

    let tags = cat.list_tags_with_counts().await.unwrap();
    let entry = tags.iter().find(|t| t.tag.id == tag).unwrap();

    assert_eq!(entry.count, 0);
    assert_eq!(entry.cover_hash, None);
}
```

Adapt helper names to whatever `tests/tags.rs` already defines; add `insert_media_with_hash` only if no equivalent exists.

- [ ] **Step 2: Run to verify it fails**

```bash
cargo test -p dp-catalog --test tags
```
Expected: FAIL — no field `cover_hash`.

- [ ] **Step 3: Implement the cover query**

Add the field to `TagWithCount` in `crates/dp-core/src/types.rs`:

```rust
    /// `hash` of the tag's newest photo — the album card's cover art. A
    /// cover is art, not a presence claim: a row whose file is currently
    /// missing still supplies one. `None` only when the tag has no media.
    pub cover_hash: Option<String>,
```

Rewrite the statement in `crates/dp-catalog/src/tags.rs:30-37`:

```rust
        "SELECT t.id AS id, t.name AS name, COUNT(mt.media_id) AS count, \
         (SELECT m.hash FROM media m \
            JOIN media_tags mt2 ON mt2.media_id = m.id \
           WHERE mt2.tag_id = t.id \
           ORDER BY m.taken_at DESC NULLS LAST, m.id DESC LIMIT 1) AS cover_hash \
         FROM tags t LEFT JOIN media_tags mt ON mt.tag_id = t.id \
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE",
```

and read it in the mapping closure with `r.try_get("cover_hash").map_err(db)?`.

- [ ] **Step 4: Run to verify it passes**

```bash
cargo test -p dp-catalog --test tags
```
Expected: PASS.

- [ ] **Step 5: Add the command DTO**

In `src-tauri/src/commands/tags.rs`, mirroring `media_item.rs`'s split (catalog returns hashes, the command layer resolves them through `ThumbStore`):

```rust
/// A tag as the Tags page renders it: an album card with cover art.
/// `thumb_path`/`has_thumb` are resolved here rather than in the catalog
/// for the same reason `to_item` does it — the thumbnail store is an
/// app-layer concern the catalog knows nothing about.
#[derive(serde::Serialize)]
pub struct TagCard {
    pub tag: Tag,
    pub count: u64,
    pub thumb_path: Option<String>,
    pub has_thumb: bool,
}
```

Map each `TagWithCount` in the existing `list_tags_with_counts` command:

```rust
        .map(|t| {
            let thumb_path = t.cover_hash.as_ref().map(|h| store.path(h, 400).to_string_lossy().into_owned());
            let has_thumb = t.cover_hash.as_ref().is_some_and(|h| store.exists(h, 400));
            TagCard { tag: t.tag, count: t.count, thumb_path, has_thumb }
        })
```

- [ ] **Step 6: Write the failing AlbumCard test**

```tsx
it("shows the cover, name and count, and opens on click", async () => {
  const onOpen = vi.fn();
  render(<AlbumCard card={{ tag: { id: 1, name: "Trip" }, count: 42, thumb_path: "/t/x.webp", has_thumb: true }} onOpen={onOpen} {...handlers} />);

  expect(screen.getByText("Trip")).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Trip" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /trip/i }));
  expect(onOpen).toHaveBeenCalled();
});

it("falls back to a placeholder when the tag has no cover", () => {
  render(<AlbumCard card={{ tag: { id: 2, name: "Empty" }, count: 0, thumb_path: null, has_thumb: false }} {...handlers} />);

  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByLabelText("No preview")).toBeInTheDocument();
});
```

- [ ] **Step 7: Build `AlbumCard`**

A square cover (`aspect-square`, `object-cover`), the same `ImageOff` placeholder the gallery uses when `has_thumb` is false or `thumb_path` is null, the name below in the app's existing card-title style, then the count. The whole card is one `button`; rename/merge/delete live in a shadcn `DropdownMenu` triggered by a `MoreHorizontal` button in the top-right corner that appears on hover — `e.stopPropagation()` on its trigger so opening the menu never navigates.

- [ ] **Step 8: Rebuild `TagsPage`**

Replace the `TagRow` list with a responsive grid (`grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]`) of `AlbumCard`. Add a sort control in the header with **Recently updated** (default), **Name**, **Count** — sorted client-side over the fetched list, since the whole list is already in memory. Reuse the three existing dialogs untouched. Keep the existing `setTagId` + navigate behavior for opening a tag.

"Recently updated" orders by the cover photo's recency, which the backend already sorts covers by; carry it as the list's natural order and sort the other two options in the client.

- [ ] **Step 9: Delete `TagRow`**

```bash
git rm -r src/features/tags/components/TagRow
grep -rn "TagRow" src/
```
Expected: no matches.

- [ ] **Step 10: Run the gates**

```bash
cargo test --workspace && pnpm vitest run && pnpm lint && pnpm typecheck
```

- [ ] **Step 11: Commit**

```bash
git add crates/ src-tauri/ src/ && git commit -m "feat(tags): album card grid with cover art"
```

---

### Task 7: The date-scrubbing scrollbar

**Files:**
- Create: `src/lib/media/timelineTicks.ts` (+ test)
- Create: `src/features/gallery/components/DateScrubber/` (component, `.types.ts`, `.constants.ts`, `index.ts`, test)
- Modify: `src/features/gallery/components/VirtualGrid/VirtualGrid.tsx`

**Interfaces:**
- Consumes: the layout (for header offsets), `entries` (for exact dates), the scroll element.
- Produces:
  - `buildTicks(layout: LayoutItem[], rowOffsets: number[], totalHeight: number, maxTicks: number): Tick[]`
  - `type Tick = { label: string; offsetRatio: number; isYearStart: boolean }`
  - `<DateScrubber scrollElement={el} ticks={ticks} dateAt={(ratio) => string} />`

- [ ] **Step 1: Write the failing tick tests**

```ts
it("emits a tick per month header at its proportional offset", () => {
  const layout = [header("March 2019"), row(), header("February 2019"), row()];
  const offsets = [0, 52, 252, 304];

  const ticks = buildTicks(layout, offsets, 504, 100);

  expect(ticks).toEqual([
    { label: "March 2019", offsetRatio: 0, isYearStart: true },
    { label: "February 2019", offsetRatio: 252 / 504, isYearStart: false },
  ]);
});

it("marks a tick as a year start when its year differs from the previous tick's", () => {
  const layout = [header("January 2020"), row(), header("December 2019"), row()];
  const ticks = buildTicks(layout, [0, 52, 252, 304], 504, 100);

  expect(ticks.map((t) => t.isYearStart)).toEqual([true, true]);
});

it("culls ticks down to maxTicks, always keeping the first and last", () => {
  const layout = Array.from({ length: 24 }, (_, i) => header(`Month ${i}`)).flatMap((h) => [h, row()]);
  const offsets = layout.map((_, i) => i * 50);

  const ticks = buildTicks(layout, offsets, 2400, 5);

  expect(ticks).toHaveLength(5);
  expect(ticks[0].label).toBe("Month 0");
  expect(ticks[4].label).toBe("Month 23");
});

it("returns no ticks for an empty layout", () => {
  expect(buildTicks([], [], 0, 10)).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm vitest run src/lib/media/timelineTicks.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildTicks`**

```ts
import type { LayoutItem } from "./layout";

export type Tick = { label: string; offsetRatio: number; isYearStart: boolean };

/**
 * Reduces the layout's month headers into positions along the scrubber
 * track. Offsets come from the virtualizer (real pixel positions), so a
 * tick sits exactly where its month begins — the whole reason the gallery
 * loads a full index rather than estimating.
 *
 * `maxTicks` caps how many labels render so they never overlap on a short
 * track; the first and last always survive so the track's ends stay
 * anchored to the library's real range.
 */
export function buildTicks(
  layout: LayoutItem[],
  rowOffsets: number[],
  totalHeight: number,
  maxTicks: number,
): Tick[] {
  if (totalHeight <= 0 || layout.length === 0) return [];

  const all: Tick[] = [];
  let previousYear: string | null = null;
  layout.forEach((item, i) => {
    if (item.kind !== "header") return;
    const year = item.label.split(" ").at(-1) ?? "";
    all.push({
      label: item.label,
      offsetRatio: (rowOffsets[i] ?? 0) / totalHeight,
      isYearStart: year !== previousYear,
    });
    previousYear = year;
  });

  return cull(all, maxTicks);
}

/** Keeps the first and last tick and spreads the rest evenly between them. */
function cull(ticks: Tick[], maxTicks: number): Tick[] {
  if (ticks.length <= maxTicks || maxTicks < 2) return ticks.slice(0, Math.max(maxTicks, 0));
  const step = (ticks.length - 1) / (maxTicks - 1);
  return Array.from({ length: maxTicks }, (_, i) => ticks[Math.round(i * step)]);
}
```

- [ ] **Step 4: Run to verify they pass**

```bash
pnpm vitest run src/lib/media/timelineTicks.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing DateScrubber tests**

```tsx
it("scrolls the element when the track is clicked", async () => {
  const el = scrollElementStub({ scrollHeight: 1000, clientHeight: 200 });
  render(<DateScrubber scrollElement={el} ticks={ticks} dateAt={() => "12 March 2019"} />);

  fireEvent.pointerDown(screen.getByTestId("scrubber-track"), { clientY: 50 });

  // Track is 200px tall; a click at its midpoint targets the middle of the
  // scrollable range (scrollHeight - clientHeight = 800).
  expect(el.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: "auto" });
});

it("shows the date for the dragged position", async () => {
  const el = scrollElementStub({ scrollHeight: 1000, clientHeight: 200 });
  render(<DateScrubber scrollElement={el} ticks={ticks} dateAt={() => "12 March 2019"} />);

  fireEvent.pointerDown(screen.getByTestId("scrubber-track"), { clientY: 50 });

  expect(screen.getByText("12 March 2019")).toBeInTheDocument();
});

it("renders a label for each year-start tick", () => {
  render(<DateScrubber scrollElement={scrollElementStub()} ticks={ticks} dateAt={() => ""} />);

  expect(screen.getByText("2019")).toBeInTheDocument();
  expect(screen.queryByText("February 2019")).not.toBeInTheDocument();
});

it("exposes the handle as a slider with the date as its value text", () => {
  render(<DateScrubber scrollElement={scrollElementStub()} ticks={ticks} dateAt={() => "12 March 2019"} />);

  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "12 March 2019");
});
```

- [ ] **Step 6: Build `DateScrubber`**

- Absolutely positioned on the scroll container's right edge, full height, `w-2` at rest widening to `w-14` on hover or while dragging (`transition-[width]`, skipped under `prefers-reduced-motion`).
- Year labels rendered only for ticks with `isYearStart`, positioned at `top: ${offsetRatio * 100}%`, fading in with the track.
- A handle at `scrollTop / (scrollHeight - clientHeight)`, carrying `role="slider"`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-valuenow`, and `aria-valuetext={dateAt(ratio)}`.
- `pointerdown` on the track or handle: `setPointerCapture`, map `clientY` to a ratio against the track's `getBoundingClientRect()`, call `scrollElement.scrollTo({ top: ratio * (scrollHeight - clientHeight), behavior: "auto" })`, and show the date pill. `pointermove` while captured repeats it; `pointerup` releases and hides the pill.
- Constants (`TRACK_WIDTH_REST`, `TRACK_WIDTH_ACTIVE`, `MIN_LABEL_SPACING_PX`, `EDGE_PADDING_PX`) go in `DateScrubber.constants.ts`.

- [ ] **Step 7: Hide the native scrollbar and mount the scrubber**

In `VirtualGrid.tsx`, add a `scrollbar-none` utility to the scroll element (define it in the app's Tailwind layer if it does not exist: `scrollbar-width: none` plus `&::-webkit-scrollbar { display: none }`) and render `<DateScrubber>` as a sibling inside the relatively-positioned wrapper.

Compute `dateAt(ratio)` in `GalleryPage`: map the ratio to a scroll offset, find the last layout row whose offset is ≤ it, take its first tile's `index`, and format `entries[index].taken_at` with a full-date formatter (add `formatFullDate(takenAt: string | null): string` to `src/lib/media/format.ts`, returning `"Undated"` for null, using UTC getters like its neighbours).

- [ ] **Step 8: Run the gates**

```bash
pnpm vitest run && pnpm lint && pnpm typecheck
```

- [ ] **Step 9: Verify by hand**

`pnpm tauri dev`. The track should be quiet at rest, widen on hover with year labels appearing, and dragging should fly through the library with the pill showing real dates. Confirm the wheel, trackpad, keyboard and Page Up/Down still scroll normally.

- [ ] **Step 10: Commit**

```bash
git add src/ && git commit -m "feat(gallery): date-scrubbing scrollbar"
```

---

### Task 8: Finalize and release

**Files:** `package.json`, `Cargo.toml`, `src-tauri/tauri.conf.json` (version fields only)

- [ ] **Step 1: Run the complete gate on the final commit**

```bash
pnpm lint && pnpm typecheck && pnpm test:coverage \
  && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings \
  && cargo test --workspace && pnpm tauri build --debug --no-bundle
```
Expected: all green. Capture the output — it is the PR's test evidence, since no CI runs.

- [ ] **Step 2: Bump to 0.8.0 with the stash dance**

The dev-port edits must never be committed:

```bash
git stash push -m "dev-port edits (do not commit)" src-tauri/tauri.conf.json vite.config.ts
# edit the three "version" fields: package.json, Cargo.toml, src-tauri/tauri.conf.json
cargo check -p drophoto --quiet
git add Cargo.toml Cargo.lock package.json src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.8.0"
git stash pop
```

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/41-phase7-google-photos-ux
gh pr create --base main \
  --title "feat: filename dates, timeline index, GP selection, album cards, date scrubber (Phase 7)" \
  --body-file <(printf 'Closes #41\n\n...summary + the Step 1 gate output as a table...')
```

- [ ] **Step 4: Squash-merge**

```bash
gh pr merge <N> --squash --delete-branch
```

If it reports a local checkout failure, **the merge still landed** — the uncommitted dev-port edits block the local branch switch. Verify with `gh pr view <N> --json state`, then stash, `git checkout main && git pull`, and pop.

- [ ] **Step 5: Release v0.8.0**

`scripts/release.sh` does **not** create the GitHub release — it only uploads into an existing one. Create it first, and eject any mounted drophoto DMG (`ls /Volumes | grep -i drop`, then `hdiutil detach`) or `bundle_dmg.sh` fails:

```bash
gh release create v0.8.0 --title "drophoto v0.8.0" --notes-file <notes>
git stash push -m "dev-port edits" src-tauri/tauri.conf.json vite.config.ts
scripts/release.sh 0.8.0
git stash pop
```

Then confirm the feed serves the new version anonymously:

```bash
curl -sL https://github.com/AhmedFr/drophoto/releases/latest/download/latest.json | head -3
```

- [ ] **Step 6: Update memory and delete the SDD workspace**

Append a Phase 7 entry to `phase1-followups.md` covering: the date-coverage finding (35% EXIF, mtime rejected with the data, ~9.9k recovered from filenames), the index/chunk architecture and its measured cost, and any parked findings. Then `rm -rf .superpowers/sdd/2026-09-05-phase7-google-photos-ux`.

---

## Self-Review

**Spec coverage.** Part 1 timeline index → Tasks 3–4. Part 2 selection → Task 5. Part 3 tags as albums → Task 6. Part 4 date scrubber → Task 7. The date-recovery addition agreed after the spec was written → Tasks 1–2 (the spec is updated to match in the same commit as this plan). Global constraints → carried verbatim above. Out-of-scope list → nothing in these tasks touches faces, real albums, day grouping, the lightbox, Places, or the organize flow.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Two steps deliberately say "mirror the existing harness/binding mechanism" (Task 2 Step 1, Task 3 Step 4) rather than inventing fixture and binding APIs I cannot see from here — each names the exact file to read first.

**Type consistency.** `MediaIndexEntry` (Task 3) is consumed by `useMediaIndex` (Task 4) and `LayoutEntry` (Task 4) and `useDragSelect` (Task 5) under the same field names. `CHUNK_SIZE = 200` is defined once in Task 4 and used by its own tests. `TagWithCount.cover_hash` (Task 6 Step 3) feeds `TagCard` (Step 5) feeds `AlbumCard` (Step 7). `Tick` is defined in Task 7 Step 3 and consumed by `DateScrubber` in Step 6. `buildLayout`'s new signature (Task 4 Step 6) is what `buildTicks` reads in Task 7.

**One risk worth restating for the executor:** Task 4 must produce **no visible change**. If the gallery looks or behaves differently after it, that is a regression to fix before Task 5 — not a new baseline to accept.
