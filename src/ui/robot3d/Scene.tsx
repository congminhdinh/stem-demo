import { addTail, Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NeutralToneMapping, NoToneMapping, type DirectionalLight, type Object3D } from 'three';
import { useStore } from 'zustand';
import type { Kit } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { PaintZone } from '../../core/world/arena/arena-schema';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { ArenaView } from './ArenaView';
import { loadRobotAssets } from './assets/robot-assets';
import { createTextureSet } from './assets/textures';
import type { ArenaSpan, CameraMode } from './camera';
import type { CameraCommands } from './camera-commands';
import { CameraRig } from './CameraRig';
import { freeViewForward, freeViewSceneOf, sightWalls, type FreeViewScene } from './camera-studio';
import { FloorPicker } from './FloorPicker';
import type { CardEdge, HudCorner, ToolsCorner } from './hud-corner';
import { robot3dColors as colors } from './colors';
import { tierLook } from './lighting/look';
import { StudioLighting } from './lighting/StudioLighting';
import { GltfArena } from './parts/GltfArena';
import { flagOf, GltfRobot } from './parts/GltfRobot';
import { SensorOverlay } from './parts/SensorOverlay';
import type { RobotTagBox } from './parts/ZoneTags';
import { tierSettings, type QualityTier } from './quality';
import type { RobotModel } from './robot-model';
import { isRunOver, type RobotRunStore } from './robot-run-store';
import { createFrameWatch, createLowTierWatch, drawDue, type LowTierStep } from './frame-watch';
import type { RobotToolsStore } from './robot-tools-store';
import { useLocale, useText } from '../i18n/text';
import { RobotView } from './RobotView';
import { idleSnapshot, sameView } from './scene-math';
import { createShadowWatch, holdShadows, type ShadowHold } from './shadow-watch';
import { sightProps } from './sight-props';

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
  /** N18 R4.7: the view tools' corner (NDC, R4.8), which the free view keeps the robot and its start clear of. */
  toolsCorner?: ToolsCorner | null;
  /** N18 R4.7 fix round 1: a run is drawn too slowly for this tier (frame-watch.ts); told once. */
  onSlowFrames?(): void;
  /** N18 P2: the low tier's frame watch (frame-watch.ts createLowTierWatch) says its next step: draw at 30 fps, then offer the 2D map. */
  onLowStep?(step: LowTierStep): void;
  /** N18 P2: a run is drawn at most 30 frames a second (`drawDue`); the simulation runs on its own clock, the same. */
  drawCap?: boolean;
  /** N18 R4.8: the view tools (the ruler, the move tool), which take the pointer on the mat (FloorPicker). */
  tools?: RobotToolsStore;
  /** N18 R8: the keyboard's camera steps (camera-keys.ts); the rig takes the zoom and the orbit. */
  commands?: CameraCommands;
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
function CompiledDraw({ onDrawn, cap = false, onDraw }: { onDrawn?: (() => void) | undefined; cap?: boolean; onDraw?: ((sinceDrawMs: number, backToBack: boolean) => void) | undefined }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const ready = useRef(false);
  const told = useRef(false);
  // N18 P2: when the last frame was drawn, and whether the demand loop stopped since (R3F's tail): the low tier's watch judges the
  // draws, and a capped view skips a display frame that comes too soon after the last draw (it asks for the next one instead).
  const lastDraw = useRef<number | null>(null);
  const stoppedSinceDraw = useRef(true);
  useEffect(
    () =>
      addTail(() => {
        stoppedSinceDraw.current = true;
      }),
    [],
  );
  // An effect, after the scene's own (the studio's environment map is set by then: every shader is compiled once, with it).
  useEffect(() => {
    let live = true;
    // What is hidden until a run lights it but must not compile a program then (a line lamp's glow: its sprite program is the zones'
    // tags', and they come after the first frame): shown for the compile, which gathers the scene's materials at once, then hidden again.
    const hidden: Object3D[] = [];
    scene.traverse((node) => {
      if (!node.visible && node.userData.compileWithScene) {
        node.visible = true;
        hidden.push(node);
      }
    });
    const compiled = gl.compileAsync(scene, camera);
    for (const node of hidden) node.visible = false;
    void compiled
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
    const now = performance.now();
    const since = lastDraw.current === null ? Infinity : now - lastDraw.current;
    const backToBack = !stoppedSinceDraw.current;
    if (cap && backToBack && !drawDue(since)) {
      invalidate();
      return;
    }
    gl.render(scene, camera);
    lastDraw.current = now;
    stoppedSinceDraw.current = false;
    if (since !== Infinity) onDraw?.(since, backToBack);
    if (!told.current && onDrawn) {
      told.current = true;
      queueMicrotask(onDrawn);
    }
  }, 1);
  return null;
}

/**
 * Tells the owner, once, when a run's frames are too slow (frame-watch.ts): frames count while a run moves, and only those drawn right
 * after another one. R3F calls its tail effects when its demand loop stops (nothing asked for the next frame): the frame after that is
 * not back to back.
 */
