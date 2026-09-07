/** The quiet strip on the right edge when nothing is pointing at it. */
export const TRACK_WIDTH_REST = 8;

/** How wide the track opens on hover or during a scrub, to fit year labels. */
export const TRACK_WIDTH_ACTIVE = 56;

/**
 * The closest two year labels may sit before the lower one is dropped.
 * The track is one screen tall for a library spanning decades, so without
 * this the years collide into an unreadable stack.
 */
export const MIN_LABEL_SPACING_PX = 22;

/**
 * Breathing room at the top and bottom of the track. The handle's centre
 * stays inside it, so at either extreme it still reads as a handle rather
 * than as a line clipped by the container's edge.
 */
export const EDGE_PADDING_PX = 8;

/**
 * The most ticks `buildTicks` is asked for. Culling to a fixed count keeps
 * the work bounded no matter how many months the library spans;
 * `MIN_LABEL_SPACING_PX` then thins whatever still overlaps at the track's
 * actual height.
 */
export const MAX_TICKS = 120;

/** How far one Arrow key moves the scrubber, as a fraction of the viewport. */
export const KEY_STEP_RATIO = 0.15;

/**
 * What one line of `deltaY` is worth when a wheel reports its scroll in
 * lines (`deltaMode` 1) rather than pixels, as some mice and browsers do.
 */
export const WHEEL_LINE_HEIGHT_PX = 16;
