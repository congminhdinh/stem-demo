import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { DirectionalLight } from 'three';
import type { Kit } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { PaintZone } from '../../core/world/arena/arena-schema';
import { ArenaView } from './ArenaView';
import type { ArenaSpan, CameraMode } from './camera';
import { CameraRig } from './CameraRig';
import { robot3dColors as colors } from './colors';
import { tierSettings, type QualityTier } from './quality';
import type { RobotModel } from './robot-model';
import type { RobotRunStore } from './robot-run-store';
import { RobotView } from './RobotView';
import { idleSnapshot, sameView } from './scene-math';

// The robot lab's 3D view (N18 R4.2, ADR 0002): one R3F canvas with the arena, the robot and the camera. It draws on demand
// (`frameloop="demand"`): a frame is drawn when the picture changes (a run's new snapshot that moves something, a Stop, a Reset), when
// the camera moves, and never while nothing does. The run's poses are read in the frame callbacks from the store (`latestWorld()`), so a
// run makes no React render here. The quality tier sets shadows, the pixel ratio and antialiasing; antialiasing is fixed when the WebGL
// context is made, so the owner gives a new tier a new canvas (key). When the browser takes the WebGL context away, the owner is told,
// and when it gives it back the canvas is drawn again at once (a demand loop would otherwise stay blank, ADR 0002 §4.7).

export type SceneProps = {
  scenario: Scenario;
  kit: Kit;
  model: RobotModel;
  store: RobotRunStore;
  tier: QualityTier;
  cameraMode: CameraMode;
  reducedMotion: boolean;
  zoneLabel: (zone: PaintZone) => string | null;
  onContextLost(): void;
  onContextRestored(): void;
  /** The canvas has drawn its first frame (until then the page shows what is behind it). */
  onFirstFrame?(): void;
};

/** The camera's vertical field of view, degrees. */
const FOV_DEG = 40;

/** The sun: high, from the back left of the learner, its shadows framed on the arena. */
function Sun({ span, shadows, mapSize }: { span: ArenaSpan; shadows: boolean; mapSize: number }) {
  const light = useRef<DirectionalLight>(null);
  const reach = Math.max(span.widthM, span.depthM);
  const centre: [number, number, number] = [span.widthM / 2, 0, -span.depthM / 2];
  useLayoutEffect(() => {
    const sun = light.current;
    if (!sun) return;
    sun.target.position.set(...centre);
    sun.target.updateMatrixWorld();
    const half = reach / 2 + 0.15;
    const camera = sun.shadow.camera;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0.05;
    camera.far = reach * 4;
    camera.updateProjectionMatrix();
  });
  return (
    <directionalLight
      ref={light}
      position={[centre[0] - reach * 0.45, reach * 1.3, centre[2] - reach * 0.35]}
      color={colors.sun}
      intensity={2.1}
      castShadow={shadows}
      shadow-mapSize={[mapSize || 512, mapSize || 512]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.004}
    />
  );
}

/**
 * Asks for a frame when the picture changes: a published snapshot that moves something, a Stop that holds a run, a Reset that clears it.
 * A run publishes from its own animation-frame callback, which comes before R3F's in a frame, while R3F's demand loop cancels itself
 * after the frame it draws: a plain invalidate() would then wait for the frame after next, and a run would be drawn at half the display's
 * rate (measured: 60 draws in 120 frames at 120 Hz, 30 fps on a 60 Hz SwiftShader). So a change keeps the loop asked for one frame
 * more (`invalidate(2)` while fewer than 2 frames are owed): every frame of a run is drawn in the frame its snapshot came in, and the loop
 * stops at most two frames after the last change.
 */
function RedrawOnChange({ store }: { store: RobotRunStore }) {
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  useEffect(() => {
    let shown = store.getState().latestWorld();
    const check = () => {
      const next = store.getState().latestWorld();
      if (!sameView(shown, next)) {
        shown = next;
        if (get().internal.frames < 2) invalidate(2);
      }
    };
    const stopPublishes = store.getState().onPublish(check);
    const stopState = store.subscribe(check);
    return () => {
      stopPublishes();
      stopState();
    };
  }, [store, invalidate, get]);
  return null;
}

/**
 * Tells the owner once the canvas has drawn its first frame: R3F draws right after its frame callbacks, so the owner is told in a
 * microtask after the first one, when the frame is on the canvas. A software renderer takes about 2 s to get there (shader compiles).
 */
function FirstFrame({ onDrawn }: { onDrawn(): void }) {
  const told = useRef(false);
  useFrame(() => {
    if (!told.current) {
      told.current = true;
      queueMicrotask(onDrawn);
    }
  });
  return null;
}

/** Tells the owner when the browser takes the WebGL context away and gives it back, and draws again then (ADR 0002 §4.7). */
function ContextWatch({ onLost, onRestored }: { onLost(): void; onRestored(): void }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const canvas = gl.domElement;
    // three has already called preventDefault(), so the browser may give the context back.
    const lost = () => onLost();
    const restored = () => {
      onRestored();
      invalidate();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, invalidate, onLost, onRestored]);
  return null;
}

export default function Scene({ scenario, kit, model, store, tier, cameraMode, reducedMotion, zoneLabel, onContextLost, onContextRestored, onFirstFrame }: SceneProps) {
  const settings = tierSettings[tier];
  const shadows = settings.shadows !== false;
  const idle = useMemo(() => idleSnapshot(scenario, kit), [scenario, kit]);
  const view = useCallback(() => store.getState().latestWorld() ?? idle, [store, idle]);
  const [widthCm, depthCm] = scenario.arena.ground.sizeCm;
  const span = useMemo<ArenaSpan>(() => ({ widthM: widthCm / 100, depthM: depthCm / 100 }), [widthCm, depthCm]);
  return (
    <Canvas
      className="robot-canvas"
      data-testid="robot-canvas"
      data-tier={tier}
      frameloop="demand"
      flat
      shadows={settings.shadows}
      dpr={settings.dpr}
      gl={{ antialias: settings.antialias, powerPreference: 'high-performance' }}
      camera={{ fov: FOV_DEG, near: 0.01, far: 60, position: [span.widthM / 2, 1, 1] }}
    >
      <color attach="background" args={[colors.background]} />
      <hemisphereLight args={[colors.sky, colors.ground, 1.5]} />
      <Sun span={span} shadows={shadows} mapSize={settings.shadowMapSize} />
      <ArenaView arena={scenario.arena} view={view} shadows={shadows} zoneLabel={zoneLabel} />
      <RobotView model={model} view={view} shadows={shadows} />
      <CameraRig mode={cameraMode} span={span} view={view} reducedMotion={reducedMotion} />
      <RedrawOnChange store={store} />
      <ContextWatch onLost={onContextLost} onRestored={onContextRestored} />
      {onFirstFrame && <FirstFrame onDrawn={onFirstFrame} />}
    </Canvas>
  );
}
