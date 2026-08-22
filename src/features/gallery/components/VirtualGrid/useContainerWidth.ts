import { useEffect, useRef, useState } from "react";

/**
 * Tracks the content width of the returned `ref`'s element via
 * `ResizeObserver`. Starts at 0 (unmeasured) until the first observation
 * fires, which callers use to skip layout work before a real size exists.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
