import { afterEach, describe, expect, it, vi } from 'vitest';

// N18 P2: the low tier draws the mat without its paper fibres (look.ts `matNormal`), so its texture set does not compute them: the fibre
// field is some 30 ms of a software renderer's first frame at 6× CPU, for a texture nothing would sample.

const fbm = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./pixels', async (importOriginal) => {
  const pixels = await importOriginal<typeof import('./pixels')>();
  return {
    ...pixels,
    fbmField: (...args: Parameters<typeof pixels.fbmField>) => {
      fbm.calls += 1;
      return pixels.fbmField(...args);
    },
  };
});

const { createTextureSet } = await import('./textures');

afterEach(() => vi.restoreAllMocks());

describe('the 3D view’s run-time textures (N18 P2)', () => {
  it('makes no fibre normal map for a scene that draws none, and computes its field only for one that does (once a page)', () => {
    const light = createTextureSet(1, { matNormal: false });
    expect(light.matNormal).toBeNull();
    expect(light.blob).not.toBeNull();
    expect(fbm.calls).toBe(0);
    const detailed = createTextureSet(8);
    expect(detailed.matNormal).not.toBeNull();
    expect(detailed.matNormal!.anisotropy).toBe(8);
    expect(fbm.calls).toBe(1);
    createTextureSet(8, { matNormal: true }).dispose();
    expect(fbm.calls).toBe(1);
    light.dispose();
    detailed.dispose();
  });
});
