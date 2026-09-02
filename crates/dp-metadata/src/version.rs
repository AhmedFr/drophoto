use std::path::Path;
use std::process::Command;

/// A tool's `(major, minor)` version, ordered numerically with major
/// dominating. Patch components and build suffixes are ignored — the
/// security floors below are minor-granular.
///
/// exiftool always prints a two-digit minor (`12.24`, `13.10`), so numeric
/// minor comparison matches its release order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ToolVersion {
    pub major: u32,
    pub minor: u32,
}

impl std::fmt::Display for ToolVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}", self.major, self.minor)
    }
}

/// A successfully parsed tool version: the numeric `(major, minor)` used
/// for floor comparison plus the verbatim numeric text the tool printed
/// (`"12.05"`, `"6.1.1"`) for display. The display text is kept rather
/// than reconstructed from the numbers because exiftool zero-pads minors:
/// `12.05` parses to `(12, 5)`, and rendering that back as `"12.5"` would
/// read as ABOVE the `12.24` floor in the very warning that says it's
/// below it (review finding, PR #33).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVersion {
    pub number: ToolVersion,
    pub display: String,
}

/// Security floor for exiftool: CVE-2021-22204 (arbitrary code execution
/// from a crafted file's embedded metadata) was fixed in 12.24. drophoto
/// feeds exiftool untrusted media from attached drives, so anything older
/// turns a malicious photo into code execution (issue #29).
pub const MIN_EXIFTOOL: ToolVersion = ToolVersion { major: 12, minor: 24 };

/// Security floor for ffmpeg: no single headline CVE, but the 4.x/5.x
/// lines accumulated many parser CVEs and are end-of-life; 6.0 (2023) is
/// the conservative supported floor for parsing untrusted media
/// (issue #29).
pub const MIN_FFMPEG: ToolVersion = ToolVersion { major: 6, minor: 0 };

/// Parses `exiftool -ver` output (a bare version like `"13.10\n"`).
/// `None` for anything unparsable — unknown is reported as unknown, never
/// as outdated.
pub fn parse_exiftool_version(output: &str) -> Option<ParsedVersion> {
    parse_dotted(output.trim())
}

/// Parses `ffmpeg -version` output, whose first line looks like
/// `"ffmpeg version 7.1-tessus …"` / `"ffmpeg version n6.1.1 …"`. Dev
/// builds (`"ffmpeg version N-113594-g<sha>"`) have no release version and
/// parse to `None` — unknown, not outdated.
pub fn parse_ffmpeg_version(output: &str) -> Option<ParsedVersion> {
    let rest = output.strip_prefix("ffmpeg version ")?;
    let token = rest.split_whitespace().next()?;
    // Distro builds prefix a lowercase 'n' ("n6.1.1"); dev builds start
    // with an uppercase 'N' ("N-113594-g…") and carry no release version.
    let token = token.strip_prefix('n').unwrap_or(token);
    parse_dotted(token)
}

/// Parses the leading `major[.minor…]` of `s`, tolerating a build suffix
/// glued on ("1-tessus" → 1). The major component must START with a
/// digit; a missing/empty minor is 0. `display` is the leading
/// digits-and-dots prefix verbatim (trailing dots trimmed), so `"12.05"`
/// stays `"12.05"` and `"6.1.1-full"` displays `"6.1.1"`.
fn parse_dotted(s: &str) -> Option<ParsedVersion> {
    let prefix: &str = &s[..s
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(s.len())];
    let display = prefix.trim_end_matches('.');
    let mut components = display.split('.');
    let major: u32 = components.next()?.parse().ok()?;
    let minor: u32 = components.next().and_then(|m| m.parse().ok()).unwrap_or(0);
    Some(ParsedVersion {
        number: ToolVersion { major, minor },
        display: display.to_string(),
    })
}

/// Builds one tool's [`dp_core::ToolStatus`] from its resolved path, the
/// version its probe reported, and its security floor. Pure — the probing
/// itself happens in the `probe_*` functions.
pub fn status_from(
    path: Option<std::path::PathBuf>,
    version: Option<ParsedVersion>,
    floor: ToolVersion,
) -> dp_core::ToolStatus {
    dp_core::ToolStatus {
        path,
        outdated: version.as_ref().is_some_and(|v| v.number < floor),
        version: version.map(|v| v.display),
    }
}

/// Runs `<path> -ver` and parses the result. `None` on spawn failure or
/// unparsable output.
pub fn probe_exiftool_version(path: &Path) -> Option<ParsedVersion> {
    let out = Command::new(path).arg("-ver").output().ok()?;
    parse_exiftool_version(&String::from_utf8_lossy(&out.stdout))
}

