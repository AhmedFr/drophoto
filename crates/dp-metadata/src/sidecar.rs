use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use dp_core::{DpError, DpResult};
use serde_json::Value;

/// `IMG_001.jpg` → `IMG_001.jpg.xmp` (spec §1.1 — full name + ".xmp").
pub fn sidecar_path(media_path: &Path) -> PathBuf {
    let mut name = media_path.file_name().unwrap_or_default().to_os_string();
    name.push(OsStr::new(".xmp"));
    media_path.with_file_name(name)
}

/// Reads and writes the `XMP-dc:Subject` list in a media file's XMP sidecar.
#[async_trait::async_trait]
pub trait Sidecars: Send + Sync {
    /// Replaces the sidecar's XMP-dc:Subject list with `subjects` (sorted, deduped
    /// by caller). Creates the sidecar if absent; never touches the media file.
    async fn write_subjects(&self, media_path: &Path, subjects: &[String]) -> DpResult<()>;
    /// Subjects from `sidecar_path(media_path)`; Ok(vec![]) when no sidecar exists.
    async fn read_subjects(&self, media_path: &Path) -> DpResult<Vec<String>>;
}

/// [`Sidecars`] backed by the `exiftool` command-line tool.
pub struct ExiftoolSidecars {
    bin: PathBuf,
}

impl ExiftoolSidecars {
    pub fn new(bin: impl Into<PathBuf>) -> Self {
        Self { bin: bin.into() }
    }

    pub fn from_path() -> Self {
        Self::new("exiftool")
    }
}

fn exiftool_err(e: &std::io::Error) -> DpError {
    if e.kind() == std::io::ErrorKind::NotFound {
        DpError::Sidecar {
            tool: "exiftool".into(),
            message: "exiftool not found on PATH".into(),
        }
    } else {
        DpError::Sidecar {
            tool: "exiftool".into(),
            message: e.to_string(),
        }
    }
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Renders a minimal, deterministic XMP packet containing `subjects`, used
/// when creating a sidecar that doesn't exist yet.
fn render_new_sidecar(subjects: &[String]) -> String {
    let items: String = subjects
        .iter()
        .map(|s| format!("     <rdf:li>{}</rdf:li>\n", xml_escape(s)))
        .collect();
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n\
         <x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n\
         \x20 <rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n\
         \x20  <dc:subject>\n    <rdf:Bag>\n{items}    </rdf:Bag>\n   </dc:subject>\n\
         \x20 </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>\n"
    )
}

#[async_trait::async_trait]
impl Sidecars for ExiftoolSidecars {
    async fn write_subjects(&self, media_path: &Path, subjects: &[String]) -> DpResult<()> {
        let sidecar = sidecar_path(media_path);

        if tokio::fs::try_exists(&sidecar).await.map_err(|e| DpError::Io {
            message: format!("failed to check sidecar: {e}"),
            path: Some(sidecar.display().to_string()),
        })? {
            // Existing sidecar: clear the subject list, then re-add each
            // subject in order, via exiftool so other XMP fields survive.
            let mut args: Vec<String> = vec!["-overwrite_original".into(), "-XMP-dc:Subject=".into()];
            for subject in subjects {
                args.push(format!("-XMP-dc:Subject={subject}"));
            }

            let output = tokio::process::Command::new(&self.bin)
                .args(&args)
                .arg(&sidecar)
                .output()
                .await
                .map_err(|e| exiftool_err(&e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(DpError::Sidecar {
                    tool: "exiftool".into(),
                    message: format!(
                        "exiftool exited with {status}: {stderr}",
                        status = output.status,
                        stderr = stderr.trim()
                    ),
                });
            }

            Ok(())
        } else {
            // No sidecar yet: render one ourselves for a deterministic
            // result, writing via a temp file + rename so a reader never
            // observes a partially-written sidecar.
            let rendered = render_new_sidecar(subjects);

            let dir = sidecar
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            let mut tmp = tempfile::Builder::new()
                .prefix(".dp-sidecar-")
                .suffix(".xmp.tmp")
                .tempfile_in(&dir)
                .map_err(|e| DpError::Io {
                    message: format!("failed to create temp file: {e}"),
                    path: Some(dir.display().to_string()),
                })?;

            use std::io::Write as _;
            tmp.write_all(rendered.as_bytes()).map_err(|e| DpError::Io {
                message: format!("failed to write sidecar temp file: {e}"),
                path: Some(sidecar.display().to_string()),
            })?;

            tmp.persist(&sidecar).map_err(|e| DpError::Io {
                message: format!("failed to persist sidecar: {e}"),
                path: Some(sidecar.display().to_string()),
            })?;

            Ok(())
        }
    }

    async fn read_subjects(&self, media_path: &Path) -> DpResult<Vec<String>> {
        let sidecar = sidecar_path(media_path);

        if !tokio::fs::try_exists(&sidecar).await.map_err(|e| DpError::Io {
            message: format!("failed to check sidecar: {e}"),
            path: Some(sidecar.display().to_string()),
        })? {
            return Ok(vec![]);
        }

        let output = tokio::process::Command::new(&self.bin)
            .args(["-json", "-XMP-dc:Subject"])
            .arg(&sidecar)
            .output()
            .await
            .map_err(|e| exiftool_err(&e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(DpError::Sidecar {
                tool: "exiftool".into(),
                message: format!(
                    "exiftool exited with {status}: {stderr}",
                    status = output.status,
                    stderr = stderr.trim()
                ),
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_subjects(&stdout)
    }
}

/// Parses the JSON array emitted by `exiftool -json -XMP-dc:Subject ...`.
/// `Subject` may be a plain string (one subject) or an array (several).
fn parse_subjects(json: &str) -> DpResult<Vec<String>> {
    let values: Vec<Value> = serde_json::from_str(json).map_err(|e| DpError::Sidecar {
        tool: "exiftool".into(),
        message: format!("failed to parse exiftool output: {e}"),
    })?;

    let entry = match values.first() {
        Some(v) => v,
        None => return Ok(vec![]),
    };

    match entry.get("Subject") {
        None => Ok(vec![]),
        Some(Value::String(s)) => Ok(vec![s.clone()]),
        Some(Value::Array(items)) => Ok(items
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()),
        Some(_) => Ok(vec![]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_path_appends_xmp() {
        assert_eq!(
            sidecar_path(Path::new("/a/IMG_001.jpg")),
            PathBuf::from("/a/IMG_001.jpg.xmp")
        );
    }

    #[test]
    fn parse_subjects_single_string() {
        let j = r#"[{"SourceFile":"x.jpg.xmp","Subject":"beach"}]"#;
        assert_eq!(parse_subjects(j).unwrap(), vec!["beach".to_string()]);
    }

    #[test]
    fn parse_subjects_array() {
        let j = r#"[{"SourceFile":"x.jpg.xmp","Subject":["beach","Trip"]}]"#;
        assert_eq!(
            parse_subjects(j).unwrap(),
            vec!["beach".to_string(), "Trip".to_string()]
        );
    }

    #[test]
    fn parse_subjects_missing() {
        let j = r#"[{"SourceFile":"x.jpg.xmp"}]"#;
        assert_eq!(parse_subjects(j).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn parse_subjects_empty_array_of_entries() {
        assert_eq!(parse_subjects("[]").unwrap(), Vec::<String>::new());
    }
}
