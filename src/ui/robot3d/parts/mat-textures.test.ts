// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasTexture } from 'three';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { installFakeCanvas2d } from '../__fixtures__/fake-canvas-2d';
import { createMatTextures } from './mat-textures';

// N18 P2: the low tier's mat (MeshLambertMaterial) has no roughness: its roughness canvas is not painted (a canvas, its paint and its
// upload saved on a software renderer's first frame). The detailed tier's mat has all three.

const scenario = scenarioCatalog.get('rb-line-follow')!;
const caps = { maxTextureSize: 4096, maxAnisotropy: 16 };

beforeEach(() => installFakeCanvas2d());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the mat’s canvases (N18 P2)', () => {
  it('paints the colours, the roughness and the shading for the detailed tier', () => {
    const made = vi.spyOn(document, 'createElement');
    const mat = createMatTextures(scenario, false, caps)!;
    expect(made.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(3);
    expect(mat.map).toBeInstanceOf(CanvasTexture);
    expect(mat.roughness).toBeInstanceOf(CanvasTexture);
    expect(mat.shading).toBeInstanceOf(CanvasTexture);
    expect(mat.map.anisotropy).toBe(8);
    mat.dispose();
  });

  it('paints no roughness for the low tier: two canvases', () => {
    const made = vi.spyOn(document, 'createElement');
    const mat = createMatTextures(scenario, true, caps)!;
    expect(made.mock.calls.filter(([tag]) => tag === 'canvas')).toHaveLength(2);
    expect(mat.roughness).toBeNull();
    expect(mat.map).toBeInstanceOf(CanvasTexture);
    mat.dispose();
  });
});
