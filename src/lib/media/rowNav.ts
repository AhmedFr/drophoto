/**
 * Pure helper for GalleryPage's keyboard Up/Down handling. `VirtualGrid`'s
 * justified layout doesn't have a fixed items-per-row count — it packs as
 * many tiles as fit the container width — so "move up/down a row" can't be
 * done with simple arithmetic on `focusIndex`. Instead `VirtualGrid` reports
 * its current row grouping (each row as the flat-`items`-array indices of
 * its tiles, in column order) via `onRowsChange`, and this function moves
 * within that grouping: find the row containing `focusIndex`, then land on
 * the tile at the same column in the row above/below, clamped to that row's
 * (possibly shorter, e.g. a trailing row) length.
 *
 * Returns `focusIndex` unchanged if it isn't found in `rows` (e.g. `rows` is
 * stale or empty) or there's no row in that direction (top/bottom edge).
 */
export function moveFocusRow(rows: number[][], focusIndex: number, direction: -1 | 1): number {
  const rowIndex = rows.findIndex((row) => row.includes(focusIndex));
  if (rowIndex === -1) return focusIndex;

  const targetRow = rows[rowIndex + direction];
  if (!targetRow || targetRow.length === 0) return focusIndex;

  const column = rows[rowIndex].indexOf(focusIndex);
  return targetRow[Math.min(column, targetRow.length - 1)];
}
