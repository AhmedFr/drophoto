import { vi } from "vitest";

/**
 * Mocks `@tanstack/react-virtual` so `useVirtualizer` renders every index
 * unconditionally, sized 260px apart, instead of relying on jsdom's lack
 * of real layout to decide what's "visible". Call this at module scope in
 * a test file (`vi.mock` is hoisted, so it must be a top-level call, not
 * inside a `beforeEach`).
 */
export function mockUseVirtualizer() {
  vi.mock("@tanstack/react-virtual", () => ({
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
  }));
}
