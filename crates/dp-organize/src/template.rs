//! Naming templates for organize rules.
//!
//! Templates are plain handlebars variable interpolations (no helpers,
//! no blocks) over a fixed, known set of variables. Rendering is strict:
//! any variable outside that set is rejected before rendering is
//! attempted, each variable's rendered value is sanitized so it can
//! never introduce a stray path separator, and the fully rendered path
//! is validated to reject traversal (`.`, `..`) and a leading `/`.

use chrono::{DateTime, Datelike, TimeZone, Timelike, Utc};
use dp_core::{DpError, DpResult};
use handlebars::Handlebars;
use std::collections::BTreeMap;

/// The variables available to a naming template, all derived from a
/// single "taken at" timestamp plus the file's own stem/extension.
pub struct TemplateVars {
    pub taken: DateTime<Utc>,
    pub stem: String,
    pub ext: String,
}

/// The complete, exact set of variable names a template may reference.
const KNOWN_VARS: &[&str] = &["yyyy", "mm", "dd", "HH", "MM", "SS", "q", "stem", "ext"];

/// Renders naming templates against [`TemplateVars`].
pub trait NamingTemplate: Send + Sync {
    fn render(&self, tpl: &str, vars: &TemplateVars) -> DpResult<String>;
}

/// [`NamingTemplate`] backed by the `handlebars` crate, restricted to
/// simple `{{var}}` interpolation over [`KNOWN_VARS`].
pub struct HandlebarsTemplate;

impl NamingTemplate for HandlebarsTemplate {
    fn render(&self, tpl: &str, vars: &TemplateVars) -> DpResult<String> {
        validate_variables(tpl)?;

        let mut hb = Handlebars::new();
        hb.set_strict_mode(true);
        hb.register_escape_fn(sanitize_segment);

        let data = build_data(vars);
        let rendered = hb.render_template(tpl, &data).map_err(|e| DpError::Unsupported {
            message: format!("failed to render template: {e}"),
            path: None,
        })?;

        let sanitized = sanitize_path(&rendered.replace('\0', ""))?;

        if sanitized.is_empty() {
            return Err(DpError::Unsupported {
                message: "template rendered to an empty path".into(),
                path: None,
            });
        }

        Ok(sanitized)
    }
}

/// Validates a template by rendering it with a fixed set of sample
/// values (2025-09-12 14:03:21, stem `IMG_0001`, ext `jpg`).
pub fn validate_template(tpl: &str) -> DpResult<()> {
    let taken = Utc
        .with_ymd_and_hms(2025, 9, 12, 14, 3, 21)
        .single()
        .ok_or_else(|| DpError::Unsupported {
            message: "invalid sample timestamp".into(),
            path: None,
        })?;
    let vars = TemplateVars {
        taken,
        stem: "IMG_0001".into(),
        ext: "jpg".into(),
    };
    HandlebarsTemplate.render(tpl, &vars).map(|_| ())
}

/// Scans `tpl` for `{{name}}` expressions and rejects any name outside
/// [`KNOWN_VARS`]. This is a deliberately minimal scanner: templates
/// register no helpers, so only plain variable interpolation is
/// expected.
fn validate_variables(tpl: &str) -> DpResult<()> {
    let mut rest = tpl;
    while let Some(start) = rest.find("{{") {
        let after_open = &rest[start + 2..];
        let end = after_open.find("}}").ok_or_else(|| DpError::Unsupported {
            message: "unterminated template expression".into(),
            path: None,
        })?;
        let name = after_open[..end].trim();
        if !KNOWN_VARS.contains(&name) {
            return Err(DpError::Unsupported {
                message: format!("unknown template variable: {name}"),
                path: None,
            });
        }
        rest = &after_open[end + 2..];
    }
    Ok(())
}

/// Builds the handlebars render context from [`TemplateVars`], with all
/// numeric fields zero-padded to their canonical width.
fn build_data(vars: &TemplateVars) -> BTreeMap<&'static str, String> {
    let t = vars.taken;
    let quarter = (t.month() - 1) / 3 + 1;

    let mut map = BTreeMap::new();
    map.insert("yyyy", format!("{:04}", t.year()));
    map.insert("mm", format!("{:02}", t.month()));
    map.insert("dd", format!("{:02}", t.day()));
    map.insert("HH", format!("{:02}", t.hour()));
    map.insert("MM", format!("{:02}", t.minute()));
    map.insert("SS", format!("{:02}", t.second()));
    map.insert("q", quarter.to_string());
    map.insert("stem", vars.stem.clone());
    map.insert("ext", vars.ext.clone());
    map
}

/// Sanitizes a single rendered variable's value so it can never smuggle
/// a path separator, a NUL byte, a leading dot, or stray whitespace into
/// the surrounding template text. Used as handlebars' escape function,
/// so it runs once per `{{var}}` substitution rather than over the
/// template's literal text (which is trusted, author-controlled
/// configuration and may legitimately contain `/` to express nested
/// folders).
fn sanitize_segment(value: &str) -> String {
    let no_nul = value.replace('\0', "");
    let replaced = no_nul.replace(['/', '\\'], "-");
    let trimmed = replaced.trim();
    let no_dots = trimmed.trim_start_matches('.');
    no_dots.trim().to_string()
}

/// Validates and normalizes a fully rendered template's path: rejects a
/// leading `/` and any `.`/`..` path component, and collapses repeated
/// `/` separators (and any leading/trailing ones) away.
fn sanitize_path(rendered: &str) -> DpResult<String> {
    let trimmed = rendered.trim();
    if trimmed.starts_with('/') {
        return Err(DpError::Unsupported {
            message: "template path must not start with '/'".into(),
            path: None,
        });
    }

    let mut components = Vec::new();
    for part in trimmed.split('/') {
        if part.is_empty() {
            continue;
        }
        if part == "." || part == ".." {
            return Err(DpError::Unsupported {
                message: format!("template path must not contain '{part}' components"),
                path: None,
            });
        }
        components.push(part);
    }

    Ok(components.join("/"))
}
