import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { NeutralToneMapping, type DirectionalLight } from 'three';
import type { Kit } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { PaintZone } from '../../core/world/arena/arena-schema';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { ArenaView } from './ArenaView';
import { loadRobotAssets } from './assets/robot-assets';
import { createTextureSet } from './assets/textures';
import type { ArenaSpan, CameraMode } from './camera';
import { CameraRig } from './CameraRig';
import { freeViewForward, sightWalls, type FreeViewScene } from './camera-studio';
import type { CardEdge, HudCorner } from './hud-corner';
import { robot3dColors as colors } from './colors';
import { tierLook } from './lighting/look';
import { StudioLighting } from './lighting/StudioLighting';
import { GltfArena } from './parts/GltfArena';
import { GltfRobot } from './parts/GltfRobot';
import { tierSettings, type QualityTier } from './quality';
import type { RobotModel } from './robot-model';
import type { RobotRunStore } from './robot-run-store';
import type { RobotToolsStore } from './robot-tools-store';
import { RobotView } from './RobotView';
import { idleSnapshot, sameView } from './scene-math';

// The robot lab's 3D view (N18 R4.2, ADR 0002): one R3F canvas with the arena, the robot and the camera. It draws on demand
// (`frameloop="demand"`): a frame is drawn when the picture changes (a run's new snapshot that moves something, a Stop, a Reset), when
// the camera moves, and never while nothing does. The run's poses are read in the frame callbacks from the store (`latestWorld()`), so a
// run makes no React render here. The quality tier sets shadows, the pixel ratio and antialiasing; antialiasing is fixed when the WebGL
// context is made, so the owner gives a new tier a new canvas (key). When the browser takes the WebGL context away, the owner is told,
// and when it gives it back the canvas is drawn again at once (a demand loop would otherwise stay blank, ADR 0002 §4.7).

// N18 R4.7: what it draws are the modelled parts and props of public/robot3d (Blender, assets-src/robot3d) under a studio light, loaded
// under Suspense (the canvas waits under "Đang tải 3D…" until they are drawn), and R4.2's procedural shapes when the files do not load;
// the camera's free view looks over the robot to the lesson's zones, framed clear of the HUD and of an open results card.

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
  /** N18 R4.7: a new value puts the current camera view back where it starts ("đặt lại góc nhìn"). */
  resetKey?: number;
  /** N18 R4.7: where the HUD covers the view (NDC), which the free view frames the lesson clear of. */
  hud?: HudCorner | null;
  /** N18 R4.7: the check's open results card (NDC), which the camera keeps the robot's end spot clear of. */
  card?: CardEdge | null;
};

/** The camera's vertical field of view, degrees. */
const FOV_DEG = 40;
/** N18 R4.7: the exposure of the tone mapping (Khronos PBR Neutral: base colours stay as authored, highlights roll off), set for the studio light. */
const TONE_EXPOSURE = 1.0;

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
 * Draws the canvas (N18 R4.7: in place of R3F's own draw, a frame callback of priority 1), but only once every shader the scene needs
 * is compiled: `compileAsync` asks for all of them at once (KHR_parallel_shader_compile, where the browser has it) instead of one after
 * the other in the first frame, which a software renderer pays for with tens of milliseconds each. Then it tells the owner once the
 * canvas has drawn its first frame, in a microtask after it, when the frame is on the canvas (until then "Đang tải 3D…" stands over it).
 */
function CompiledDraw({ onDrawn }: { onDrawn?: (() => void) | undefined }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const ready = useRef(false);
  const told = useRef(false);
  useLayoutEffect(() => {
    let live = true;
    void gl
      .compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (!live) return;
        ready.current = true;
        invalidate();
      });
    return () => {
      live = false;
    };
  }, [gl, scene, camera, invalidate]);
  useFrame(() => {
    if (!ready.current) return;
    gl.render(scene, camera);
    if (!told.current && onDrawn) {
      told.current = true;
      queueMicrotask(onDrawn);
    }
  }, 1);
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

type ContentProps = {
  scenario: Scenario;
  kit: Kit;
  model: RobotModel;
  view: () => RobotSnapshot;
  span: ArenaSpan;
  tier: QualityTier;
  zoneLabel: (zone: PaintZone) => string | null;
  viewForward: readonly [number, number];
  cameraMode: CameraMode;
};

/** The parts each of the modelled files must have for the view to use them; without one, the procedural view is drawn. */
const NEEDED_PARTS = ['part_chassis', 'part_board', 'part_tt_motor', 'part_wheel', 'part_caster', 'part_ultrasonic', 'part_line_bar', 'part_servo', 'part_led', 'part_buzzer', 'part_button'];
const NEEDED_PROPS = ['prop_wall', 'prop_block', 'prop_cardboard', 'prop_cone', 'prop_barrier', 'prop_tin', 'prop_post', 'prop_table_top', 'prop_table_leg', 'prop_fence_post', 'prop_fence_rail', 'prop_studio'];

