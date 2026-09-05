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
        // A genuine `YYYY-MM-DD` is all single-byte ASCII, so a window whose
        // edges don't land on a char boundary (multi-byte UTF-8 nearby, e.g.
        // an accented filename) can never match — skip it instead of
        // panicking on the slice.
        if !stem.is_char_boundary(i) || !stem.is_char_boundary(i + 10) {
            continue;
        }
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
