import { useLayoutEffect, useState, type RefObject } from 'react';

export type Size = { width: number; height: number };

/** Tracks the content size of an element; null until it has been measured. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Measured before the first paint, so a remounted canvas never shows (or
    // exposes) an empty frame; the observer keeps it up to date afterwards.
    setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
