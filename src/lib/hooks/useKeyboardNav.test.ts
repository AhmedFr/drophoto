import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useKeyboardNav } from "./useKeyboardNav";

function fireKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

it("calls onClose on Escape", () => {
  const onClose = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose, onPrev: vi.fn(), onNext: vi.fn() }));

  fireKey("Escape");

  expect(onClose).toHaveBeenCalledTimes(1);
});

it("calls onNext on ArrowRight", () => {
  const onNext = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose: vi.fn(), onPrev: vi.fn(), onNext }));

  fireKey("ArrowRight");

  expect(onNext).toHaveBeenCalledTimes(1);
});

it("calls onPrev on ArrowLeft", () => {
  const onPrev = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose: vi.fn(), onPrev, onNext: vi.fn() }));

  fireKey("ArrowLeft");

  expect(onPrev).toHaveBeenCalledTimes(1);
});

it("does nothing when disabled", () => {
  const onClose = vi.fn();
  const onPrev = vi.fn();
  const onNext = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: false, onClose, onPrev, onNext }));

  fireKey("Escape");
  fireKey("ArrowLeft");
  fireKey("ArrowRight");

  expect(onClose).not.toHaveBeenCalled();
  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});

it("removes the listener on unmount", () => {
  const removeSpy = vi.spyOn(window, "removeEventListener");
  const { unmount } = renderHook(() =>
    useKeyboardNav({ enabled: true, onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn() }),
  );

  unmount();

  expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  removeSpy.mockRestore();
});