function SlowFrames({ store, onSlow }: { store: RobotRunStore; onSlow(): void }) {
  const watch = useMemo(createFrameWatch, []);
  const told = useRef(false);
  const stopped = useRef(true);
  useEffect(
    () =>
      addTail(() => {
        stopped.current = true;
      }),
    [],
  );
  useFrame((_, delta) => {
    const backToBack = !stopped.current;
    stopped.current = false;
    if (told.current) return;
    const state = store.getState();
    const running = state.active && !state.paused && !state.starting && !isRunOver(state.snapshot);
    if (watch.frame(delta * 1000, running, backToBack)) {
      told.current = true;
      onSlow();
    }
  });
  return null;
}

/**
 * N18 P2: the key light's shadow map is drawn again only on a frame where what casts a shadow has moved, or after the scene changed
 * (shadow-watch.ts): not for a frame where only the camera moved or an LED blinked. It renders with the scene's content, so every commit
 * of that content (its parts, the plan view, the overlays) counts as a change; so does a restored WebGL context.
 */
function ShadowsOnChange({ view }: { view: () => RobotSnapshot }) {
  const gl = useThree((state) => state.gl);
  const watch = useMemo(createShadowWatch, []);
  useLayoutEffect(() => watch.changed());
  const hold = useRef<ShadowHold | null>(null);
  useEffect(() => {
    const held = holdShadows(gl, watch);
    hold.current = held;
    return () => {
      held.release();
      hold.current = null;
    };
  }, [gl, watch]);
  useFrame(() => hold.current?.frame(view()));
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
  /** The zones' tags: shown from one frame after the first, laid out clear of what floats over the view. */
  tagsReady: boolean;
  overlays: { hud: HudCorner | null; card: CardEdge | null; tools: ToolsCorner | null };
};

/** The parts each of the modelled files must have for the view to use them; without one, the procedural view is drawn. */
const NEEDED_PARTS = ['part_chassis', 'part_board', 'part_tt_motor', 'part_wheel', 'part_caster', 'part_ultrasonic', 'part_line_bar', 'part_line_leds', 'part_servo', 'part_led', 'part_buzzer', 'part_button'];
const NEEDED_PROPS = ['prop_wall', 'prop_block', 'prop_cardboard', 'prop_marker', 'prop_barrier', 'prop_tin', 'prop_post', 'prop_table_top', 'prop_table_leg', 'prop_fence_post', 'prop_fence_rail', 'prop_studio'];

/**
 * What the canvas shows (N18 R4.7): the modelled robot and arena under the studio light once their files are in (the canvas waits for
 * them under "Đang tải 3D…", Suspense), or R4.2's procedural shapes when the files do not load.
 */
