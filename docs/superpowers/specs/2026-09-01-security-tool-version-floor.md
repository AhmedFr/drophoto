# Security: minimum-version floor for exiftool/ffmpeg

**Date:** 2026-09-01 · **Origin:** appsec audit 2026-09-01, Risk 2 (Medium, `dependency_rce_surface`) · **Status:** approved in conversation 2026-09-01

## Problem

drophoto feeds **untrusted media** (files on attached drives, including their
embedded metadata) to whatever `exiftool`/`ffmpeg` build happens to be installed
on the user's machine (`dp_metadata::resolve_tool`: `$PATH` + Homebrew/MacPorts
dirs). Both tools have a history of RCE from malicious files — most concretely
exiftool CVE-2021-22204 (arbitrary code execution from a crafted DjVu/JPEG,
fixed in 12.24). An outdated local install turns "scan a USB drive someone
handed you" into code execution as the user. The app currently checks only
*presence*, never *version*.

## Version floors

| Tool | Floor | Rationale |
|---|---|---|
| exiftool | **12.24** | CVE-2021-22204 (RCE via crafted file) fixed in 12.24. |
| ffmpeg | **6.0** | No single headline CVE; 4.x/5.x lines carry many parser CVEs and 5.x is EOL for Homebrew. 6.0 (2023) is a conservative supported floor. |

`sips` is OS-bundled and patched by macOS updates — out of scope.

Floors live as constants in `dp-metadata` (`MIN_EXIFTOOL`, `MIN_FFMPEG`) with the
rationale in doc comments.

## Design

### Rust — `dp-metadata`, new `version.rs`

- `ToolVersion(u32, u32)` — ordered `(major, minor)`; exiftool's `-ver` prints
  `13.10` style, ffmpeg's first line prints `ffmpeg version 7.1[.x][-suffix] …`.
  Patch/suffix are ignored for comparison (floors are minor-granular).
- Pure parsers, unit-tested exhaustively (TDD):
  - `parse_exiftool_version("13.10\n") -> Some(ToolVersion(13, 10))`
  - `parse_ffmpeg_version("ffmpeg version 7.1-tessus …") -> Some(ToolVersion(7, 1))`
  - garbage / empty / `N-xxxxx-g<sha>` dev builds → `None` (unknown ≠ outdated).
- `probe_exiftool_version(path)` / `probe_ffmpeg_version(path)` — spawn
  `<path> -ver` / `<path> -version`, argv-only, feed the parsers. Failures →
  `None`.

### Rust — `dp-core::ToolHealth` (shape change)

```rust
pub struct ToolStatus {
    pub path: Option<PathBuf>,
    /// Verbatim parsed version ("13.10"); None = tool missing or unparsable.
    pub version: Option<String>,
    /// True only when a version WAS parsed and it is below the floor.
    pub outdated: bool,
}
pub struct ToolHealth { pub exiftool: ToolStatus, pub ffmpeg: ToolStatus }
```

Unknown version is reported as unknown, **not** flagged outdated (avoids
crying wolf on dev builds); missing tool keeps today's red "missing" state.

`AppState::init` (`src-tauri/src/state.rs`) probes both versions once at
startup, same snapshot semantics as today (relaunch to re-probe).

### Frontend

- `src/lib/api/settings.ts`: `ToolHealth` type mirrors the new shape.
- `ToolsSection`: per tool —
  - found + current: `found at <path> · v<version>` (muted, as today);
  - found + **outdated**: amber warning — `v<version> is below the security
    floor (<floor>) — versions this old have known vulnerabilities parsing
    untrusted files; update with brew upgrade <formula>, then relaunch`;
  - found + unknown version: `found at <path> · version unknown` (muted);
  - missing: unchanged red state.
- **Launch warning**: when tool health first resolves with any `outdated` tool,
  fire one sonner warning toast ("exiftool 12.10 is outdated — see Settings →
  Tools"), guarded so it shows once per app run. Implemented as a standalone
  renderless `ToolHealthNotifier` mounted in `AppShell` (the `UpdateNotifier`
  pattern) rather than inside the Settings data hook — that hook only runs
  while Settings is mounted, so it can never be relied on to fire at launch.
  Settings itself never toasts (the panel is the detail view).

## Testing (per test-coverage skill)

- `dp-metadata::version` parser unit tests — exhaustive edge cases (TDD-first).
- Comparison tests: `12.23 < 12.24`, `12.24 !<`, `13.1 !<`, major-dominates.
- Probe functions: integration test against the real local tool when present,
  skipped with a message when absent (capability-impl rule).
- `ToolsSection.test.tsx`: four states above; toast hook unit-tested with a
  mocked `toolHealth` response (fires once, not on refetch).
- Storybook story updated for the new states.

## Out of scope

- Bundling pinned tool binaries with the app (larger licensing/size decision —
  candidate for a future phase; this floor check is the interim mitigation).
- Blocking scans when tools are outdated (warn-only for now; a hard block would
  strand users mid-workflow with no in-app remediation).
