use chrono::{DateTime, NaiveDateTime, Utc};
use dp_core::{DpError, DpResult, MediaMetadata};
use serde_json::Value;

/// exiftool's sentinel for "no date" in QuickTime-format files.
const ZERO_DATE: &str = "0000:00:00 00:00:00";

/// Parses the JSON array emitted by `exiftool -json -n ...` into [`MediaMetadata`].
///
/// Pure function: no I/O, no process spawning. Returns [`dp_core::DpError::NotFound`]
/// when the array is empty (exiftool found no matching file).
pub fn parse_exiftool_json(json: &str) -> DpResult<MediaMetadata> {
    let values: Vec<Value> = serde_json::from_str(json).map_err(|e| DpError::Sidecar {
        tool: "exiftool".into(),
        message: format!("failed to parse exiftool output: {e}"),
    })?;

    let entry = values.first().ok_or_else(|| DpError::NotFound {
        message: "exiftool returned no entries".into(),
    })?;

    let width = num(entry, "ImageWidth").map(|v| v as u32);
    let height = num(entry, "ImageHeight").map(|v| v as u32);
    let duration_ms = num(entry, "Duration").map(|d| (d * 1000.0).round() as u64);

    let taken_at = s(entry, "DateTimeOriginal")
        .and_then(|v| parse_exif_date(&v))
        .or_else(|| s(entry, "CreateDate").and_then(|v| parse_exif_date(&v)))
        .or_else(|| s(entry, "MediaCreateDate").and_then(|v| parse_exif_date(&v)));

    Ok(MediaMetadata {
        width,
        height,
        duration_ms,
        taken_at,
        camera: s(entry, "Model"),
        lens: s(entry, "LensModel"),
        aperture: num(entry, "FNumber"),
        shutter: num(entry, "ExposureTime"),
        iso: num(entry, "ISO").map(|v| v as u32),
        focal_mm: num(entry, "FocalLength"),
        lat: num(entry, "GPSLatitude"),
        lon: num(entry, "GPSLongitude"),
    })
}

/// Reads `key` from `entry` as an `f64`, accepting either a JSON number or a
/// numeric string (exiftool sometimes emits the latter even with `-n`).
fn num(entry: &Value, key: &str) -> Option<f64> {
    let v = entry.get(key)?;
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// Reads `key` from `entry` as a `String`.
fn s(entry: &Value, key: &str) -> Option<String> {
    entry.get(key)?.as_str().map(|s| s.to_string())
}

/// Parses an exiftool date string (`"%Y:%m:%d %H:%M:%S"`, optionally with
/// subseconds and/or a timezone offset), treating it as UTC. Returns `None`
/// for the zero-date sentinel exiftool emits when a video has no create date.
fn parse_exif_date(raw: &str) -> Option<DateTime<Utc>> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with(ZERO_DATE) {
        return None;
    }

    // Strip a timezone suffix (+02:00, -05:00, Z) if present. Guarded by
    // `is_char_boundary` since `raw` may contain multi-byte UTF-8 (e.g. from
    // corrupt EXIF data), where `raw.len() - 6` could otherwise land inside
    // a codepoint and panic.
    let without_tz = if let Some(rest) = raw.strip_suffix('Z') {
        rest
    } else if raw.len() > 6 && raw.is_char_boundary(raw.len() - 6) {
        let (head, tail) = raw.split_at(raw.len() - 6);
        if (tail.starts_with('+') || tail.starts_with('-')) && tail.as_bytes()[3] == b':' {
            head
        } else {
            raw
        }
    } else {
        raw
    };

    // Strip subseconds (".123") if present.
    let without_subsec = without_tz
        .split_once('.')
        .map(|(head, _)| head)
        .unwrap_or(without_tz);

    NaiveDateTime::parse_from_str(without_subsec, "%Y:%m:%d %H:%M:%S")
        .ok()
        .map(|naive| naive.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_photo() {
        let j = r#"[{"SourceFile":"x.jpg","ImageWidth":640,"ImageHeight":480,"DateTimeOriginal":"2025:09:12 14:03:21","Model":"Sony ILCE-7M4","LensModel":"FE 35mm F1.4 GM","FNumber":2.0,"ExposureTime":0.00125,"ISO":100,"FocalLength":35,"GPSLatitude":38.71,"GPSLongitude":-9.13}]"#;
        let m = parse_exiftool_json(j).unwrap();
        assert_eq!(m.width, Some(640));
        assert_eq!(m.camera.as_deref(), Some("Sony ILCE-7M4"));
        assert_eq!(m.taken_at.unwrap().to_rfc3339(), "2025-09-12T14:03:21+00:00");
        assert_eq!(m.lon, Some(-9.13));
        assert_eq!(m.shutter, Some(0.00125));
    }

    #[test]
    fn parses_video_duration_and_createdate() {
        let j = r#"[{"SourceFile":"x.mp4","ImageWidth":640,"ImageHeight":480,"Duration":2.0,"CreateDate":"2025:01:02 03:04:05"}]"#;
        let m = parse_exiftool_json(j).unwrap();
        assert_eq!(m.duration_ms, Some(2000));
        assert!(m.taken_at.is_some());
    }

    #[test]
    fn empty_array_is_not_found() {
        assert!(parse_exiftool_json("[]").is_err());
    }

    #[test]
    fn non_ascii_date_does_not_panic() {
        let j = r#"[{"SourceFile":"x.jpg","DateTimeOriginal":"€abcd"}]"#;
        let m = parse_exiftool_json(j).unwrap();
        assert_eq!(m.taken_at, None);
    }
}
