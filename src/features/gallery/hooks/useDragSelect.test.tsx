import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import type { LayoutEntry } from "@/lib/media/layout";
import { useDragSelect } from "./useDragSelect";

/** Ten entries, so index `n` is id `n + 1` — the offset the assertions read. */
const entries: LayoutEntry[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  taken_at: null,
  width: 1,
  height: 1,
}));

/** The hook only ever calls `preventDefault` on the event it's handed. */
function pointerEvent() {
  return { preventDefault: vi.fn() };
}

it("selects the range from the origin to the tile under the pointer", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(5));

  expect(onSelectionChange).toHaveBeenLastCalledWith([3, 4, 5, 6]);
});

it("deselects when the origin tile was already selected", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [3, 4, 5, 9], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(4));

  // 3,4,5 are swept away; 9 was never touched by the drag and survives.
  expect(onSelectionChange).toHaveBeenLastCalledWith([9]);
});

it("releases the tiles it passed when the drag reverses back toward the origin", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(6));
  act(() => result.current.onTileEnter(3));

  // 5,6,7 are released — this is the assertion the "add only" contract
  // could not satisfy, and the reason for the snapshot model.
  expect(onSelectionChange).toHaveBeenLastCalledWith([3, 4]);
});

it("leaves a pre-drag selection intact when a select-drag passes over it", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [8], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => result.current.onTileEnter(4));

  expect(onSelectionChange).toHaveBeenLastCalledWith([8, 3, 4, 5]);
});

it("selects backwards when dragging above the origin", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(5, pointerEvent()));
  act(() => result.current.onTileEnter(2));

  expect(onSelectionChange).toHaveBeenLastCalledWith([3, 4, 5, 6]);
});

it("ends the drag when the pointer is released outside the grid", () => {
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange: vi.fn() }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  expect(result.current.isDragging).toBe(true);

  act(() => {
    document.dispatchEvent(new Event("pointerup"));
  });
  expect(result.current.isDragging).toBe(false);
});

// ---------------------------------------------------------------------
// Beyond the range arithmetic: the gesture's own edges.
// ---------------------------------------------------------------------

// Pressing the checkmark is itself a toggle — the tile has to answer under
// the finger, before any movement. Everything after that is the same
// snapshot recomputation with a one-tile range.
it("applies the origin tile immediately on pointerdown", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [8], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));

  expect(onSelectionChange).toHaveBeenLastCalledWith([8, 3]);
});

// A native image drag starting mid-gesture would take the pointer stream
// with it and strand the selection half-applied.
it("prevents the browser's default press behaviour", () => {
  const event = pointerEvent();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange: vi.fn() }),
  );

  act(() => result.current.onCheckPointerDown(2, event));

  expect(event.preventDefault).toHaveBeenCalled();
});

// Tiles report every pointer entry, drag or no drag — the hook has to
// ignore the ones that aren't part of a gesture rather than treat the last
// origin as still live.
it("ignores a tile entry when no drag is in progress", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange }),
  );

  act(() => result.current.onTileEnter(4));

  expect(onSelectionChange).not.toHaveBeenCalled();
});

it("does not keep applying tile entries after the drag has ended", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => {
    document.dispatchEvent(new Event("pointerup"));
  });
  const callsAtRelease = onSelectionChange.mock.calls.length;

  act(() => result.current.onTileEnter(7));

  expect(onSelectionChange).toHaveBeenCalledTimes(callsAtRelease);
});

// `pointercancel` fires when the browser takes the pointer away (a system
// gesture, a lost capture). Treated exactly like a release, so the drag
// can never be left live with no pointer behind it.
it("ends the drag on pointercancel", () => {
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange: vi.fn() }),
  );

  act(() => result.current.onCheckPointerDown(2, pointerEvent()));
  act(() => {
    document.dispatchEvent(new Event("pointercancel"));
  });

  expect(result.current.isDragging).toBe(false);
});

// The index and the tiles are cached separately, so a tile can report a
// position the entries array no longer has. Nothing should be selected
// from a position that doesn't exist.
it("ignores a pointerdown on an index the entries no longer cover", () => {
  const onSelectionChange = vi.fn();
  const { result } = renderHook(() =>
    useDragSelect({ entries, selectedIds: [], onSelectionChange }),
  );

  act(() => result.current.onCheckPointerDown(99, pointerEvent()));

  expect(onSelectionChange).not.toHaveBeenCalled();
  expect(result.current.isDragging).toBe(false);
});