/// Runs `<path> -version` and parses the result. `None` on spawn failure
/// or unparsable output.
pub fn probe_ffmpeg_version(path: &Path) -> Option<ParsedVersion> {
    let out = Command::new(path).arg("-version").output().ok()?;
    parse_ffmpeg_version(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(major: u32, minor: u32, display: &str) -> ParsedVersion {
        ParsedVersion {
            number: ToolVersion { major, minor },
            display: display.to_string(),
        }
    }

    #[test]
    fn parses_exiftool_bare_version_with_trailing_newline() {
        assert_eq!(parse_exiftool_version("13.10\n"), Some(parsed(13, 10, "13.10")));
    }

    #[test]
    fn parses_exiftool_floor_version() {
        assert_eq!(parse_exiftool_version("12.24"), Some(parsed(12, 24, "12.24")));
    }

    /// The review finding: exiftool zero-pads minors, so `12.05` must
    /// compare as `(12, 5)` (below the floor) while DISPLAYING verbatim as
    /// `"12.05"` — never reconstructed to a misleading `"12.5"`.
    #[test]
    fn exiftool_zero_padded_minor_compares_numerically_but_displays_verbatim() {
        let v = parse_exiftool_version("12.05\n").expect("must parse");
        assert!(v.number < MIN_EXIFTOOL);
        assert_eq!(v.display, "12.05");
    }

    #[test]
    fn exiftool_garbage_and_empty_parse_to_none() {
        assert_eq!(parse_exiftool_version(""), None);
        assert_eq!(parse_exiftool_version("not a version"), None);
    }

    #[test]
    fn parses_ffmpeg_version_with_build_suffix() {
        let out = "ffmpeg version 7.1-tessus https://evermeet.cx/ffmpeg/\nbuilt with clang\n";
        assert_eq!(parse_ffmpeg_version(out), Some(parsed(7, 1, "7.1")));
    }

    /// The patch component is kept in the display ("6.1.1", not "6.1")
    /// even though only `(major, minor)` participates in the comparison.
    #[test]
    fn parses_ffmpeg_version_with_n_prefix_and_patch() {
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version n6.1.1 Copyright (c) 2000-2023"),
            Some(parsed(6, 1, "6.1.1"))
        );
    }

    #[test]
    fn parses_ffmpeg_two_component_version() {
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version 6.0 Copyright (c) 2000-2023"),
            Some(parsed(6, 0, "6.0"))
        );
    }

    #[test]
    fn parses_ffmpeg_major_only_version_as_minor_zero() {
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version 8 Copyright"),
            Some(parsed(8, 0, "8"))
        );
    }

    #[test]
    fn ffmpeg_dev_build_and_garbage_parse_to_none() {
        assert_eq!(parse_ffmpeg_version("ffmpeg version N-113594-g0e1a2b3c4d"), None);
        assert_eq!(parse_ffmpeg_version(""), None);
        assert_eq!(parse_ffmpeg_version("bash: ffmpeg: command not found"), None);
    }

    #[test]
    fn ordering_is_numeric_with_major_dominating() {
        let v = |major, minor| ToolVersion { major, minor };
        assert!(v(12, 23) < MIN_EXIFTOOL);
        assert!(v(12, 24) >= MIN_EXIFTOOL);
        assert!(v(12, 30) >= MIN_EXIFTOOL);
        assert!(v(13, 1) >= MIN_EXIFTOOL);
        assert!(v(13, 0) > v(12, 99), "major must dominate minor");
        assert!(v(5, 1) < MIN_FFMPEG);
        assert!(v(6, 0) >= MIN_FFMPEG);
    }

    #[test]
    fn status_from_flags_a_version_below_the_floor_as_outdated() {
        let s = status_from(
            Some("/opt/homebrew/bin/exiftool".into()),
            Some(parsed(12, 23, "12.23")),
            MIN_EXIFTOOL,
        );
        assert_eq!(s.path, Some("/opt/homebrew/bin/exiftool".into()));
        assert_eq!(s.version, Some("12.23".to_string()));
        assert!(s.outdated);
    }

    /// Verbatim contract at the `ToolStatus` level: the zero-padded
    /// display survives into the version the UI renders.
    #[test]
    fn status_from_keeps_the_verbatim_zero_padded_display() {
        let s = status_from(
            Some("/opt/homebrew/bin/exiftool".into()),
            parse_exiftool_version("12.05"),
            MIN_EXIFTOOL,
        );
        assert_eq!(s.version, Some("12.05".to_string()));
        assert!(s.outdated);
    }

    #[test]
    fn status_from_does_not_flag_a_version_at_the_floor() {
        let s = status_from(
            Some("/opt/homebrew/bin/exiftool".into()),
            Some(parsed(12, 24, "12.24")),
            MIN_EXIFTOOL,
        );
        assert_eq!(s.version, Some("12.24".to_string()));
        assert!(!s.outdated);
    }

    #[test]
    fn status_from_reports_an_unknown_version_as_unknown_not_outdated() {
        let s = status_from(Some("/opt/homebrew/bin/ffmpeg".into()), None, MIN_FFMPEG);
        assert_eq!(s.version, None);
        assert!(!s.outdated, "unknown must never cry wolf");
    }

    #[test]
    fn status_from_missing_tool_is_all_empty() {
        let s = status_from(None, None, MIN_FFMPEG);
        assert_eq!(s, dp_core::ToolStatus::default());
    }

    #[test]
    fn displays_as_major_dot_minor() {
        assert_eq!(MIN_EXIFTOOL.to_string(), "12.24");
    }

    /// Capability-impl check (test-coverage skill): against the real local
    /// exiftool when present, skipped with a message when absent.
    #[test]
    fn probes_the_real_local_exiftool_when_installed() {
        let Some(path) = crate::resolve_tool("exiftool") else {
            eprintln!("skipping: exiftool not installed locally");
            return;
        };
        let v = probe_exiftool_version(&path);
        assert!(v.is_some(), "a real exiftool must report a parsable version");
    }

    /// Same for ffmpeg. Release builds always report a parsable version;
    /// a dev build would legitimately probe to `None`, but Homebrew and
    /// the fallback dirs only ever carry releases.
    #[test]
    fn probes_the_real_local_ffmpeg_when_installed() {
        let Some(path) = crate::resolve_tool("ffmpeg") else {
            eprintln!("skipping: ffmpeg not installed locally");
            return;
        };
        let v = probe_ffmpeg_version(&path);
        assert!(
            v.is_some(),
            "a real ffmpeg release must report a parsable version"
        );
    }
}
