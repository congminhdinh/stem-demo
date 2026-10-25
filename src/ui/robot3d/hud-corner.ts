import { useLayoutEffect, useState, type RefObject } from 'react';

// Where the HUD covers the 3D view (N18 R4.7): its corner in the view's normalised device coordinates, measured from the page (the HUD
// floats over the view's top left and grows with the scenario's goals), so the free camera view frames the lesson clear of it.

export type HudCorner = { right: number; bottom: number };

/** The HUD's bottom right corner over the view `scene` is in, NDC; null until both are laid out (or without a HUD). */
export function useHudCorner(scene: RefObject<HTMLElement | null>): HudCorner | null {
  const [corner, setCorner] = useState<HudCorner | null>(null);
  useLayoutEffect(() => {
    const view = scene.current;
    const hud = view?.closest('.robot-stage')?.querySelector<HTMLElement>('[data-testid=robot-hud]');
    if (!view || !hud || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const a = view.getBoundingClientRect();
      const b = hud.getBoundingClientRect();
      if (a.width === 0 || a.height === 0 || b.width === 0) return;
      const next = { right: -1 + (2 * (b.right - a.left + 8)) / a.width, bottom: 1 - (2 * (b.bottom - a.top + 8)) / a.height };
      setCorner((old) => (old && Math.abs(old.right - next.right) < 0.01 && Math.abs(old.bottom - next.bottom) < 0.01 ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    observer.observe(hud);
    return () => observer.disconnect();
  }, [scene]);
  return corner;
}
