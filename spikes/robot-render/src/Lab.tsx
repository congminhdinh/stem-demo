// The lazy 3D chunk of the render spike (N18 R0.2): an R3F <Canvas> with the arena, the robot and a replay of 1 000
// recorded poses. main.tsx loads this module with React.lazy, as the real lab will.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Controls } from '@controls';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { WebGLRenderer, type DirectionalLight } from 'three';
import { generatePoses, TICKS } from './path';
import { Arena, Robot, type Sim } from './scene';

export type Tier = 'high' | 'low';

export interface LabProps {
  tier: Tier;
  antialias: boolean;
  autoRun: boolean;
  controlsName: string;
  /** Stress test: this many extra robots (about 20 draw calls each) on top of the base scene. */
  extra: number;
}

interface Stats {
  frames: number;
  last: number;
  dt: number[];
  renderMs: number[];
}

interface SpikeMarks {
  importStart?: number;
  importEnd?: number;
  labRender?: number;
  glStart?: number;
  glEnd?: number;
}

export interface SpikeApi {
  tier: Tier;
  controls: string;
  boot: { importStart: number; importEnd: number; labRender: number; glStart: number; glEnd: number; canvasCreated: number; firstFrame: number };
  run: () => void;
  stop: () => void;
  resetStats: () => void;
  stats: () => Record<string, unknown>;
  cameraPosition: () => number[];
  loseContext: () => boolean;
  restoreContext: () => boolean;
  sample: () => { lost: boolean; pixels: number[][]; hash: string };
  invalidate: () => void;
  contextEvents: { type: string; t: number; defaultPrevented: boolean }[];
}

declare global {
  interface Window {
    __spike?: SpikeApi;
    __spikeMarks?: SpikeMarks;
  }
}

function Sun({ high }: { high: boolean }) {
  const light = useRef<DirectionalLight>(null);
  useLayoutEffect(() => {
    const sun = light.current;
    if (!sun) return;
    const cam = sun.shadow.camera;
    cam.left = -1.5;
    cam.right = 1.5;
    cam.top = 1.5;
    cam.bottom = -1.5;
    cam.near = 0.5;
    cam.far = 6;
    cam.updateProjectionMatrix();
  }, []);
  return (
    <directionalLight
      ref={light}
      position={[1.2, 2.4, 0.8]}
      intensity={1.6}
      castShadow={high}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
    />
  );
}

/** Advances the virtual replay clock once per frame (before any robot reads it). */
function ReplayClock({ sim }: { sim: { current: Sim } }) {
  useFrame((_state, delta) => {
    if (sim.current.running) sim.current.time += Math.min(delta, 0.1);
  }, -20);
  return null;
}