/**
 * What the canvas shows (N18 R4.7): the modelled robot and arena under the studio light once their files are in (the canvas waits for
 * them under "Đang tải 3D…", Suspense), or R4.2's procedural shapes when the files do not load.
 */
function SceneContent({ scenario, kit, model, view, span, tier, zoneLabel, viewForward, cameraMode }: ContentProps) {
  const look = tierLook[tier];
  const assets = use(loadRobotAssets(look.detail));
  const gl = useThree((state) => state.gl);
  const settings = tierSettings[tier];
  const shadows = settings.shadows !== false;
  const textures = useMemo(() => createTextureSet(Math.min(8, gl.capabilities.getMaxAnisotropy())), [gl]);
  useEffect(() => () => textures.dispose(), [textures]);
  useEffect(() => () => assets?.releaseGpu(), [assets]);
  const labels = useMemo(() => ({ zoneLabel }), [zoneLabel]);
  const usable = assets !== null && NEEDED_PARTS.every((name) => assets.part(name)) && NEEDED_PROPS.every((name) => assets.prop(name));
  // What the canvas draws, for the E2E and a curious developer: the modelled scene or the simple shapes.
  useEffect(() => {
    gl.domElement.dataset.models = usable ? 'modelled' : 'simple';
  }, [gl, usable]);
  if (!usable) {
    return (
      <>
        <color attach="background" args={[colors.background]} />
        <hemisphereLight args={[colors.sky, colors.ground, 1.5]} />
        <Sun span={span} shadows={shadows} mapSize={settings.shadowMapSize} />
        <ArenaView arena={scenario.arena} view={view} shadows={shadows} zoneLabel={zoneLabel} />
        <RobotView model={model} view={view} shadows={shadows} />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={[colors.studioFog]} />
      <StudioLighting span={span} look={look} shadows={shadows} mapSize={settings.shadowMapSize} viewForward={viewForward} />
      <GltfArena assets={assets} planView={cameraMode === 'top'} scenario={scenario} view={view} look={look} shadows={shadows} textures={textures} labels={labels} viewForward={viewForward} />
      <GltfRobot assets={assets} kit={kit} model={model} scenario={scenario} view={view} detail={look.detail} shadows={shadows} blob={textures.blob} />
    </>
  );
}

export default function Scene({ scenario, kit, model, store, tier, cameraMode, reducedMotion, zoneLabel, onContextLost, onContextRestored, onFirstFrame, resetKey, hud = null, card = null }: SceneProps) {
  const settings = tierSettings[tier];
  const idle = useMemo(() => idleSnapshot(scenario, kit), [scenario, kit]);
  const view = useCallback(() => store.getState().latestWorld() ?? idle, [store, idle]);
  const [widthCm, depthCm] = scenario.arena.ground.sizeCm;
  const span = useMemo<ArenaSpan>(() => ({ widthM: widthCm / 100, depthM: depthCm / 100 }), [widthCm, depthCm]);
  const freeView = useMemo<FreeViewScene>(
    () => ({ start: scenario.start, goals: scenario.arena.paint.zones.filter((zone) => zone.kind === 'target' || zone.kind === 'checkpoint').map((zone) => zone.polygonCm) }),
    [scenario],
  );
  const viewForward = useMemo(() => freeViewForward(freeView), [freeView]);
  const walls = useMemo(() => sightWalls(scenario.arena.walls), [scenario]);
  return (
    <Canvas
      className="robot-canvas"
      data-testid="robot-canvas"
      data-tier={tier}
      frameloop="demand"
      shadows={settings.shadows}
      dpr={settings.dpr}
      gl={{ antialias: settings.antialias, powerPreference: 'high-performance', toneMapping: NeutralToneMapping, toneMappingExposure: TONE_EXPOSURE }}
      camera={{ fov: FOV_DEG, near: 0.01, far: 60, position: [span.widthM / 2, 1, 1] }}
    >
      <Suspense fallback={null}>
        <SceneContent scenario={scenario} kit={kit} model={model} view={view} span={span} tier={tier} zoneLabel={zoneLabel} viewForward={viewForward} cameraMode={cameraMode} />
        <CompiledDraw onDrawn={onFirstFrame} />
      </Suspense>
      <CameraRig mode={cameraMode} span={span} free={freeView} view={view} reducedMotion={reducedMotion} resetKey={resetKey} hud={hud} card={card} walls={walls} />
      <RedrawOnChange store={store} />
      <ContextWatch onLost={onContextLost} onRestored={onContextRestored} />
    </Canvas>
  );
}
