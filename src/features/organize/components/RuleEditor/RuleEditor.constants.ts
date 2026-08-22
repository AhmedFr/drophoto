/** Folder-template presets offered from the RuleEditor's dropdown. */
export const FOLDER_TEMPLATE_PRESETS = [
  { label: "By quarter", folder_tpl: "{{yyyy}}/Q{{q}}" },
  { label: "By day", folder_tpl: "{{yyyy}}/{{yyyy}}-{{mm}}-{{dd}}" },
] as const;

/** Sample values the live FORMAT/FOLDERS example is rendered from. */
export const SAMPLE_DATE = new Date(Date.UTC(2024, 5, 15, 14, 3, 21));
export const SAMPLE_STEM = "IMG_4821";
export const SAMPLE_EXT = "cr2";
