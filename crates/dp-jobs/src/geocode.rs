//! [`GeocodeJob`] reverse-geocodes every media row that has GPS
//! coordinates but no assigned place (see
//! `dp_catalog::Catalog::list_ungeocoded`): for each row, looks up the
//! nearest [`dp_places::City`] within [`MAX_REVERSE_KM`] via
//! [`dp_places::Geocoder::reverse`], and if one is found, upserts a
//! [`dp_core::Place`] for it — deduped by `(name, admin, country,
//! source)`, see `Catalog::upsert_place` — and assigns it to the row via
//! `Catalog::set_media_place`. A row with no city in range is simply left
//! alone: it gains no `place_id`, so it comes right back in
//! `list_ungeocoded`'s result set next time this job runs (there's no
//! "don't retry" flag to set — only assigning *any* place, geocoder or
//! manual, ever removes a row from that set).
//!
//! Unlike the per-drive jobs (`ScanJob`, `SidecarSyncJob`, ...), this job
//! is GLOBAL — one sweep covers every drive's media in a single run — so
//! `AppState::start_geocode` admits it under a sentinel `drive_id` of `0`
//! rather than a real drive id (see that function's doc comment): the
//! effect is that at most one geocode job ever runs at a time across the
//! whole app, and it never conflicts with (or is blocked by) any per-drive
//! job, which are tracked under their own real drive ids.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::{DpError, DpResult, MediaRow, NewPlace, PlaceSource};
use dp_places::Geocoder;
use futures::FutureExt;

use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome};

/// Media rows farther than this from every bundled city are left
/// ungeocoded rather than assigned to a distant "nearest" match.
const MAX_REVERSE_KM: f64 = 50.0;

/// Default number of ungeocoded rows to fetch per drain pass — mirrors
/// `SidecarSyncJob`'s per-pass batching via `list_sidecar_pending`, though
/// unlike that job's re-fetch-the-same-query loop, each pass here advances
/// a cursor (see [`GeocodeJob::run_inner`]) rather than re-fetching the
/// same window. Overridable via [`GeocodeJob::with_batch_size`], mainly so
/// tests can exercise multi-batch draining without needing a
/// `DEFAULT_BATCH_SIZE`-sized fixture.
const DEFAULT_BATCH_SIZE: u32 = 500;

/// External dependencies a [`GeocodeJob`] needs, injected so tests can
/// swap in a fake, deterministic [`Geocoder`].
pub struct GeocodeDeps {
    pub catalog: Arc<dyn Catalog>,
    pub geocoder: Arc<dyn Geocoder>,
}

/// A [`Job`] that reverse-geocodes every media row with GPS coordinates
/// but no place yet — see the module doc comment. GLOBAL: not scoped to a
/// drive, and admitted under a sentinel drive id by `AppState::start_geocode`.
pub struct GeocodeJob {
    id: String,
    deps: GeocodeDeps,
    batch_size: u32,
    ok: AtomicU64,
    failed: AtomicU64,
    skipped: AtomicU64,
}

impl GeocodeJob {
    pub fn new(id: String, deps: GeocodeDeps) -> Self {
        Self {
            id,
            deps,
            batch_size: DEFAULT_BATCH_SIZE,
            ok: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            skipped: AtomicU64::new(0),
        }
    }

    /// Overrides the per-fetch page size (default [`DEFAULT_BATCH_SIZE`]).
    /// Exposed publicly mainly for tests, so a multi-batch drain can be
    /// exercised against a handful of rows instead of hundreds.
    pub fn with_batch_size(mut self, batch_size: u32) -> Self {
        self.batch_size = batch_size;
        self
    }
}

#[async_trait]
impl Job for GeocodeJob {
    fn id(&self) -> &str {
        &self.id
    }

    /// Same panic-safety rationale as [`crate::SidecarSyncJob::run`]: a
    /// panic partway through still surfaces as a clean `Err`, letting the
    /// runner report it rather than silently dropping the job.
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        match std::panic::AssertUnwindSafe(self.run_inner(&ctx))
            .catch_unwind()
            .await
        {
            Ok(result) => result,
            Err(_panic) => Err(DpError::Io {
                message: "job panicked".into(),
                path: None,
            }),
        }
    }
}

