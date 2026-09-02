import type { Drive } from "@/lib/api/drives";

/** One online drive's row: its own sidecar-health query and CHECK FILES/SYNC NOW actions. */
export type SidecarDriveRowProps = {
  drive: Drive;
};
