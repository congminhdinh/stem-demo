// The quality tiers of the robot lab's 3D view (N18 R4.2, ADR 0002 §6, measured in spikes/robot-render). High: PCF shadows from one sun
// with a 2048² map, a pixel ratio up to 1.5 and MSAA. Low: no shadows, a pixel ratio of 1, no MSAA. A software renderer (SwiftShader,
// llvmpipe: no GPU, as in a school's virtual desktop or a CI runner) starts on low, because there the high tier's slowest frames fell to
// about 30 fps under load while low held 54; a GPU starts on high. The learner can switch (the view's quality button). Antialiasing is
// fixed when a WebGL context is made, so a change of tier makes a new canvas.

export type QualityTier = 'high' | 'low';

export type TierSettings = {
  /** R3F's `shadows`: "percentage" is three's PCFShadowMap (R3F's `true` asks for PCFSoftShadowMap, which three 0.186 removed). */
  shadows: 'percentage' | false;
  dpr: number | [number, number];
  antialias: boolean;
  /** The sun's shadow map, pixels a side; 0 without shadows. */
  shadowMapSize: number;
};

export const tierSettings: Readonly<Record<QualityTier, Readonly<TierSettings>>> = {
  high: { shadows: 'percentage', dpr: [1, 1.5], antialias: true, shadowMapSize: 2048 },
  low: { shadows: false, dpr: 1, antialias: false, shadowMapSize: 0 },
};

// N18 R4.7 fix round 1: Windows' software renderers too (the Microsoft Basic Render Driver, WARP). A renderer that is slow and named
// otherwise starts on high, and gives way to low when a run's frames are slow (frame-watch.ts).
const softwareRenderer = /swiftshader|llvmpipe|software|basic render|\bwarp\b/i;

/** The tier a renderer starts on: low for a software one, high otherwise (also when the browser does not name it). */
export function tierForRenderer(renderer: string | null): QualityTier {
  return renderer !== null && softwareRenderer.test(renderer) ? 'low' : 'high';
}

export type WebglProbe = { ok: true; renderer: string | null } | { ok: false };

/** WEBGL_debug_renderer_info's constant, and WebGL's RENDERER. */
const UNMASKED_RENDERER_WEBGL = 0x9246;

/**
 * Whether this browser can draw WebGL, and its renderer's name (unmasked when the browser tells it). The context it makes is given back
 * at once (WEBGL_lose_context), so the scene's own canvas is the only one that stays.
 */
export function probeWebgl(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): WebglProbe {
  try {
    const canvas = createCanvas();
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl === null) {
      return { ok: false };
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = debug ? gl.getParameter(UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: true, renderer: typeof name === 'string' ? name : null };
  } catch {
    // A browser that refuses even to make a canvas or a context draws no 3D.
    return { ok: false };
  }
}
