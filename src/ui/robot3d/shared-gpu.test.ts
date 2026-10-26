import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataTexture, Mesh, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, Scene, Sprite, SpriteMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { drawnDfgLut, releaseSharedGpu, sharedSpriteGeometry } from './shared-gpu';

// N18 P2 fix round 1 (I2): the page-wide resources three shares between renderers are disposed as the lab's canvas goes, so no dead
// renderer stays reachable through their 'dispose' listeners.

const three = join(process.cwd(), 'node_modules/three');

describe('three’s page-wide resources (N18 P2 fix round 1)', () => {
  it('finds the geometry every Sprite shares, and disposes it and the DFG texture when a canvas goes', () => {
    const geometry = sharedSpriteGeometry();
    expect(new Sprite(new SpriteMaterial()).geometry).toBe(geometry);
    expect(sharedSpriteGeometry()).toBe(geometry);
    const lut = new DataTexture(new Uint8Array(4), 1, 1);
    const [geometryGone, lutGone] = [vi.fn(), vi.fn()];
    geometry.addEventListener('dispose', geometryGone);
    lut.addEventListener('dispose', lutGone);
    releaseSharedGpu(lut);
    expect(geometryGone).toHaveBeenCalledTimes(1);
    expect(lutGone).toHaveBeenCalledTimes(1);
    releaseSharedGpu(null);
    expect(geometryGone).toHaveBeenCalledTimes(2);
    geometry.removeEventListener('dispose', geometryGone);
  });

  it('finds the DFG texture through a standard material the renderer drew, and none in a scene without one', () => {
    const lut = new DataTexture(new Uint8Array(4), 1, 1);
    lut.name = 'DFG_LUT';
    const standard = new MeshStandardMaterial();
    const lambert = new MeshLambertMaterial();
    const renderer = { properties: { get: (material: object) => (material === standard ? { uniforms: { dfgLUT: { value: lut } } } : {}) } };
    const lit = new Scene().add(new Mesh(new PlaneGeometry(), lambert), new Mesh(new PlaneGeometry(), [lambert, standard]));
    expect(drawnDfgLut(renderer as never, lit)).toBe(lut);
    expect(drawnDfgLut(renderer as never, new Scene().add(new Mesh(new PlaneGeometry(), lambert)))).toBeNull();
  });

  it('pins the three internals it reaches: three 0.186.1 shares one Sprite geometry and one DFG texture named DFG_LUT, given as the dfgLUT uniform', () => {
    // When three changes these, the lab's release must be looked at again (shared-gpu.ts).
    expect(JSON.parse(readFileSync(join(three, 'package.json'), 'utf8')).version).toBe('0.186.1');
    const module = readFileSync(join(three, 'build/three.module.js'), 'utf8');
    const core = readFileSync(join(three, 'build/three.core.js'), 'utf8');
    expect(module).toContain("lut.name = 'DFG_LUT';");
    expect(module).toContain('m_uniforms.dfgLUT.value = getDFGLUT();');
    expect(core).toContain('this.geometry = _geometry;');
  });
});
