import type { Tick } from "@/lib/media/timelineTicks";

export type DateScrubberProps = {
  /**
   * The element the scrubber drives — the grid's own scroll container.
   * `null` until it has mounted, at which point the handle starts
   * tracking its `scrollTop`.
   */
  scrollElement: HTMLElement | null;
  /**
   * Where each month begins along the track. Built from the whole-set
   * layout, so the positions are exact rather than estimated.
   */
  ticks: Tick[];
  /**
   * The date of the photo that would sit at the top of the viewport at a
   * given scroll ratio, already formatted for display. Read for the pill
   * and for `aria-valuetext`.
   */
  dateAt: (ratio: number) => string;
  /**
   * Set while another gesture owns the scroll container — in practice a
   * drag-select, which auto-scrolls the same element from its own
   * animation loop. The two would fight over `scrollTop`, so the scrubber
   * refuses to start while one is live.
   */
  disabled?: boolean;
};
