export type TemplateVars = {
  yyyy: string;
  mm: string;
  dd: string;
  HH: string;
  MM: string;
  SS: string;
  q: string;
  stem: string;
  ext: string;
};

const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Renders a naming template (plain `{{var}}` interpolation, no helpers)
 * against a fixed set of variables — a client-side preview of the same
 * `yyyy mm dd HH MM SS q stem ext` variable set the Rust planner
 * (`dp-organize`'s `HandlebarsTemplate`, see `crates/dp-organize/src/template.rs`)
 * renders server-side. Preview only: an unknown `{{var}}` is left as-is
 * rather than rejected, and no path sanitization is applied.
 */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl.replace(TOKEN_RE, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name as keyof TemplateVars] : match,
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Derives the full `TemplateVars` set from a sample UTC date plus a
 * stem/ext — mirrors `dp-organize`'s `TemplateVars`/`build_data`
 * (quarter = month / 3 + 1, all numeric fields zero-padded).
 */
export function templateVarsFromDate(date: Date, stem: string, ext: string): TemplateVars {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return {
    yyyy: String(date.getUTCFullYear()),
    mm: pad2(date.getUTCMonth() + 1),
    dd: pad2(date.getUTCDate()),
    HH: pad2(date.getUTCHours()),
    MM: pad2(date.getUTCMinutes()),
    SS: pad2(date.getUTCSeconds()),
    q: String(quarter),
    stem,
    ext,
  };
}
