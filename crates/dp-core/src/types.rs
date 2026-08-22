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
}
