use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Volume {
    pub name: String,
    pub mount_path: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub is_removable: bool,
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
    /// `"revert"`, `"sidecar"`, `"geocode"`).
    pub kind: String,
    /// `None` for a global job (geocode); `Some` for every per-drive job.
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
    }
}
