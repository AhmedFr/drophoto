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
