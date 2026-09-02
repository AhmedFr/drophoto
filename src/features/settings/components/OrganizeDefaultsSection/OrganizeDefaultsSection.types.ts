/**
 * The editable form state `OrganizeDefaultsSection` holds — `OrganizeDefaults`
 * with every field's fallback already resolved, so every input always has a
 * concrete (never-blank) value to display.
 */
export type Draft = {
  root: string;
  folder_tpl: string;
  file_tpl: string;
  keep_pairs: boolean;
};