function SceneContent({ scenario, kit, model, view, span, tier, zoneLabel, viewForward, cameraMode, tagsReady, overlays }: ContentProps) {
  const look = tierLook[tier];
  const assets = use(loadRobotAssets(look.detail));
  const gl = useThree((state) => state.gl);
  const settings = tierSettings[tier];
  const shadows = settings.shadows !== false;
  // N18 P2: the fibre map only where the mat is drawn with it (not on the low tier).
  const textures = useMemo(() => createTextureSet(Math.min(8, gl.capabilities.getMaxAnisotropy()), { matNormal: look.matNormal }), [gl, look]);
  useEffect(() => () => textures.dispose(), [textures]);
  useEffect(() => () => assets?.releaseGpu(), [assets]);
  // Before the first frame, on the high tier: the files' textures filtered as sharply as the mat's. Not on the low tier, a software
  // renderer's: there anisotropic filtering made the first frame 1.2 s slower at 4× CPU (measured, spikes/r47-visual/results/ab-*.json).
  useLayoutEffect(() => {
    if (look.detail === 'high') assets?.sharpen(Math.min(8, gl.capabilities.getMaxAnisotropy()));
  }, [assets, gl, look]);
  const labels = useMemo(() => ({ zoneLabel }), [zoneLabel]);
  // The robot's box the zones' tags keep clear of: with the wheels, and up to a raised flag's top (about 21 cm, 10 cm round) if it has one.
  const robotBox = useMemo<RobotTagBox>(() => {
    const wheel = model.wheels[0]?.widthM ?? 0;
    const [halfLength, halfWidth] = [model.body.lengthM / 2 + 0.01, model.body.widthM / 2 + wheel];
    return flagOf(scenario) ? { halfLength: Math.max(halfLength, 0.1), halfWidth: Math.max(halfWidth, 0.1), height: 0.21 } : { halfLength, halfWidth, height: model.body.bottomM + model.body.heightM + 0.035 };
  }, [model, scenario]);
  const tags = useMemo(() => ({ ready: tagsReady, mode: cameraMode, overlays, robot: robotBox }), [tagsReady, cameraMode, overlays, robotBox]);
  const usable = assets !== null && NEEDED_PARTS.every((name) => assets.part(name)) && NEEDED_PROPS.every((name) => assets.prop(name));
  // What the canvas draws, for the E2E and a curious developer: the modelled scene or the simple shapes.
  useEffect(() => {
    gl.domElement.dataset.models = usable ? 'modelled' : 'simple';
    // R4.2's simple shapes are drawn as they were, with no tone mapping (R3F's `flat`); the studio's with Khronos PBR Neutral.
    gl.toneMapping = usable ? NeutralToneMapping : NoToneMapping;
    gl.toneMappingExposure = usable ? TONE_EXPOSURE : 1;
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
      <GltfArena assets={assets} planView={cameraMode === 'top'} scenario={scenario} view={view} look={look} shadows={shadows} textures={textures} labels={labels} viewForward={viewForward} tags={tags} />
      <GltfRobot assets={assets} kit={kit} model={model} scenario={scenario} view={view} detail={look.detail} shadows={shadows} blob={textures.blob} />
      {shadows && <ShadowsOnChange view={view} />}
    </>
  );
}

export default function Scene({ scenario, kit, model, store, tier, cameraMode, reducedMotion, zoneLabel, onContextLost, onContextRestored, onFirstFrame, resetKey, hud = null, card = null, toolsCorner = null, tools, onSlowFrames, onLowStep, drawCap = false, commands }: SceneProps) {
  const settings = tierSettings[tier];
  const idle = useMemo(() => idleSnapshot(scenario, kit), [scenario, kit]);
  const view = useCallback(() => store.getState().latestWorld() ?? idle, [store, idle]);
  const [widthCm, depthCm] = scenario.arena.ground.sizeCm;
  const span = useMemo<ArenaSpan>(() => ({ widthM: widthCm / 100, depthM: depthCm / 100 }), [widthCm, depthCm]);
  const freeView = useMemo<FreeViewScene>(() => freeViewSceneOf(scenario), [scenario]);
  const viewForward = useMemo(() => freeViewForward(freeView), [freeView]);
  const walls = useMemo(() => sightWalls(scenario.arena.walls), [scenario]);
  const props = useMemo(() => sightProps(scenario), [scenario]);
  // The zones' tags come a frame after the first is drawn: their canvases and shader cost that frame nothing.
  const [tagsReady, setTagsReady] = useState(false);
  const onDrawn = useCallback(() => {
    onFirstFrame?.();
    requestAnimationFrame(() => setTagsReady(true));
  }, [onFirstFrame]);
  const overlays = useMemo(() => ({ hud, card, tools: toolsCorner }), [hud, card, toolsCorner]);
  // N18 P2: the low tier's frame watch, one a canvas (it goes one way: a step it said is not said again). The draws of a run count.
  // A canvas made capped (the lab capped an earlier one) starts at the cap: its next step is the offer.
  const startCapped = useRef(drawCap);
  const lowWatch = useMemo(() => createLowTierWatch(startCapped.current ? 'capped' : 'full'), []);
  const latestLowStep = useRef(onLowStep);
  useEffect(() => {
    latestLowStep.current = onLowStep;
  });
  const lowDraw = useCallback(
    (sinceDrawMs: number, backToBack: boolean) => {
      const state = store.getState();
      const running = state.active && !state.paused && !state.starting && !isRunOver(state.snapshot);
      const step = lowWatch.frame(sinceDrawMs, running, backToBack);
      if (step) latestLowStep.current?.(step);
    },
    [store, lowWatch],
  );
  // N18 R4.7: a replay of a check's round ("Xem lại") is under way: the camera goes back to frame its start.
  const replaying = useStore(store, (state) => state.round !== null && state.active && !state.locked);
  // N18 R4.3: the sensor overlays write a distance with the learner's decimal sign.
  const t = useText();
  const decimal = useLocale() === 'vi' ? ',' : '.';
  const unit = t('robot.ruler.cm', { value: '' }).trim();
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
        <SceneContent scenario={scenario} kit={kit} model={model} view={view} span={span} tier={tier} zoneLabel={zoneLabel} viewForward={viewForward} cameraMode={cameraMode} tagsReady={tagsReady} overlays={overlays} />
        <CompiledDraw onDrawn={onDrawn} cap={drawCap} onDraw={onLowStep ? lowDraw : undefined} />
      </Suspense>
      <CameraRig mode={cameraMode} span={span} free={freeView} view={view} reducedMotion={reducedMotion} resetKey={resetKey} hud={hud} card={card} tools={toolsCorner} walls={walls} props={props} replaying={replaying} {...(commands ? { commands } : {})} />
      <RedrawOnChange store={store} />
      <ContextWatch onLost={onContextLost} onRestored={onContextRestored} />
      {onSlowFrames && <SlowFrames store={store} onSlow={onSlowFrames} />}
      {tools && <FloorPicker tools={tools} store={store} kit={kit} scenario={scenario} />}
      <SensorOverlay scenario={scenario} kit={kit} model={model} view={view} store={store} tools={tools} reducedMotion={reducedMotion} decimal={decimal} unit={unit} noEchoText={t('robot.pins.ultra.noEcho')} detail={tierLook[tier].detail} overlays={overlays} />
    </Canvas>
  );
}
