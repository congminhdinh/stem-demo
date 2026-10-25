import { useLayoutEffect, useState } from 'react';

// What floats over the 3D view (N18 R4.7), measured from the page in the view's normalised device coordinates: the HUD's corner (it sits
// at the top left and grows with the scenario's goals) and the view tools' corner (R4.8, at the bottom left; it grows when the D-pad
// opens), so the free camera view frames the lesson clear of them; and the check's results card while it is open (R6.3, at the top
// right), so the camera keeps the robot's end spot in the part of the view the card leaves.
// The view's element comes and goes (the 2D map in its place, a canvas that failed and is tried again): the hook gives a callback ref,
// and measures the element it holds now, so a view made again is measured again.

export type HudCorner = { right: number; bottom: number };
/** The view tools' corner at the bottom left: everything left of `right` and under `top` (NDC) is covered. */
export type ToolsCorner = { right: number; top: number };
/** The open results card: everything right of `left` (NDC x) is covered. */
export type CardEdge = { left: number };
export type ViewOverlays = { hud: HudCorner | null; card: CardEdge | null; tools: ToolsCorner | null };

const NONE: ViewOverlays = { hud: null, card: null, tools: null };
/** The room kept round an overlay, px. */
const GAP_PX = 8;

const same = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) < 0.01;
const sameCorner = <T extends Record<string, number>>(a: T | null, b: T | null) => a === b || (a !== null && b !== null && Object.keys(a).every((key) => same(a[key], b[key])));

/** The overlays as measured on the page: `view` the view's box, the others each null where it is not there (or not laid out). */
export function overlaysOf(view: DOMRect, hud: DOMRect | null, card: DOMRect | null, tools: DOMRect | null): ViewOverlays {
  if (view.width === 0 || view.height === 0) return NONE;
  const x = (px: number) => -1 + (2 * (px - view.left)) / view.width;
  const y = (px: number) => 1 - (2 * (px - view.top)) / view.height;
  return {
    hud: hud && hud.width > 0 ? { right: x(hud.right + GAP_PX), bottom: y(hud.bottom + GAP_PX) } : null,
    card: card && card.width > 0 ? { left: x(card.left - GAP_PX) } : null,
    tools: tools && tools.width > 0 ? { right: x(tools.right + GAP_PX), top: y(tools.top - GAP_PX) } : null,
  };
}

/**
 * The overlays over the view: `ref` goes on the view's element; each overlay null until laid out, or while it is not there (the card
 * folded or closed, the tools hidden during a check).
 */
export function useViewOverlays(): { ref: (element: HTMLElement | null) => void; overlays: ViewOverlays } {
  const [view, setView] = useState<HTMLElement | null>(null);
  const [overlays, setOverlays] = useState<ViewOverlays>(NONE);
  useLayoutEffect(() => {
    const stage = view?.closest('.robot-stage');
    if (!view || !stage || typeof ResizeObserver === 'undefined') {
      setOverlays(NONE);
      return;
    }
    const watched = new Set<Element>();
    const resize = new ResizeObserver(() => measure());
    const measure = () => {
      const hudElement = stage.querySelector<HTMLElement>('[data-testid=robot-hud]');
      const cardElement = stage.querySelector<HTMLElement>('[data-testid=robot-check-results][data-open=true]');
      const toolsElement = stage.querySelector<HTMLElement>('[data-testid=robot-tools]');
      for (const element of [hudElement, cardElement, toolsElement]) {
        if (element && !watched.has(element)) {
          watched.add(element);
          resize.observe(element);
        }
      }
      const next = overlaysOf(view.getBoundingClientRect(), hudElement?.getBoundingClientRect() ?? null, cardElement?.getBoundingClientRect() ?? null, toolsElement?.getBoundingClientRect() ?? null);
      if (next === NONE) return;
      setOverlays((old) => {
        const hud = sameCorner(old.hud, next.hud) ? old.hud : next.hud;
        const card = sameCorner(old.card, next.card) ? old.card : next.card;
        const tools = sameCorner(old.tools, next.tools) ? old.tools : next.tools;
        return hud === old.hud && card === old.card && tools === old.tools ? old : { hud, card, tools };
      });
    };
    measure();
    resize.observe(view);
    // The card and the tools' panels come and go (a check's result, folded, closed; the D-pad): watch the stage for them.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => measure());
    mutations?.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open', 'hidden', 'class'] });
    return () => {
      resize.disconnect();
      mutations?.disconnect();
    };
  }, [view]);
  return { ref: setView, overlays };
}
