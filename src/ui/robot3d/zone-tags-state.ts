// What the 3D view's tags over the zones and the objects say and whether each is shown (N18 R4.7, N19 E5), for the E2E, which loads this
// module from the dev server (the very instance the lab runs on, as sensor-overlay-state.ts is loaded). The tags register under their canvas.

export type ZoneTagsProbe = { id: string; kind: 'zone' | 'object'; text: string | null; number: number | null; visible: boolean }[];

const readers = new WeakMap<Element, () => ZoneTagsProbe>();

/** The tags of the canvas `canvas`; the returned function takes them away again. */
export function registerZoneTags(canvas: Element, read: () => ZoneTagsProbe): () => void {
  readers.set(canvas, read);
  return () => {
    if (readers.get(canvas) === read) readers.delete(canvas);
  };
}

/** The tags of the lab's canvas as they are now; null without any. */
export function readZoneTags(canvas: Element | null = document.querySelector('[data-testid=robot-canvas] canvas')): ZoneTagsProbe | null {
  return canvas === null ? null : (readers.get(canvas)?.() ?? null);
}
