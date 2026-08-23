/** One row in the Sources dialog: an existing source, a detected folder,
 * or a manually-added folder, merged into a single checkable shape. */
export type SourceRow = {
  rel_path: string;
  media_count: number | null;
  bytes: number | null;
  suggested: boolean;
  checked: boolean;
  /** Whether this row corresponds to an already-saved `Source`. */
  existing: boolean;
};
