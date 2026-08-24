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

use std::collections::HashSet;
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

/// How many ungeocoded rows to fetch per drain pass — mirrors
/// `SidecarSyncJob`'s per-pass batching via `list_sidecar_pending`.
const BATCH_SIZE: u32 = 500;

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
    ok: AtomicU64,
    failed: AtomicU64,
    skipped: AtomicU64,
}

impl GeocodeJob {
    pub fn new(id: String, deps: GeocodeDeps) -> Self {
        Self {
            id,
            deps,
            ok: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            skipped: AtomicU64::new(0),
        }
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
        // Same re-fetch-until-empty shape as `SidecarSyncJob::run_inner`:
        // a row that gains GPS (or is newly imported) while this sweep is
        // in flight is picked up in the same run rather than waiting for
        // the next trigger.
        //
        // `attempted` is what keeps a row with no city in range — which
        // never gains a `place_id` and so never leaves
        // `list_ungeocoded`'s result set — from spinning the loop
        // forever: it's looked at exactly once per run, tallied
        // `skipped`, and filtered out of every subsequent fetch.
        let mut attempted: HashSet<i64> = HashSet::new();
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
                .list_ungeocoded(BATCH_SIZE)
                .await?
                .into_iter()
                .filter(|row| !attempted.contains(&row.id))
                .collect();
            if rows.is_empty() {
                break;
            }

            let total = done + rows.len() as u64;
            for row in &rows {
                if ctx.cancel.is_cancelled() {
                    cancelled = true;
                    break 'sweep;
                }

                attempted.insert(row.id);
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
