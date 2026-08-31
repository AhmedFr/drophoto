-- Per-job run metrics: one row per terminal job run (done/cancelled/failed),
-- recorded by `dp_jobs::JobRunner` via `Catalog::record_job_run`. Not tied to
-- `organize_jobs` (which only ever covers organize/revert) — this covers
-- every job kind (scan, organize, revert, sidecar, geocode).
CREATE TABLE job_runs (
    id INTEGER PRIMARY KEY,
    job_id TEXT NOT NULL,            -- "scan-3"
    kind TEXT NOT NULL,              -- prefix: scan|organize|revert|sidecar|geocode
    drive_id INTEGER,                -- NULL for global jobs
    status TEXT NOT NULL,            -- done|cancelled|failed
    ok INTEGER NOT NULL, failed INTEGER NOT NULL, skipped INTEGER NOT NULL,
    bytes_read INTEGER NOT NULL DEFAULT 0,
    bytes_written INTEGER NOT NULL DEFAULT 0,
    cpu_ms INTEGER NOT NULL DEFAULT 0,      -- process rusage delta (user+sys)
    started_at TEXT NOT NULL, finished_at TEXT NOT NULL
);

-- The source file's on-disk modification time, captured by the scan that
-- last wrote each row (`symlink_metadata().modified()`). Drives the
-- incremental-rescan skip check in `dp_jobs::ScanJob`: a walked file whose
-- stat size/mtime match the stored row (and whose thumbnails already
-- exist) is skipped without re-hashing. NULL for rows written before this
-- column existed, which never matches and so always gets fully
-- reprocessed once.
ALTER TABLE media ADD COLUMN mtime TEXT;
