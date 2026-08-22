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
 */
export function virtualizerMockFactory() {
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
    }),
  };
}
