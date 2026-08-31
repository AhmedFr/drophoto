import type { Drive } from "@/lib/api/drives";
import type { JobEvent } from "@/lib/api/scan";
import type { Source } from "@/lib/api/sources";

export type DriveCardProps = {
  drive: Drive;
  /** This drive's configured sources, used for the "N sources" label and
   * to decide whether Scan is allowed. Defaults to `[]`; pair it with
   * `sourcesLoading` so an in-flight query doesn't read as "none". */
  sources?: Source[];
  /** Whether `sources` is still loading. While `true` the card shows
   * neither "No sources" nor a count (both would be a guess) and keeps
   * Scan disabled. */
  sourcesLoading?: boolean;
  onScan?: () => void;
  /** Starts a full rescan (`startScan(driveId, true)`) — re-hashes and
   * re-thumbnails every file instead of skipping unchanged ones. Rendered
   * as a small secondary "Full" button next to Scan, only once this
   * drive has at least one configured source; disabled under the same
   * conditions as Scan, and its tooltip switches to "Choose sources
   * first" while disabled for lack of an *enabled* source. */
  onFullScan?: () => void;
  onCancelScan?: () => void;
  onOpenSources?: () => void;
  /** Opens the FORGET… confirmation dialog for this drive. Rendered as a dropdown menu action; the dropdown itself is only rendered when this (or `onRelink`, while offline) is given. */
  onForget?: () => void;
  /** Opens the RELINK… dialog for this drive — only rendered while the drive is offline, since an online drive is already correctly matched. */
  onRelink?: () => void;
  scanEvent?: JobEvent;
};
