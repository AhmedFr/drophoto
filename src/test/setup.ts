import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { clearMocks } from "@tauri-apps/api/mocks";

// jsdom implements neither `scrollTo` nor `scrollIntoView`, so anything
// that calls them (TanStack Router's scroll restoration, Radix
// DropdownMenu/Tooltip positioning) logs a "Not implemented" warning per
// call across the whole suite. Stub both globally so tests stay quiet.
window.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

// Node >=22 exposes its own global `localStorage` (stable on newer
// releases), which shadows jsdom's implementation in vitest's jsdom test
// environment — `window` and `globalThis` are the same object there, so
// Node's non-functional stub (it only works when Node is started with
// `--localstorage-file`) ends up as `localStorage` everywhere, and any
// persisted store's `storage.setItem` throws. Detect that stub and rebind
// the global to a real jsdom `Storage` instance before any test imports a
// persisted store, so `localStorage` behaves the same across Node versions.
if (typeof window !== "undefined" && typeof window.localStorage?.setItem !== "function") {
  // `jsdom` ships no type declarations of its own; cast the require result
  // to the minimal shape used here instead of pulling in a full types
  // package just for this one-off constructor.
  type JSDOMModule = { JSDOM: new (html: string, options: { url: string }) => { window: { localStorage: Storage } } };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- sync require keeps this a plain top-level guard, not an async setup step
  const { JSDOM } = require("jsdom") as JSDOMModule;
  const jsdomStorage = new JSDOM("", { url: "http://localhost" }).window.localStorage;
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, "localStorage", {
      value: jsdomStorage,
      configurable: true,
      writable: true,
    });
  }
}

afterEach(() => {
  cleanup();
  clearMocks();
});
