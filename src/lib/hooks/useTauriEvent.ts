import { useEffect, useRef } from "react";
import { onEvent } from "@/lib/api/events";

/**
 * Subscribes `handler` to the Tauri event `name` for the lifetime of the
 * calling component, unsubscribing on unmount (or if unmount happens before
 * the underlying `listen()` promise resolves).
 *
 * `handler` is read through a ref so that passing a fresh inline callback on
 * every render does not tear down and re-create the subscription.
 */
export function useTauriEvent<T>(name: string, handler: (payload: T) => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onEvent<T>(name, (payload) => handlerRef.current(payload)).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [name]);
}
