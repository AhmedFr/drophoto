use std::path::PathBuf;

use dp_metadata::resolve_tool_in;

/// Creates `dir/name` as an executable (mode 0o755) file, returning `dir`
/// unmodified for convenience.
#[cfg(unix)]
fn make_executable(dir: &std::path::Path, name: &str) {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, b"#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// Creates `dir/name` as a plain, non-executable file.
fn make_non_executable(dir: &std::path::Path, name: &str) {
    std::fs::write(dir.join(name), b"not a script").unwrap();
}

#[test]
fn finds_the_tool_in_the_first_candidate_directory_that_has_it() {
    let dir = tempfile::tempdir().unwrap();
    make_executable(dir.path(), "exiftool");

    let candidates = vec![PathBuf::from("/does/not/exist"), dir.path().to_path_buf()];
    assert_eq!(
        resolve_tool_in("exiftool", &candidates),
        Some(dir.path().join("exiftool"))
    );
}

#[test]
fn returns_none_when_the_tool_is_in_no_candidate_directory() {
    let dir = tempfile::tempdir().unwrap();

    let candidates = vec![dir.path().to_path_buf()];
    assert_eq!(resolve_tool_in("exiftool", &candidates), None);
}

#[test]
fn returns_the_first_matching_candidate_when_the_tool_exists_in_several() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    make_executable(first.path(), "ffmpeg");
    make_executable(second.path(), "ffmpeg");

    let candidates = vec![first.path().to_path_buf(), second.path().to_path_buf()];
    assert_eq!(
        resolve_tool_in("ffmpeg", &candidates),
        Some(first.path().join("ffmpeg")),
        "the earlier candidate directory must win, mirroring $PATH order"
    );
}

#[cfg(unix)]
#[test]
fn skips_a_non_executable_file_of_the_same_name() {
    let dir = tempfile::tempdir().unwrap();
    make_non_executable(dir.path(), "exiftool");

    let candidates = vec![dir.path().to_path_buf()];
    assert_eq!(
        resolve_tool_in("exiftool", &candidates),
        None,
        "a same-named file with no executable bit set must never be returned"
    );
}

#[test]
fn skips_a_directory_of_the_same_name() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("exiftool")).unwrap();

    let candidates = vec![dir.path().to_path_buf()];
    assert_eq!(
        resolve_tool_in("exiftool", &candidates),
        None,
        "a directory named like the tool must never be returned as a match"
    );
}
