import { useLayoutEffect, useState, type RefObject } from 'react';

// What floats over the 3D view (N18 R4.7), measured from the page in the view's normalised device coordinates: the HUD's corner (it sits
// at the top left and grows with the scenario's goals), so the free camera view frames the lesson clear of it; and the check's results
// card while it is open (R6.3, at the top right), so the camera keeps the robot's end spot in the part of the view the card leaves.

export type HudCorner = { right: number; bottom: number };
/** The open results card: everything right of `left` (NDC x) is covered. */
export type CardEdge = { left: number };
export type ViewOverlays = { hud: HudCorner | null; card: CardEdge | null };

const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 0.01;

/** The overlays over the view `scene` is in; each null until laid out, or while it is not there (the card folded or closed). */
export function useViewOverlays(scene: RefObject<HTMLElement | null>): ViewOverlays {
  const [overlays, setOverlays] = useState<ViewOverlays>({ hud: null, card: null });
  useLayoutEffect(() => {
    const view = scene.current;
    const stage = view?.closest('.robot-stage');
    if (!view || !stage || typeof ResizeObserver === 'undefined') return;
    const watched = new Set<Element>();
    const resize = new ResizeObserver(() => measure());
    const measure = () => {
      const a = view.getBoundingClientRect();
      if (a.width === 0 || a.height === 0) return;
      const hudElement = stage.querySelector<HTMLElement>('[data-testid=robot-hud]');
      const cardElement = stage.querySelector<HTMLElement>('[data-testid=robot-check-results][data-open=true]');
      for (const element of [hudElement, cardElement]) {
        if (element && !watched.has(element)) {
          watched.add(element);
          resize.observe(element);
        }
      }
      const b = hudElement?.getBoundingClientRect();
      const c = cardElement?.getBoundingClientRect();
      const hud = b && b.width > 0 ? { right: -1 + (2 * (b.right - a.left + 8)) / a.width, bottom: 1 - (2 * (b.bottom - a.top + 8)) / a.height } : null;
      const card = c && c.width > 0 ? { left: -1 + (2 * (c.left - a.left - 8)) / a.width } : null;
      setOverlays((old) => {
        const hudSame = old.hud === hud || (old.hud !== null && hud !== null && same(old.hud.right, hud.right) && same(old.hud.bottom, hud.bottom));
        const cardSame = old.card === card || (old.card !== null && card !== null && same(old.card.left, card.left));
        return hudSame && cardSame ? old : { hud: hudSame ? old.hud : hud, card: cardSame ? old.card : card };
      });
    };
    measure();
    resize.observe(view);
    // The card comes and goes (a check's result, folded, closed): watch the stage for it.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => measure());
    mutations?.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open'] });
    return () => {
      resize.disconnect();
      mutations?.disconnect();
    };
  }, [scene]);
  return overlays;
}
