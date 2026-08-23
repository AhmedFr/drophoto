import type { SourceRow } from "../../hooks/useSourcesDialog.types";

export type DetectedFolderRowProps = {
  row: SourceRow;
  onToggle: () => void;
};
