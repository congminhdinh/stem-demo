import { CanvasTexture, NoColorSpace, SRGBColorSpace, type Texture } from 'three';
import type { Scenario } from '../../../core/scenario/scenario';
import { groundTextureSize } from '../ground-paint';
import { paintMat, paintMatRoughness, paintMatShading } from './mat-paint';

// The mat's canvases (N18 R4.7, GltfArena.tsx): its colours (as the line sensors read them), its roughness and its baked contact
// shading, painted from the scenario's vector paint. N18 P2: moved here from GltfArena.tsx; the low tier's mat (MeshLambertMaterial)
// has no roughness, so its roughness canvas is not painted.

export type MatTextures = { map: Texture; roughness: Texture | null; shading: Texture; dispose(): void };

/** The renderer's limits the mat is painted within. */
export type MatCaps = { maxTextureSize: number; maxAnisotropy: number };

/** The mat's canvases, as sharp as the renderer allows (the low tier's at 5 px a cm); null where a 2D canvas cannot be made. */
export function createMatTextures(scenario: Pick<Scenario, 'arena' | 'goals'>, low: boolean, caps: MatCaps): MatTextures | null {
  const { arena } = scenario;
  // The low tier paints 5 px a cm (a 2.5 cm tape is 12 px): a software renderer uploads and mipmaps every pixel.
  const longest = Math.max(...arena.ground.sizeCm);
  const { pxPerCm, width, height } = groundTextureSize(arena.ground.sizeCm, Math.min(4096, caps.maxTextureSize, low ? longest * 5 : Infinity));
  const canvas = (scale: number) => {
    const element = document.createElement('canvas');
    element.width = Math.max(1, Math.round(width * scale));
    element.height = Math.max(1, Math.round(height * scale));
    return element;
  };
  const colour = canvas(1);
  const shade = canvas(0.25);
  const rough = low ? null : canvas(0.5);
  const [c, s] = [colour.getContext('2d'), shade.getContext('2d')];
  const r = rough?.getContext('2d') ?? null;
  if (!c || !s || (rough && !r)) return null;
  paintMat(c, scenario, { pxPerCm });
  if (r) paintMatRoughness(r, arena, pxPerCm * 0.5);
  paintMatShading(s, arena, pxPerCm * 0.25);
  const map = new CanvasTexture(colour);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = Math.min(8, caps.maxAnisotropy);
  const roughness = rough ? new CanvasTexture(rough) : null;
  if (roughness) roughness.colorSpace = NoColorSpace;
  const shading = new CanvasTexture(shade);
  shading.colorSpace = NoColorSpace;
  return {
    map,
    roughness,
    shading,
    dispose() {
      map.dispose();
      roughness?.dispose();
      shading.dispose();
    },
  };
}
