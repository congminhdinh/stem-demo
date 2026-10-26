import { Sprite, SpriteMaterial, type BufferGeometry, type Material, type Mesh, type Object3D, type Texture, type WebGLRenderer } from 'three';

// N18 P2 fix round 1 (I2): three keeps two resources for the whole page, and every WebGLRenderer that draws them adds a 'dispose' listener
// to them: the Sprite's shared geometry (three's Sprite.js: every sprite the lab draws, the zones' tags, the distance tag, the line lamps'
// glows, the floor picker's marks) and the DFG lookup texture of the standard materials (DFGLUTData.js `getDFGLUT`, on the high tier). The
// lab's canvas goes with each 2D ↔ 3D and tier switch, and its renderer stayed reachable through those listeners, with its context's
// wrapper and its detached canvas (the review: 41 listeners on the geometry after 41 mounts, about 0.1–0.2 MB a mount). Disposing them as
// a canvas goes makes each renderer drop its copy and its listener; the next canvas uploads them again (4 vertices, a 16 × 16 texture).
// The texture is reached through three's internals (the renderer's properties of a standard material it drew): shared-gpu.test.ts fails
// when three 0.186.1's names for it change.

let spriteGeometry: BufferGeometry | null = null;

/** The geometry every three Sprite shares. */
export function sharedSpriteGeometry(): BufferGeometry {
  if (!spriteGeometry) {
    const material = new SpriteMaterial();
    spriteGeometry = new Sprite(material).geometry;
    material.dispose();
  }
  return spriteGeometry;
}

/** The DFG lookup texture `renderer` gave a standard material of `scene` it has drawn, or null (none drawn: the low tier). */
export function drawnDfgLut(renderer: Pick<WebGLRenderer, 'properties'>, scene: Object3D): Texture | null {
  let found: Texture | null = null;
  scene.traverse((node) => {
    if (found) return;
    const materials = (node as Mesh).material;
    for (const material of Array.isArray(materials) ? materials : materials ? [materials as Material] : []) {
      if (!(material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) continue;
      const value = (renderer.properties.get(material) as { uniforms?: { dfgLUT?: { value?: Texture | null } } } | undefined)?.uniforms?.dfgLUT?.value;
      if (value?.isTexture && value.name === 'DFG_LUT') {
        found = value;
        return;
      }
    }
  });
  return found;
}

/** Disposes the page-wide resources a canvas that goes drew (the sprite geometry, and the DFG texture when it found one). */
export function releaseSharedGpu(dfgLut: Texture | null): void {
  sharedSpriteGeometry().dispose();
  dfgLut?.dispose();
}
