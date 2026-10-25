import { Canvas, useThree } from '@react-three/fiber';
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

/** Asks for a frame when the picture changes: a published snapshot that moves something, a Stop that holds a run, a Reset that clears it. */
function RedrawOnChange({ store }: { store: RobotRunStore }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let shown = store.getState().latestWorld();
    const check = () => {
      const next = store.getState().latestWorld();
      if (!sameView(shown, next)) {
        shown = next;
        invalidate();
      }
    };
    const stopPublishes = store.getState().onPublish(check);
    const stopState = store.subscribe(check);
    return () => {
      stopPublishes();
      stopState();
    };
  }, [store, invalidate]);
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

export default function Scene({ scenario, kit, model, store, tier, cameraMode, reducedMotion, zoneLabel, onContextLost, onContextRestored }: SceneProps) {
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
    </Canvas>
  );
}
