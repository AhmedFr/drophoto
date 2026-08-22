export type SplitFileName = {
  /** A leading `yyyy-mm-dd` prefix, if present, otherwise `""`. */
  date: string;
  /** The stem (filename without extension) minus the leading date prefix. */
  rest: string;
  /** The extension, including its leading `.`, or `""` if there is none. */
  ext: string;
};

const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Splits a rendered filename (e.g. `2024-06-15_IMG_4821.cr2`) into its
 * leading `yyyy-mm-dd` date prefix, the remainder of the stem, and the
 * extension — so `PlanPreview` can style the date part distinctly from
 * the rest of the name, per the design. Filenames without a leading date
 * (a custom template) get `date: ""` and the whole stem as `rest`.
 */
export function splitFileName(basename: string): SplitFileName {
  const dot = basename.lastIndexOf(".");
  const stem = dot === -1 ? basename : basename.slice(0, dot);
  const ext = dot === -1 ? "" : basename.slice(dot);

  const match = stem.match(DATE_PREFIX_RE);
  if (!match) return { date: "", rest: stem, ext };

  return { date: match[0], rest: stem.slice(match[0].length), ext };
}
