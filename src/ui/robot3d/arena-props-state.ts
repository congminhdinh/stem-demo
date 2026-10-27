// Which colour of each recoloured object's 3D prop is shown now (N19 E10), for the E2E, which loads this module from the dev server (the
// very instance the lab runs on, as zone-tags-state.ts is loaded): the scene is a canvas, so the colour a round paints the cube in is read
// from the scene's own state, not from pixels. The arena registers its reader under its canvas (parts/GltfArena.tsx).

/** The colour (lower case, as the scenario writes it) of the prop each recoloured object shows now: an object a round can recolour only. */
export type ArenaPropsProbe = { id: string; shown: string[] }[];

const readers = new WeakMap<Element, () => ArenaPropsProbe>();

/** The props of the canvas `canvas`; the returned function takes them away again. */
export function registerArenaProps(canvas: Element, read: () => ArenaPropsProbe): () => void {
  readers.set(canvas, read);
  return () => {
    if (readers.get(canvas) === read) readers.delete(canvas);
  };
}

/** The recoloured objects' props of the lab's canvas as they are now; null without any (no canvas, or an arena drawn from simple shapes). */
export function readArenaProps(canvas: Element | null = document.querySelector('[data-testid=robot-canvas] canvas')): ArenaPropsProbe | null {
  return canvas === null ? null : (readers.get(canvas)?.() ?? null);
}
