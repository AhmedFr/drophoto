import { vi, type Mock } from "vitest";

export type VirtualizerSpies = { measure: Mock };

/**
 * Factory for a `@tanstack/react-virtual` mock that renders every index
 * unconditionally, sized 260px apart, instead of relying on jsdom's lack
 * of real layout to decide what's "visible".
 *
 * `vi.mock` must be called literally at the top level of the test file
 * that needs it (Vitest hoists it above that file's imports via static
 * analysis of the call site, which only works when the call itself is
 * physically present in that file — not when it's wrapped in a function
 * defined elsewhere). Usage:
 *
 * ```ts
 * import { virtualizerMockFactory } from "@/test/mockVirtualizer";
 * vi.mock("@tanstack/react-virtual", () => virtualizerMockFactory());
 * ```
 *
 * To assert on `measure()` calls (e.g. after simulating a resize), create
 * the spy with `vi.hoisted` — so it exists before the hoisted `vi.mock`
 * call runs — and pass it in:
 *
 * ```ts
 * const virtualizerSpies = vi.hoisted(() => ({ measure: vi.fn() }));
 * vi.mock("@tanstack/react-virtual", () => virtualizerMockFactory(virtualizerSpies));
 * ```
 */
export function virtualizerMockFactory(spies?: VirtualizerSpies) {
  const measure = spies?.measure ?? vi.fn();
  return {
    useVirtualizer: (opts: { count: number }) => ({
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({
          index: i,
          start: i * 260,
          size: 260,
          key: i,
        })),
      getTotalSize: () => opts.count * 260,
      measureElement: () => {},
      measure,
    }),
  };
}
