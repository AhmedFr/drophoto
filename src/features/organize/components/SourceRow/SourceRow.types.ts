import type { UnorganizedRow } from "../../hooks/useUnorganized.types";

export type SourceRowProps = {
  summary: UnorganizedRow;
  selected: boolean;
  onToggle: () => void;
  onScan: () => void;
  scanning?: boolean;
};
