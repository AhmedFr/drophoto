use std::path::{Path, PathBuf};

/// Directories checked after `$PATH` when resolving a tool — the
/// well-known install locations a bundled macOS app's environment doesn't
/// inherit. A Finder-launched `.app` gets a minimal `PATH`
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) that never includes Homebrew's own
/// bin dirs, which is exactly why every `exiftool`/`ffmpeg` invocation
/// failed with "not found on PATH" in the bundled build (Task 5b.3) even
/// though `cargo tauri dev` — which inherits the terminal's shell `PATH`
/// — never showed the bug.
const FALLBACK_DIRS: &[&str] = &[
    "/opt/homebrew/bin", // Apple Silicon Homebrew
    "/usr/local/bin",    // Intel Homebrew / traditional Unix install
    "/opt/local/bin",    // MacPorts
];

/// Pure candidate-list resolution: returns `dir.join(name)` for the first
/// `dir` in `candidates` where that joined path exists and is an
/// executable file. No environment or `$PATH` reads — everything this
/// needs is passed in, which is what makes it directly unit-testable
/// (see `resolve_tool`, the thin wrapper that builds the real candidate
/// list).
pub fn resolve_tool_in(name: &str, candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(|dir| dir.join(name))
        .find(|path| is_executable_file(path))
}

/// Resolves `name` (e.g. `"exiftool"`, `"ffmpeg"`) to an absolute path,
/// checking every directory in `$PATH` (in order) first, then
/// [`FALLBACK_DIRS`]. Returns `None` if it isn't found anywhere — the
/// caller is expected to fall back to the bare command name (which will
/// itself fail with "not found on PATH" if the environment truly has
/// nothing, same failure as before this existed) and/or surface the miss
/// via `ToolHealth`.
pub fn resolve_tool(name: &str) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default();
    candidates.extend(FALLBACK_DIRS.iter().map(PathBuf::from));
    resolve_tool_in(name, &candidates)
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_tool_in_returns_none_for_an_empty_candidate_list() {
        assert_eq!(resolve_tool_in("exiftool", &[]), None);
    }

    #[test]
    fn resolve_tool_in_returns_none_when_no_candidate_dir_has_the_tool() {
        let candidates = vec![PathBuf::from("/does/not/exist"), PathBuf::from("/also/missing")];
        assert_eq!(resolve_tool_in("exiftool", &candidates), None);
    }
}
