import { DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, type Texture } from 'three';
import { blobPixels, fbmField, heightToNormal, type Pixels } from './pixels';

// The few textures the 3D view makes at run time (N18 R4.7), beside the modelled parts' own (robot-kit.glb, arena-props.glb): the mat's
// paper fibres (a tiled normal map) and the soft round contact shadow. Their pixels are computed once per page;
// the textures belong to one scene and are disposed with it.

export type TextureSet = {
  /** The mat's paper fibres: a tiled normal map (its roughness is painted with its colours, mat-paint.ts); null where it is not drawn. */
  matNormal: Texture | null;
  /** A soft contact shadow (alpha in the green channel, as an alphaMap reads it). */
  blob: Texture;
  dispose(): void;
};

const pixelCache = new Map<string, Pixels>();
function cached(key: string, make: () => Pixels): Pixels {
  let made = pixelCache.get(key);
  if (!made) {
    made = make();
    pixelCache.set(key, made);
  }
  return made;
}

function texture(pixels: Pixels, anisotropy: number, repeat: boolean): DataTexture {
  const made = new DataTexture(pixels.data, pixels.width, pixels.height);
  made.colorSpace = NoColorSpace;
  if (repeat) {
    made.wrapS = RepeatWrapping;
    made.wrapT = RepeatWrapping;
  }
  made.minFilter = LinearMipmapLinearFilter;
  made.generateMipmaps = true;
  made.anisotropy = anisotropy;
  made.needsUpdate = true;
  return made;
}

/**
 * The scene's run-time textures; `anisotropy` is the renderer's (capped by the caller). N18 P2: `matNormal: false` (the low tier, look.ts)
 * makes no fibre map, nor its pixels.
 */
export function createTextureSet(anisotropy: number, options: { matNormal?: boolean } = {}): TextureSet {
  const set = {
    matNormal: options.matNormal === false ? null : texture(cached('mat-normal', () => heightToNormal(fbmField(256, 256, { seed: 11, cells: 32, octaves: 3, gain: 0.55 }), 256, 256, 1.6)), anisotropy, true),
    blob: texture(cached('blob', () => blobPixels(64)), 1, false),
  };
  return {
    ...set,
    dispose() {
      for (const made of Object.values(set)) made?.dispose();
    },
  };
}
