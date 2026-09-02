use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Volume {
    pub name: String,
    pub mount_path: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub is_removable: bool,
    /// The volume's Apple `VolumeUUID` (macOS only; `None` on every other
    /// platform, and `None` on macOS if `diskutil` couldn't be read for
    /// this mount) — the strongest identity signal `resolve_presence` has
    /// for matching a reconnected drive back to its registered row,
    /// stronger than the volume's display name (which the user can
    /// rename) or its mount path (which can shift between reconnects).
    pub uuid: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Copy, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriveRole {
    Source,
    Archive,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Drive {
    pub id: i64,
    pub name: String,
    pub volume_uuid: Option<String>,
    /// The mounted volume's own display name (`Volume::name`) as of the
    /// last successful presence match — independent of `name`, which is
    /// the user-chosen label shown in the UI and can differ from it (see
    /// `dp_volumes::resolve_presence`). `None` until the drive has been
    /// matched to a volume at least once (registration, or a later
    /// presence-resolve self-heal for a legacy row).
    pub volume_label: Option<String>,
    pub mount_path: Option<String>,
    pub role: DriveRole,
    pub capacity: u64,
    pub free: u64,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub online: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NewDrive {
    pub name: String,
    pub mount_path: String,
    pub role: DriveRole,
    pub capacity: u64,
    pub free: u64,
    /// The volume's `VolumeUUID`/display name at registration time,
    /// captured independently of `name` (the user-chosen label) — see
    /// `Drive::volume_label`. `None` on non-macOS or when the volume
    /// couldn't be read.
    pub volume_uuid: Option<String>,
    pub volume_label: Option<String>,
}

/// A configured scan root within a drive: `mount_path/rel_path` (or the
/// mount root itself, when `rel_path` is empty). A drive scan walks every
/// *enabled* source rather than the whole mount, and every media row
/// scanned from a source carries that source's `id` (see
/// [`MediaRow::source_id`]).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Source {
    pub id: i64,
    pub drive_id: i64,
    pub rel_path: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NewSource {
    pub drive_id: i64,
    pub rel_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Copy, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaKind {
    Photo,
    Video,
}

impl MediaKind {
    /// Maps a file extension (case-insensitive) to its `MediaKind` and canonical
    /// (lowercase) extension string.
    pub fn from_ext(ext: &str) -> Option<(MediaKind, &'static str)> {
        match ext.to_ascii_lowercase().as_str() {
            "jpg" => Some((MediaKind::Photo, "jpg")),
            "jpeg" => Some((MediaKind::Photo, "jpeg")),
            "png" => Some((MediaKind::Photo, "png")),
            "tif" => Some((MediaKind::Photo, "tif")),
            "tiff" => Some((MediaKind::Photo, "tiff")),
            "webp" => Some((MediaKind::Photo, "webp")),
            "heic" => Some((MediaKind::Photo, "heic")),
            "heif" => Some((MediaKind::Photo, "heif")),
            "raf" => Some((MediaKind::Photo, "raf")),
            "cr2" => Some((MediaKind::Photo, "cr2")),
            "cr3" => Some((MediaKind::Photo, "cr3")),
            "arw" => Some((MediaKind::Photo, "arw")),
            "nef" => Some((MediaKind::Photo, "nef")),
            "dng" => Some((MediaKind::Photo, "dng")),
            "orf" => Some((MediaKind::Photo, "orf")),
            "rw2" => Some((MediaKind::Photo, "rw2")),
            "mp4" => Some((MediaKind::Video, "mp4")),
            "mov" => Some((MediaKind::Video, "mov")),
            "m4v" => Some((MediaKind::Video, "m4v")),
            _ => None,
        }
    }
}

/// A user-defined label, applied to media rows via `media_tags`. Names are
/// unique case-insensitively (see the `tags` table's `COLLATE NOCASE`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

/// Where a [`Place`] came from: `Geocoder` rows are found-or-created by
/// `Catalog::upsert_place` (deduped by name/admin/country) as the reverse
/// geocode job resolves GPS coordinates; `Manual` rows are the user's own
/// pick and are never touched by that job again — see
/// `Catalog::list_ungeocoded`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Copy, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlaceSource {
    Geocoder,
    Manual,
}

/// A named location — reverse-geocoded from a media row's `lat`/`lon`, or
/// entered manually — that one or more media rows can be tagged with via
/// [`MediaRow::place_id`].
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Place {
    pub id: i64,
    pub lat: f64,
    pub lon: f64,
    pub name: String,
    pub admin: Option<String>,
    pub country: String,
    pub source: PlaceSource,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NewPlace {
    pub lat: f64,
    pub lon: f64,
    pub name: String,
    pub admin: Option<String>,
    pub country: String,
    pub source: PlaceSource,
}

/// A [`Place`] paired with how many media rows currently reference it —
/// the shape the map/list view of places needs. `Catalog::list_place_counts`
/// only ever returns places with `count >= 1`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PlaceCount {
    pub place: Place,
    pub count: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MediaRow {
    pub id: i64,
    pub drive_id: i64,
    pub rel_path: String,
    pub hash: String,
    pub size: u64,
    pub kind: MediaKind,
    pub ext: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub taken_at: Option<DateTime<Utc>>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub aperture: Option<f64>,
    pub shutter: Option<f64>,
    pub iso: Option<u32>,
    pub focal_mm: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub missing_at: Option<DateTime<Utc>>,
    pub organized_at: Option<DateTime<Utc>>,
    /// The [`Source`] this row was scanned from, if any. `None` for rows
    /// scanned before sources existed, or otherwise not attributable to a
    /// configured source.
    pub source_id: Option<i64>,
    /// Whether this row's tags have changed since its sidecar file was
    /// last written — set by `Catalog::tag_media` when a tag link
    /// actually changes, cleared by `Catalog::clear_sidecar_pending` once
    /// the sidecar has been rewritten.
    pub sidecar_pending: bool,
    /// The resolved [`Place`] for this row's `lat`/`lon`, if any — set by
    /// `Catalog::set_media_place` (either the reverse-geocode job or a
    /// manual pick). `None` here also means "not yet geocoded"; see
    /// [`Catalog::list_ungeocoded`] for how that state is detected.
    pub place_id: Option<i64>,
    /// The source file's on-disk modification time, as captured by the
    /// scan that last wrote this row (`symlink_metadata().modified()`).
    /// `None` for rows scanned before this field existed. Compared at
    /// second precision against the walked file's live mtime to decide
    /// whether a rescan can skip it — see `dp_jobs::ScanJob`.
    pub mtime: Option<DateTime<Utc>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NewMedia {
    pub drive_id: i64,
    pub rel_path: String,
    pub hash: String,
    pub size: u64,
    pub kind: MediaKind,
    pub ext: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub taken_at: Option<DateTime<Utc>>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub aperture: Option<f64>,
    pub shutter: Option<f64>,
    pub iso: Option<u32>,
    pub focal_mm: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub organized_at: Option<DateTime<Utc>>,
    pub source_id: Option<i64>,
    /// The source file's on-disk modification time — see
    /// [`MediaRow::mtime`].
    pub mtime: Option<DateTime<Utc>>,
}

/// One media row's identity/fingerprint for the incremental-rescan skip
/// check — everything `dp_jobs::ScanJob` needs to decide, before hashing a
/// walked file, whether it's unchanged since the last scan. Returned by
/// `Catalog::list_scan_index`, one query for a whole drive, loaded into a
/// `HashMap<rel_path, ScanIndexEntry>` before the walk starts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ScanIndexEntry {
    pub id: i64,
    pub rel_path: String,
    pub size: u64,
    pub mtime: Option<DateTime<Utc>>,
    /// Needed for the skip rule's thumb-existence checks
    /// (`store.exists(hash, 400)` / `store.exists(hash, 2000)`).
    pub hash: String,
    /// The [`Source`] this row was last attributed to, if any — `None` for
    /// legacy rows scanned before sources existed. The skip rule refuses
    /// to skip a row whose `source_id` is `None` or differs from the
    /// walked file's owning source, so a re-scan can attribute (or
    /// re-attribute) it instead of freezing it out forever.
    pub source_id: Option<i64>,
    /// The XMP sidecar's on-disk mtime as of the last time this row's
    /// sidecar was actually read (imported or looked at) — set via
    /// `Catalog::set_sidecar_mtime`. `None` means "never recorded" (a
    /// fresh row, or one that predates this column); the skip rule then
    /// falls back to comparing against [`Self::mtime`] instead, matching
    /// pre-existing first-scan behavior.
    pub sidecar_mtime: Option<DateTime<Utc>>,
    /// The last time this row's metadata (EXIF/QuickTime tags) was
    /// successfully read — see [`crate::error::DpError`]'s `Sidecar`
    /// variant for the "tool not found on PATH" failure this exists to
    /// recover from, and `Catalog::update_media_metadata`'s doc comment
    /// for what sets it. `None` means "never successfully read" — the
    /// incremental-rescan skip path re-reads metadata for such a row
    /// (without re-hashing or re-thumbnailing) the next time it's
    /// reached, retrying every scan until a read finally succeeds.
    pub meta_read_at: Option<DateTime<Utc>>,
}

/// One `scan_errors` row — a single file (or walk entry) a scan couldn't
/// process, recorded via `Catalog::record_scan_error` and browsable via
/// `Catalog::list_scan_errors`. `code` is the same stable snake_case string
/// as `JobEvent::ItemError::code` (see `dp_jobs::error_code`), e.g. `"io"`,
/// `"sidecar"`, `"stub"`; `message` is the human-readable detail.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ScanErrorRow {
    pub id: i64,
    pub drive_id: i64,
    pub path: String,
    pub code: String,
    pub message: String,
    pub at: DateTime<Utc>,
}

/// One `code`'s share of `drive_id`'s `scan_errors` rows — returned by
/// `Catalog::scan_error_code_counts`, grouped and ordered `count DESC`, for
/// the severity repartition `ScanProgress`'s failed-count hover card (and
/// `ScanErrorsDialog`'s header) show alongside [`ScanErrorRow::code`]'s
/// severity mapping (frontend-only, see `ScanErrorSeverity`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ScanErrorCodeCount {
    pub code: String,
    pub count: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizeRule {
    pub drive_id: i64,
    pub root: String,
    pub folder_tpl: String,
    pub file_tpl: String,
    pub keep_pairs: bool,
}

impl OrganizeRule {
    /// The default organize rule for a freshly registered drive: archive
    /// everything under `archive/`, grouped into year/quarter folders, with
    /// filenames stamped `yyyy-mm-dd_stem` and RAW+JPEG pairs kept together.
    pub fn default_for(drive_id: i64) -> Self {
        Self {
            drive_id,
            root: "archive".into(),
            folder_tpl: "{{yyyy}}/Q{{q}}".into(),
            file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}".into(),
            keep_pairs: true,
        }
    }
}

/// Settings-backed defaults for a fresh drive's organize rule — what
/// `Catalog::get_rule`'s `None` branch (no `organize_rules` row for the
/// drive yet) composes into an [`OrganizeRule`], field by field: each
/// `Some` here overrides [`OrganizeRule::default_for`]'s hardcoded value;
/// each `None` (the never-configured default) falls back to it. Written
/// via `Catalog::set_organize_defaults`, read via
/// `Catalog::get_organize_defaults` — see `dp_catalog::settings` for the
/// underlying `default_root`/`default_folder_tpl`/`default_file_tpl`/
/// `default_keep_pairs` keys, which follow the same unset-means-`None`
/// convention as the rest of that module.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct OrganizeDefaults {
    pub root: Option<String>,
    pub folder_tpl: Option<String>,
    pub file_tpl: Option<String>,
    pub keep_pairs: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Planned,
    Moved,
    SkippedDup,
    SkippedCollision,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizeJobRow {
    pub id: i64,
    pub drive_id: i64,
    pub drive_name: String,
    /// `running` | `done` | `cancelled` | `failed`
    pub status: String,
    pub planned: u64,
    pub moved: u64,
    pub skipped: u64,
    pub failed: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    /// `organize` | `revert`
    pub kind: String,
    /// For a `revert` job: the `organize_jobs.id` it reverts. `None` for
    /// an `organize` job.
    pub reverts_job_id: Option<i64>,
    /// For an `organize` job: the id of the newest `revert` job that
    /// reverts it, if any. Computed by `Catalog::list_organize_jobs` via
    /// a `LEFT JOIN` on `reverts_job_id` — never stored on the row
    /// itself, and always `None` for a `revert` job.
    pub reverted_by_job_id: Option<i64>,
}

/// A finished job's run metrics, as recorded by `dp_jobs::JobRunner` via
/// `Catalog::record_job_run` on every terminal path (done/cancelled/failed)
/// of every job kind — see `dp-catalog`'s `job_runs` table.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NewJobRun {
    /// The runner-assigned job id, e.g. `"scan-3"`.
    pub job_id: String,
    /// `job_id`'s prefix before its first `-` (`"scan"`, `"organize"`,
    /// `"revert"`, `"sidecar"`, `"geocode"`, `"regen"`).
    pub kind: String,
    /// `None` for a global job (geocode, regen); `Some` for every per-drive job.
    pub drive_id: Option<i64>,
    /// `done` | `cancelled` | `failed` — `failed` only for a job-level
    /// failure (the `Job::run` future itself returned `Err` or panicked);
    /// item-level failures are folded into `failed` below instead.
    pub status: String,
    pub ok: u64,
    pub failed: u64,
    pub skipped: u64,
    pub bytes_read: u64,
    pub bytes_written: u64,
    /// Process-wide `rusage` (user + sys) delta across the job's run,
    /// milliseconds — "app CPU during this job, including concurrent
    /// jobs", not an isolated per-job measurement.
    pub cpu_ms: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
}

/// A [`NewJobRun`] as stored, with its assigned id — what
/// `Catalog::list_job_runs` returns.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct JobRunRow {
    pub id: i64,
    pub job_id: String,
    pub kind: String,
    pub drive_id: Option<i64>,
    pub status: String,
    pub ok: u64,
    pub failed: u64,
    pub skipped: u64,
    pub bytes_read: u64,
    pub bytes_written: u64,
    pub cpu_ms: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizeItemRow {
    pub id: i64,
    pub job_id: i64,
    pub media_id: i64,
    pub old_rel_path: String,
    pub new_rel_path: String,
    pub status: PlanStatus,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizePlanItem {
    pub media_id: i64,
    pub old_rel_path: String,
    pub new_rel_path: String,
    pub status: PlanStatus,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct OrganizePlan {
    pub items: Vec<OrganizePlanItem>,
    pub planned: u64,
    pub skipped_dup: u64,
    pub bytes: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct UnorganizedSummary {
    pub drive_id: i64,
    /// Media rows still waiting to be organized under the rule's root.
    pub count: u64,
    /// Every media row known for this drive, organized or not. `0` is
    /// the only reliable "this drive was never scanned" signal — a
    /// `count` of `0` on its own just as easily means "fully organized".
    pub total: u64,
    pub bytes: u64,
    pub photos: u64,
    pub videos: u64,
    pub earliest: Option<DateTime<Utc>>,
    pub latest: Option<DateTime<Utc>>,
    /// This drive's legacy rows: still unorganized, outside the rule's
    /// root, but never attributed to a source (see
    /// [`MediaRow::source_id`]) — scanned before sources existed. These
    /// can't be organized until then, and are deliberately excluded from
    /// `count`; a re-scan is what attributes them to a source and makes
    /// them organizable.
    pub legacy: u64,
    /// Whether this drive has at least one *enabled* source configured.
    /// `false` means a scan would walk nothing at all, so the UI must
    /// send the user to set sources up rather than offer a scan that
    /// can only ever find zero photos.
    pub has_sources: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MediaSort {
    #[default]
    TakenDesc,
    TakenAsc,
    AddedDesc,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct MediaQuery {
    pub kinds: Vec<MediaKind>,
    pub exts: Vec<String>,
    pub sort: MediaSort,
    pub limit: u32,
    pub offset: u32,
    pub place_id: Option<i64>,
    /// Filters on presence: `None` includes every row regardless of
    /// `missing_at` (every existing caller's behavior, preserved by
    /// `#[serde(default)]` deserializing an omitted field to `None`);
    /// `Some(false)` restricts to rows currently present (`missing_at IS
    /// NULL`); `Some(true)` restricts to rows the last scan of their
    /// drive+source didn't see (`missing_at IS NOT NULL`) — see
    /// `dp_jobs::ScanJob`'s per-source `reconcile_missing` call.
    pub missing: Option<bool>,
}

impl MediaQuery {
    pub const MAX_LIMIT: u32 = 2000;

    /// Clamps `limit` to `1..=MAX_LIMIT`, leaving the rest of the query
    /// untouched.
    pub fn clamped(self) -> Self {
        Self {
            limit: self.limit.clamp(1, Self::MAX_LIMIT),
            ..self
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MediaItem {
    pub row: MediaRow,
    pub thumb_path: String,
    pub preview_path: String,
    pub drive_name: String,
    pub online: bool,
    pub original_path: Option<String>,
    /// Whether a 400px thumbnail exists on disk for this row. `false` for
    /// older catalog rows scanned before thumbnailing existed, or whose
    /// thumbnail was otherwise never generated — the frontend renders a
    /// placeholder tile instead of requesting `thumb_path` in that case.
    pub has_thumb: bool,
}

/// A folder discovered by `dp_jobs::detect::detect_folders` that directly
/// (or, once rolled up, transitively) contains media files worth offering
/// as an import source.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DetectedFolder {
    pub rel_path: String,
    pub media_count: u64,
    /// Sum of on-disk sizes (`symlink_metadata().len()`) of every media
    /// file counted toward `media_count`.
    pub bytes: u64,
    pub suggested: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct MediaMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
    pub taken_at: Option<DateTime<Utc>>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub aperture: Option<f64>,
    pub shutter: Option<f64>,
    pub iso: Option<u32>,
    pub focal_mm: Option<f64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// Longest edge (px) the "preview" thumbnail slot is rendered/regenerated
/// at when the user picks "Compact" quality in Settings. See
/// [`PREVIEW_EDGE_MAX`] for why the on-disk slot filename never changes.
pub const PREVIEW_EDGE_COMPACT: u32 = 800;
/// Same as [`PREVIEW_EDGE_COMPACT`], for "Balanced" quality.
pub const PREVIEW_EDGE_BALANCED: u32 = 1200;
/// Same as [`PREVIEW_EDGE_COMPACT`], for "Max" quality — also the app's
/// default (and the value that was hard-coded before this setting
/// existed), so an upgrading user's existing previews stay exactly as
/// they were until they explicitly choose a lower quality.
pub const PREVIEW_EDGE_MAX: u32 = 2000;
/// Default `preview_edge` for a catalog that has never had the setting
/// written — see `dp_catalog::Catalog::get_settings`.
pub const DEFAULT_PREVIEW_EDGE: u32 = PREVIEW_EDGE_MAX;

/// Persisted app-wide settings — the preview quality plus the configured
/// thumbnail-cache location, but the shape `Catalog::get_settings`/
/// `get_settings` (the Tauri command) hands the frontend, so more keys
/// can be added here without changing either signature.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AppSettings {
    /// The longest edge (px) the "preview" (`2000.webp`) thumbnail slot is
    /// rendered/regenerated at — one of [`PREVIEW_EDGE_COMPACT`],
    /// [`PREVIEW_EDGE_BALANCED`], or [`PREVIEW_EDGE_MAX`] in the current
    /// UI, though nothing enforces that at this layer.
    pub preview_edge: u32,
    /// The user-relocated thumbnail-cache root (an absolute path, always
    /// ending in `drophoto-thumbs` — see `move_cache`'s doc comment),
    /// or `None` for the default `<app-data>/thumbs`. Never trusted blindly
    /// at startup: `AppState::init` falls back to the default (and flags
    /// [`CacheStatus::fallback`]) if this path doesn't exist or can't be
    /// read, e.g. an external drive that isn't currently plugged in.
    pub thumbs_dir: Option<String>,
}

/// Where thumbnails/previews are currently cached, and whether that's
/// really the configured location — the `cache_status` Tauri command's
/// response, read by Settings' `StorageSection` (the "Cache location"
/// row and its fallback warning). Deliberately a separate command/type
/// from [`AppSettings`]/`get_settings` rather than folding `fallback`
/// into `AppSettings` itself: `fallback` is a point-in-time fact about
/// *this* launch's resolution (computed once in `AppState::init`, from
/// filesystem state that can change independently of the setting), not
/// part of the persisted setting itself.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CacheStatus {
    /// The thumbnail-cache root actually in use this launch — always the
    /// real, existing directory (never the raw, possibly-stale
    /// `AppSettings::thumbs_dir` string), so the UI can show it directly.
    pub thumbs_dir: String,
    /// `true` when a configured [`AppSettings::thumbs_dir`] was set but
    /// unusable (missing/unreadable) at startup, so the app fell back to
    /// its own default instead — Settings shows a warning in this case.
    pub fallback: bool,
}

/// A breakdown of on-disk space the app itself is responsible for —
/// returned by the `storage_usage` Tauri command for Settings' storage
/// panel. Never covers the user's own photos/drives, only the app's own
/// cache/catalog.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct StorageUsage {
    /// Total size of every `400.webp` (thumbnail slot) file under the
    /// thumbs root.
    pub thumbs_400_bytes: u64,
    /// Total size of every `2000.webp` (preview slot) file under the
    /// thumbs root — see the module docs on why the filename stays
    /// `2000.webp` regardless of the configured preview edge.
    pub previews_bytes: u64,
    /// Size of the catalog SQLite file plus its `-wal`/`-shm` siblings,
    /// when present (WAL journal mode).
    pub catalog_bytes: u64,
    /// `thumbs_400_bytes + previews_bytes + catalog_bytes`.
    pub total_bytes: u64,
    /// Count of thumbnail files (both slots) counted toward the totals
    /// above.
    pub file_count: u64,
}

/// Where `exiftool`/`ffmpeg` were found on this machine, resolved once by
/// `AppState::init` (via `dp_metadata::resolve_tool`) and returned as-is by
/// the `tool_health` Tauri command for Settings' tools panel — see Task
/// 5b.3. `None` for a tool means it couldn't be found anywhere
/// `resolve_tool` looked (every `$PATH` directory plus the Homebrew/
/// MacPorts fallback dirs); every metadata/thumbnail operation needing
/// that tool will keep failing (visible in `scan_errors`) until it's
/// installed. This is a point-in-time snapshot taken at app startup, not
/// re-checked live — a tool installed while the app is running won't be
/// reflected here until the next launch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ToolHealth {
    pub exiftool: ToolStatus,
    pub ffmpeg: ToolStatus,
}

/// One external tool's startup snapshot: where it was found, what version
/// it reported, and whether that version sits below the tool's security
/// floor (issue #29 — these tools parse untrusted media, and old builds
/// have known RCEs from crafted files, e.g. exiftool CVE-2021-22204).
///
/// `outdated` is true ONLY when a version was actually parsed and it is
/// below the floor — an unparsable/unknown version reports as unknown
/// (`version: None`, `outdated: false`) rather than crying wolf on dev
/// builds, and a missing tool is its own (`path: None`) state.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct ToolStatus {
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub outdated: bool,
}

/// Per-drive sidecar coverage for Settings' SIDECARS panel — returned by
/// `Catalog::sidecar_health`/the `sidecar_health` Tauri command. `tagged`
/// is how many of the drive's media rows carry at least one tag (the set
/// `check_sidecar_files` stats against); `pending` is how many rows are
/// currently flagged `sidecar_pending` (queued for the next
/// `SidecarSyncJob` sweep — whether from a tag edit or `check_sidecar_files`
/// finding a missing `.xmp`). Both counts move independently: a row can be
/// tagged with its sidecar already written (not pending), or pending from a
/// tag edit that hasn't synced yet.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
pub struct SidecarHealth {
    pub tagged: u64,
    pub pending: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_ext_recognizes_heic_case_insensitively() {
        assert_eq!(MediaKind::from_ext("HEIC"), Some((MediaKind::Photo, "heic")));
    }

    #[test]
    fn from_ext_unknown_extension_is_none() {
        assert_eq!(MediaKind::from_ext("txt"), None);
    }

    #[test]
    fn clamped_raises_zero_limit_to_one() {
        let q = MediaQuery {
            limit: 0,
            ..Default::default()
        }
        .clamped();
        assert_eq!(q.limit, 1);
    }

    #[test]
    fn clamped_caps_limit_at_max() {
        let q = MediaQuery {
            limit: 9999,
            ..Default::default()
        }
        .clamped();
        assert_eq!(q.limit, MediaQuery::MAX_LIMIT);
    }

    #[test]
    fn media_query_deserializes_from_an_empty_object() {
        let q: MediaQuery = serde_json::from_str("{}").expect("missing fields should default");
        assert_eq!(q.kinds, Vec::<MediaKind>::new());
        assert_eq!(q.exts, Vec::<String>::new());
        assert_eq!(q.limit, 0);
        // `limit: 0` is only meaningful pre-`clamped()` — callers clamp before querying.
        assert_eq!(q.clone().clamped().limit, 1);
        assert_eq!(q.missing, None);
    }
}
