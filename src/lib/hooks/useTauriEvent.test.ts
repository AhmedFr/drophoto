import { renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useTauriEvent } from "./useTauriEvent";

vi.mock("@tauri-apps/api/event");

it("subscribes on mount and forwards payloads to the latest handler", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());

  const handler = vi.fn();
  renderHook(() => useTauriEvent<{ n: number }>("some-event", handler));

  await vi.waitFor(() => expect(listen).toHaveBeenCalledWith("some-event", expect.any(Function)));
  const onEvent = vi.mocked(listen).mock.calls[vi.mocked(listen).mock.calls.length - 1][1];

  onEvent({ payload: { n: 1 } } as never);
  expect(handler).toHaveBeenCalledWith({ n: 1 });
});

it("unsubscribes on unmount", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);

  const { unmount } = renderHook(() => useTauriEvent("some-event", vi.fn()));
  await vi.waitFor(() => expect(listen).toHaveBeenCalled());

  unmount();
  await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
});

it("unsubscribes even if the listen promise resolves after unmount", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = vi.fn();
  let resolveListen: (fn: typeof unlisten) => void = () => {};
  vi.mocked(listen).mockReturnValue(
    new Promise((resolve) => {
      resolveListen = resolve;
    }),
  );

  const { unmount } = renderHook(() => useTauriEvent("some-event", vi.fn()));
  unmount();
  resolveListen(unlisten);

  await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
});

it("does not resubscribe when the handler identity changes across renders", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  const callsBefore = vi.mocked(listen).mock.calls.length;

  const { rerender } = renderHook(({ handler }) => useTauriEvent("some-event", handler), {
    initialProps: { handler: vi.fn() },
  });
  await vi.waitFor(() => expect(vi.mocked(listen).mock.calls.length).toBe(callsBefore + 1));

  rerender({ handler: vi.fn() });
  expect(vi.mocked(listen).mock.calls.length).toBe(callsBefore + 1);
});
