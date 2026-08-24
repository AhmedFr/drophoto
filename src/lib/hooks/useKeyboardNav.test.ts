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

// `keydown` is bound on `window`, so every keystroke anywhere in the app
// reaches it — including one typed into a text field. Navigating the
// lightbox because someone moved the caret inside a tag filter would be
// baffling, so the tests below pin that typed-into elements are left alone.
function fireKeyFrom(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function mountTarget(el: HTMLElement) {
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("ignores arrow keys typed into an input", () => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose: vi.fn(), onPrev, onNext }));
  const input = mountTarget(document.createElement("input"));

  fireKeyFrom(input, "ArrowLeft");
  fireKeyFrom(input, "ArrowRight");

  expect(onPrev).not.toHaveBeenCalled();
  expect(onNext).not.toHaveBeenCalled();
});

it("ignores keys typed into a textarea", () => {
  const onClose = vi.fn();
  const onPrev = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose, onPrev, onNext: vi.fn() }));
  const textarea = mountTarget(document.createElement("textarea"));

  fireKeyFrom(textarea, "ArrowLeft");
  fireKeyFrom(textarea, "Escape");

  expect(onPrev).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("ignores keys typed into a contenteditable element", () => {
  const onNext = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose: vi.fn(), onPrev: vi.fn(), onNext }));
  const editable = mountTarget(document.createElement("div"));
  editable.contentEditable = "true";
  // jsdom doesn't implement `isContentEditable` off the attribute.
  Object.defineProperty(editable, "isContentEditable", { value: true });

  fireKeyFrom(editable, "ArrowRight");

  expect(onNext).not.toHaveBeenCalled();
});

it("still navigates for keys pressed on a non-editable element", () => {
  const onNext = vi.fn();
  renderHook(() => useKeyboardNav({ enabled: true, onClose: vi.fn(), onPrev: vi.fn(), onNext }));
  const button = mountTarget(document.createElement("button"));

  fireKeyFrom(button, "ArrowRight");

  expect(onNext).toHaveBeenCalledTimes(1);
});