impl GeocodeJob {
    async fn run_inner(&self, ctx: &JobCtx) -> DpResult<JobOutcome> {
        // Cursor-paginated drain, *not* a re-fetch-the-same-query loop
        // like `SidecarSyncJob::run_inner`: `list_ungeocoded` is ordered
        // by `id`, and each pass asks for `id > last_seen_id` rather than
        // re-running the same `LIMIT batch_size` window. That distinction
        // matters because a row this job can't place (no city in range)
        // never gains a `place_id` and so never leaves the underlying
        // predicate — a naive re-fetch-the-same-window loop would see that
        // row again on every pass and either loop forever or (with an
        // attempted-set filtering it back out) stop as soon as one page is
        // entirely unplaceable, silently stranding every row past it,
        // this run *and* every future run. Advancing the cursor past a
        // row the moment it's been looked at — regardless of outcome —
        // means the loop always makes forward progress and terminates
        // exactly when a fetch comes back empty, with no separate
        // "already tried this one" bookkeeping needed.
        let mut last_seen_id = 0i64;
        let mut done = 0u64;
        let mut cancelled = false;

        'sweep: loop {
            if ctx.cancel.is_cancelled() {
                cancelled = true;
                break;
            }

            let rows: Vec<MediaRow> = self
                .deps
                .catalog
                .list_ungeocoded(last_seen_id, self.batch_size)
                .await?;
            if rows.is_empty() {
                break;
            }

            // `total` only ever covers what's been fetched so far, then
            // grows by a batch each pass — there's no cheap way to know
            // the true total up front without a separate count query, so
            // progress here reports "at least this many" rather than a
            // stable final total; same trade-off `SidecarSyncJob` makes.
            let total = done + rows.len() as u64;
            for row in &rows {
                if ctx.cancel.is_cancelled() {
                    cancelled = true;
                    break 'sweep;
                }

                last_seen_id = row.id;
                self.geocode_row(ctx, row).await;

                done += 1;
                let _ = ctx
                    .events
                    .send(JobEvent::Progress {
                        job_id: self.id.clone(),
                        done,
                        total,
                        current: Some(row.rel_path.clone()),
                    })
                    .await;
            }
        }

        let (ok, failed, skipped) = self.totals();
        Ok(JobOutcome {
            ok,
            failed,
            skipped,
            cancelled,
        })
    }

    /// The `(ok, failed, skipped)` tallies applied so far.
    fn totals(&self) -> (u64, u64, u64) {
        (
            self.ok.load(Ordering::Relaxed),
            self.failed.load(Ordering::Relaxed),
            self.skipped.load(Ordering::Relaxed),
        )
    }

    /// Resolves one row: looks up the nearest city within
    /// [`MAX_REVERSE_KM`] and, if found, upserts + assigns its
    /// [`dp_core::Place`] (tallied `ok`); otherwise tallies the row
    /// `skipped` and leaves it alone. A catalog failure partway through
    /// (the upsert or the assignment) tallies `failed` and emits a
    /// matching `ItemError` — same shape as
    /// `SidecarSyncJob::record_failed`.
    async fn geocode_row(&self, ctx: &JobCtx, row: &MediaRow) {
        // `list_ungeocoded` only ever returns rows with both set, but
        // guard anyway rather than unwrap.
        let (lat, lon) = match (row.lat, row.lon) {
            (Some(lat), Some(lon)) => (lat, lon),
            _ => {
                self.skipped.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };

        let city = match self.deps.geocoder.reverse(lat, lon, MAX_REVERSE_KM) {
            Some(city) => city,
            None => {
                self.skipped.fetch_add(1, Ordering::Relaxed);
                return;
            }
        };

        let new_place = NewPlace {
            lat: city.lat,
            lon: city.lon,
            name: city.name.clone(),
            admin: city.admin.clone(),
            country: city.country.clone(),
            source: PlaceSource::Geocoder,
        };

        let place = match self.deps.catalog.upsert_place(new_place).await {
            Ok(place) => place,
            Err(e) => {
                self.record_failed(ctx, row, &e).await;
                return;
            }
        };

        if let Err(e) = self.deps.catalog.set_media_place(&[row.id], Some(place.id)).await {
            self.record_failed(ctx, row, &e).await;
            return;
        }

        self.ok.fetch_add(1, Ordering::Relaxed);
    }

    /// Records one row's geocode as failed: bumps the tally and emits a
    /// matching `ItemError` event.
    async fn record_failed(&self, ctx: &JobCtx, row: &MediaRow, e: &DpError) {
        self.failed.fetch_add(1, Ordering::Relaxed);
        let _ = ctx
            .events
            .send(JobEvent::ItemError {
                job_id: self.id.clone(),
                path: row.rel_path.clone(),
                code: error_code(e).to_string(),
                message: e.to_string(),
            })
            .await;
    }
}
