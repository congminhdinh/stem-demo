import { describe, expect, it, vi } from 'vitest';
import { probeWebgl, tierForRenderer, tierSettings } from './quality';

// N18 R4.2, ADR 0002 §6: two quality tiers. High has shadows ("percentage", PCF), a pixel ratio up to 1.5 and MSAA; low has none of
// them. A software renderer (SwiftShader, llvmpipe) gets the low tier by default: there the high tier's slowest frames fell to 30 fps.

describe('quality tiers (N18 R4.2, ADR 0002 §6)', () => {
  it('picks low for a software renderer and high for a GPU, or when the renderer does not say', () => {
    expect(tierForRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)')).toBe('low');
    expect(tierForRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
    expect(tierForRenderer('Google SwiftShader')).toBe('low');
    expect(tierForRenderer('Software Rasterizer')).toBe('low');
    expect(tierForRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)')).toBe('high');
    expect(tierForRenderer(null)).toBe('high');
  });

  it('sets shadows, pixel ratio and antialiasing per tier as the ADR measured them', () => {
    expect(tierSettings).toEqual({
      high: { shadows: 'percentage', dpr: [1, 1.5], antialias: true, shadowMapSize: 2048 },
      low: { shadows: false, dpr: 1, antialias: false, shadowMapSize: 0 },
    });
  });
});

/** A canvas whose WebGL context says `renderer`; `null` when WebGL is not available. */
function fakeCanvas(renderer: string | null, options: { debugInfo?: boolean; webgl2?: boolean } = {}) {
  const loseContext = vi.fn();
  const context =
    renderer === null
      ? null
      : {
          RENDERER: 0x1f01,
          getExtension: (name: string) =>
            name === 'WEBGL_debug_renderer_info' ? (options.debugInfo === false ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 }) : name === 'WEBGL_lose_context' ? { loseContext } : null,
          getParameter: (parameter: number) => (parameter === 0x9246 ? renderer : parameter === 0x1f01 ? 'WebKit WebGL' : null),
        };
  const getContext = vi.fn((kind: string) => (kind === 'webgl2' && options.webgl2 === false ? null : context));
  return { canvas: { getContext } as unknown as HTMLCanvasElement, getContext, loseContext };
}

describe('the WebGL probe (N18 R4.2)', () => {
  it('reads the unmasked renderer of a WebGL 2 context, then gives the context back', () => {
    const { canvas, getContext, loseContext } = fakeCanvas('Google SwiftShader');
    expect(probeWebgl(() => canvas)).toEqual({ ok: true, renderer: 'Google SwiftShader' });
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('falls back to WebGL 1 and to the masked renderer', () => {
    expect(probeWebgl(() => fakeCanvas('Apple GPU', { webgl2: false }).canvas)).toEqual({ ok: true, renderer: 'Apple GPU' });
    expect(probeWebgl(() => fakeCanvas('Apple GPU', { debugInfo: false }).canvas)).toEqual({ ok: true, renderer: 'WebKit WebGL' });
  });

  it('says no when there is no WebGL, or when asking throws', () => {
    expect(probeWebgl(() => fakeCanvas(null).canvas)).toEqual({ ok: false });
    expect(
      probeWebgl(() => {
        throw new Error('no canvas');
      }),
    ).toEqual({ ok: false });
  });
});