/** Lives inside the Canvas: collects frame statistics and publishes window.__spike. */
function Probe({ sim, tier, controlsName, autoRun }: { sim: { current: Sim }; tier: Tier; controlsName: string; autoRun: boolean }) {
  const { gl, scene, camera, setFrameloop, invalidate } = useThree();
  const stats = useRef<Stats>({ frames: 0, last: 0, dt: [], renderMs: [] });
  const firstFrame = useRef(0);
  const canvasCreated = useRef(performance.now());

  useFrame(() => {
    const now = performance.now();
    const s = stats.current;
    if (firstFrame.current === 0) firstFrame.current = now;
    if (s.last !== 0 && s.dt.length < 20000) s.dt.push(now - s.last);
    s.last = now;
    s.frames += 1;
  }, -10);

  useEffect(() => {
    const original = gl.render.bind(gl);
    // Wall-clock cost of each gl.render call on the main thread (command submission, not GPU time).
    gl.render = (renderScene, renderCamera) => {
      const t = performance.now();
      original(renderScene, renderCamera);
      if (stats.current.renderMs.length < 20000) stats.current.renderMs.push(performance.now() - t);
    };
    const canvas = gl.domElement;
    const contextEvents: SpikeApi['contextEvents'] = [];
    const record = (event: Event) =>
      contextEvents.push({ type: event.type, t: performance.now(), defaultPrevented: event.defaultPrevented });
    // Added after three's own listeners, so defaultPrevented shows whether three accepted a restore.
    canvas.addEventListener('webglcontextlost', record);
    canvas.addEventListener('webglcontextrestored', record);
    const context = gl.getContext();
    const loseExt = context.getExtension('WEBGL_lose_context');
    const marks = window.__spikeMarks ?? {};
    const api: SpikeApi = {
      tier,
      controls: controlsName,
      boot: {
        importStart: marks.importStart ?? 0,
        importEnd: marks.importEnd ?? 0,
        labRender: marks.labRender ?? 0,
        glStart: marks.glStart ?? 0,
        glEnd: marks.glEnd ?? 0,
        canvasCreated: canvasCreated.current,
        get firstFrame() {
          return firstFrame.current;
        },
      },
      run: () => {
        sim.current.running = true;
        setFrameloop('always');
      },
      stop: () => {
        sim.current.running = false;
        setFrameloop('demand');
        invalidate();
      },
      resetStats: () => {
        stats.current = { frames: 0, last: 0, dt: [], renderMs: [] };
      },
      stats: () => {
        const debug = context.getExtension('WEBGL_debug_renderer_info');
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          frames: stats.current.frames,
          dt: stats.current.dt,
          renderMs: stats.current.renderMs,
          render: { ...gl.info.render },
          memory: { ...gl.info.memory },
          programs: gl.info.programs?.length ?? null,
          heapMB: memory ? memory.usedJSHeapSize / 1e6 : null,
          drawingBuffer: [context.drawingBufferWidth, context.drawingBufferHeight],
          pixelRatio: gl.getPixelRatio(),
          devicePixelRatio: window.devicePixelRatio,
          shadowMapEnabled: gl.shadowMap.enabled,
          renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
          vendor: debug ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL) : context.getParameter(context.VENDOR),
          glVersion: context.getParameter(context.VERSION),
          virtualSeconds: sim.current.time,
        };
      },
      cameraPosition: () => camera.position.toArray(),
      loseContext: () => {
        loseExt?.loseContext();
        return Boolean(loseExt);
      },
      restoreContext: () => {
        loseExt?.restoreContext();
        return Boolean(loseExt);
      },
      sample: () => {
        // Render now and read a few pixels in the same task (the drawing buffer is not preserved).
        gl.render(scene, camera);
        const w = context.drawingBufferWidth;
        const h = context.drawingBufferHeight;
        const px = new Uint8Array(4);
        const pixels = (
          [
            [0.5, 0.5],
            [0.3, 0.35],
            [0.7, 0.6],
            [0.5, 0.2],
            [0.05, 0.95],
          ] as const
        ).map(([u, v]) => {
          px.fill(0);
          context.readPixels(Math.floor(u * w), Math.floor(v * h), 1, 1, context.RGBA, context.UNSIGNED_BYTE, px);
          return Array.from(px);
        });
        // FNV-1a over the whole drawing buffer: exact equality of two frames.
        const all = new Uint8Array(w * h * 4);
        context.readPixels(0, 0, w, h, context.RGBA, context.UNSIGNED_BYTE, all);
        let hash = 2166136261;
        for (let i = 0; i < all.length; i += 1) hash = Math.imul(hash ^ all[i]!, 16777619) >>> 0;
        return { lost: context.isContextLost(), pixels, hash: hash.toString(16) };
      },
      invalidate: () => invalidate(),
      contextEvents,
    };
    window.__spike = api;
    if (autoRun) api.run();
    return () => {
      canvas.removeEventListener('webglcontextlost', record);
      canvas.removeEventListener('webglcontextrestored', record);
      gl.render = original;
      delete window.__spike;
    };
  }, [gl, scene, camera, setFrameloop, invalidate, sim, tier, controlsName, autoRun]);

  return null;
}

export default function Lab({ tier, antialias, autoRun, controlsName, extra }: LabProps) {
  const high = tier === 'high';
  window.__spikeMarks!.labRender ??= performance.now();
  const sim = useRef<Sim>({ running: false, time: 0 });
  const poses = useMemo(() => generatePoses(), []);
  return (
    <Canvas
      frameloop="demand"
      // "percentage" is three's PCFShadowMap. R3F's `true`/"soft" asks for PCFSoftShadowMap, which three 0.186 has removed
      // (it warns and falls back), so name the real type.
      shadows={high ? 'percentage' : false}
      dpr={high ? [1, 1.5] : 1}
      gl={(defaults) => {
        const marks = window.__spikeMarks!;
        marks.glStart = performance.now();
        const renderer = new WebGLRenderer({ ...defaults, antialias, powerPreference: 'high-performance' });
        marks.glEnd = performance.now();
        return renderer;
      }}
      camera={{ position: [1.75, 1.5, 2.0], fov: 42, near: 0.05, far: 20 }}
    >
      <color attach="background" args={['#1b2330']} />
      <hemisphereLight args={['#ffffff', '#7d8794', 1.1]} />
      <Sun high={high} />
      <Arena shadows={high} />
      <Robot shadows={high} sim={sim} poses={poses} />
      {Array.from({ length: extra }, (_, i) => (
        <Robot key={i} shadows={high} sim={sim} poses={poses} phase={((i + 1) * TICKS) / (extra + 1)} />
      ))}
      <ReplayClock sim={sim} />
      <Controls />
      <Probe sim={sim} tier={tier} controlsName={controlsName} autoRun={autoRun} />
    </Canvas>
  );
}
