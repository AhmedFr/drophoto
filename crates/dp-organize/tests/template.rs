use chrono::{TimeZone, Utc};
use dp_organize::{validate_template, HandlebarsTemplate, NamingTemplate, TemplateVars};

fn vars(taken: &str, stem: &str, ext: &str) -> TemplateVars {
    TemplateVars {
        taken: taken.parse().unwrap(),
        stem: stem.into(),
        ext: ext.into(),
    }
}

#[test]
fn renders_defaults() {
    let v = vars("2025-09-12T14:03:21Z", "IMG_4821", "raf");
    let tpl = HandlebarsTemplate;

    let folder = tpl.render("{{yyyy}}/Q{{q}}", &v).unwrap();
    assert_eq!(folder, "2025/Q3");

    let file = tpl.render("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}", &v).unwrap();
    assert_eq!(file, "2025-09-12_IMG_4821");
}

#[test]
fn quarter_boundaries() {
    let tpl = HandlebarsTemplate;

    let mar31 = Utc.with_ymd_and_hms(2025, 3, 31, 0, 0, 0).unwrap();
    let v = TemplateVars {
        taken: mar31,
        stem: "s".into(),
        ext: "jpg".into(),
    };
    assert_eq!(tpl.render("Q{{q}}", &v).unwrap(), "Q1");

    let apr1 = Utc.with_ymd_and_hms(2025, 4, 1, 0, 0, 0).unwrap();
    let v = TemplateVars {
        taken: apr1,
        stem: "s".into(),
        ext: "jpg".into(),
    };
    assert_eq!(tpl.render("Q{{q}}", &v).unwrap(), "Q2");
}

#[test]
fn unknown_variable_errors() {
    let v = vars("2025-09-12T14:03:21Z", "IMG_4821", "raf");
    let tpl = HandlebarsTemplate;

    let err = tpl.render("{{bogus}}", &v).unwrap_err();
    assert_eq!(err.to_string(), "unknown template variable: bogus");
}

#[test]
fn sanitizes_separators() {
    let v = vars("2025-09-12T14:03:21Z", "a/b", "jpg");
    let tpl = HandlebarsTemplate;

    let out = tpl.render("{{stem}}", &v).unwrap();
    assert_eq!(out, "a-b");
}

#[test]
fn validate_template_rejects_bad() {
    assert!(validate_template("{{yyyy}}-{{mm}}-{{dd}}_{{stem}}").is_ok());
    assert!(validate_template("{{nope}}").is_err());
}

#[test]
fn rejects_dot_dot_segment() {
    let v = vars("2025-09-12T14:03:21Z", "IMG_4821", "raf");
    let tpl = HandlebarsTemplate;

    assert!(tpl.render("../../x/{{yyyy}}", &v).is_err());
    assert!(validate_template("../{{yyyy}}").is_err());
    assert!(validate_template("{{yyyy}}/../escape").is_err());
    assert!(validate_template("{{yyyy}}/.").is_err());
}

#[test]
fn rejects_leading_slash() {
    let v = vars("2025-09-12T14:03:21Z", "IMG_4821", "raf");
    let tpl = HandlebarsTemplate;

    assert!(tpl.render("/{{yyyy}}", &v).is_err());
    assert!(validate_template("/etc/{{yyyy}}").is_err());
}

#[test]
fn collapses_double_slash() {
    let v = vars("2025-09-12T14:03:21Z", "IMG_4821", "raf");
    let tpl = HandlebarsTemplate;

    let out = tpl.render("a//b", &v).unwrap();
    assert_eq!(out, "a/b");
}
