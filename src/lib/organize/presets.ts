/**
 * Folder-template presets — shared by Settings' `OrganizeDefaultsSection`
 * and the Organize wizard's `RuleEditor`, so both PRESETS dropdowns offer
 * the exact same choices. Each preset fills only `folder_tpl`; the file
 * template and root are left to the user. Double-brace handlebars syntax,
 * matching `dp-organize`'s template engine (see
 * `crates/dp-organize/src/template.rs`'s `validate_template`).
 */
export const TEMPLATE_PRESETS = [
  { label: "Year / Month", folder_tpl: "{{yyyy}}/{{mm}}" },
  { label: "Year / Quarter", folder_tpl: "{{yyyy}}/Q{{q}}" },
  { label: "Flat by date", folder_tpl: "{{yyyy}}-{{mm}}-{{dd}}" },
] as const;
