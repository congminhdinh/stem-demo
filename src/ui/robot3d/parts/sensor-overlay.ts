import { Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { classifyColor, COLOR_NAMES, type ColorName } from '../../../core/hardware/drivers';
import type { ColorSensorSpec, IrObstacleSpec, Kit, LineSensorSpec, UltrasonicSpec } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { CM_PER_M } from '../../../core/world/units';
import { gripperStateOf } from '../gripper-pose';
import type { Detail } from '../lighting/look';
import type { RobotModel } from '../robot-model';
import { COLOR_RAY_QUIET_ALPHA, readingTints, sensorColors as colors } from '../sensor-colors';
import { GLYPH, goalZoneIds, highlightColor, labelGlyphs, LABEL_GLYPHS_MAX, nextGoalZoneId, sameSensorView, spotDrawRadiusCm } from '../sensor-overlay-math';
import { NO_ECHO_RAY_CM } from '../top-view-math';
import { createDistanceLabel, type DistanceLabel, type DistanceLabelOptions } from './distance-label';
import { beamAxisEcho, beamWrite, buildBeam, buildGripperRays, buildSpots, gripperRaysColor, gripperRaysIr, gripperRaysWrite, rgba, spotColor, spotsHide, spotsWrite, type Beam, type GripperRays, type Rgba, type Spots } from './overlay-geometry';
import { createWordsLabel, type WordsLabel, type WordsLabelOptions } from './words-label';
import { zoneHighlightGeometry } from './zone-highlight';

// The sensor overlays of the 3D view (N18 R4.3): what the robot "sees", drawn over the arena for a learner to read, from the snapshot's
// readouts and score and never worked out again.
//
//   - Ultrasonic: the axis ray from the module's mount to the distance it heard (NO_ECHO_RAY_CM, faded, with no echo), the dot at the end
//     of the axis and a tag with the distance in cm, or "không thấy vật" with no echo. The snapshot carries the distance the sensor heard
//     (the shortest of its five rays') and what it came from, not the rays one by one, so the dot is the heard distance on the axis, not
//     the point the echo came from (an edge ray may have heard it), and the cone is an outline of the same slant length: where the sensor
//     listens, not five measured hits. The cone's surface is left out on the light tier.
//   - Line sensors: a soft halo on the mat at each eye's floor spot, a red disc in it where the eye reads dark and a blue ring where it
//     reads bright, with a thin tick down from the eye. They are tested against the robot's depth like everything else: the spots are under
//     the chassis, and show where it does not cover them.
//   - The goal's zone: a soft fill and outline, in the zone's own hue, on the zone the next unmet goal needs, pulsing while a run goes on.
//   - N19 E5, on a gripper car: the IR sensor's short beam between the jaws (its 2 cm range, faint, strong with a dot at its end when it
//     sees something), the colour sensor's ray to what it meets and a spot there tinted with the colour its counts read (`shownColor`; a
//     ring alone for one it cannot tell), both on the carriage where the boom holds it (gripper-pose.ts), and a tag over the jaws that says
//     them ("IR: có vật", "Màu: đỏ"), painted only when those words change. One more mesh and one more tag: two draw calls.
//
// It is plain three with no React, and its whole cost is four draw calls (a beam's mesh, the spots' mesh, the zone's mesh, the tag): each
// is a vertex-coloured mesh (overlay-geometry.ts) built once, whose positions `update` writes in place. `update` makes no object. All of
// it shares one shader program (MeshBasicMaterial with vertex colours and alpha) and, with the tag's sprite, adds only that to the scene's.
// Everything is flagged `compileWithScene` (Scene.tsx CompiledDraw): hidden until a reading comes, but compiled with the scene.

export const LABEL_LIFT_M = 0.07;
/**
 * N19 E8 fix round 1 (review minor): how high a gripper car's distance tag stands over its ray's end (m): low by the claw and what it holds,
 * where LABEL_LIFT_M put it far over them (the ultrasonic is up on the deck). A rover's stays at LABEL_LIFT_M.
 */
export const GRIPPER_DISTANCE_LIFT_M = 0.025;
/** The tag is painted at most this often while the reading changes, s; the draw loop settling paints it exactly (`flushLabels`). */
export const LABEL_PERIOD_S = 0.1;
const ZONE_LIFT_M = 0.003;
/** The width of the goal zone's outline, cm. */
const ZONE_BAND_CM = 1.2;
const SPOT_PAINT = { halo: 0.32, core: 0.95, tick: 0.8 };

export type SensorOverlayOptions = {
  kit: Kit;
  model: RobotModel;
  scenario: Pick<Scenario, 'arena' | 'goals'>;
  /** The learner's decimal sign: ',' in Vietnamese. */
  decimal: string;
  /** The unit after the distance, and the words for no echo: the messages'. */
  unit: string;
  noEchoText: string;
  /** The camera's vertical field of view, degrees (the tag keeps its size on the screen through it). */
  fovDeg: number;
  /** The tier's detail: low leaves the cone's surface out. */
  detail: Detail;
  /** Makes the distance tag; tests give none, or their own. */
  makeLabel?: ((options: DistanceLabelOptions) => DistanceLabel | null) | undefined;
  /** N19 E5: the words of the gripper's tag, made once (the messages'); without them a gripper car's tag says nothing. */
  gripperWords?: GripperWords | undefined;
  /** N19 E5: makes the gripper's tag; tests give none, or their own. */
  makeWordsLabel?: ((options: WordsLabelOptions) => WordsLabel | null) | undefined;
};

/** N19 E5: every line the gripper's tag can say: the IR's two, the colour sensor's for each colour and before its first window. */
export type GripperWords = { irSeen: string; irClear: string; color: Readonly<Record<ColorName, string>>; noReading: string };

/** What the overlay shows now, for a test or the E2E (made on demand: it allocates). */
export type SensorOverlayProbe = {
  shown: boolean;
  ultrasonics: { role: string; visible: boolean; echo: boolean; cm: number; ray: boolean; hit: boolean; label: string | null }[];
  spots: { role: string; visible: boolean; dark: boolean }[];
  zone: string | null;
  /** The glow level the zone was last drawn at, 0 to 1. */
  pulse: number;
  /**
   * N19 E5: the gripper's sensors (null on a car without them): the IR beam (whether it sees), the colour ray (how far it reaches, whether
   * it meets something, the colour its spot is tinted for) and the tag's lines as painted.
   */
  gripper: {
    ir: { role: string; visible: boolean; detected: boolean } | null;
    color: { role: string; visible: boolean; hit: boolean; reachCm: number; color: ColorName | null } | null;
    label: string[] | null;
  } | null;
};

export type SensorOverlay = {
  /** Add this to the scene. */
  root: Group;
  /** Sets the overlay from `world` at `timeS` (the clock, for the tag's pace): hidden when `shown` is false; `pulse` (0 to 1) is the goal zone's glow. Allocates nothing. */
  update(world: RobotSnapshot, shown: boolean, pulse: number, timeS: number): void;
  /** Paints the tags that were held back to their latest reading; true when it did, so that a frame shows them. */
  flushLabels(): boolean;
  /**
   * N19 E4/E5: the objects' colours of the round shown (round-colors.ts), for the zone a goal placed by colour needs; null for the arena's
   * own. Kept until told again; the next `update` lights by it.
   */
  setRoundColors(colors: Readonly<Record<string, string>> | null): void;
  /**
   * N19 E4/E5 minor round (review 2, N2): whether two worlds draw the same overlays (`sameSensorView`), the next goal's zone worked out with
   * the very colours this overlay lights it by (the round's, else the arena's): the check that asks for a frame (SensorOverlay.tsx).
   */
  sameView(a: RobotSnapshot | null, b: RobotSnapshot | null): boolean;
  /** The distance tags (null where a canvas could not be made), one for each ultrasonic sensor, in the kit's order. */
  labels: readonly (DistanceLabel | null)[];
  /** Whether the tag of the sensor at `index` is on the screen now: the overlay is shown and the sensor has a reading. */
  labelShown(index: number): boolean;
  /** How far along the sensor's axis its tag belongs (m): at the end of its ray. The tag may be moved back along it. */
  labelReach(index: number): number;
  /** N19 E8: how high the distance tags stand over their rays' ends (m): GRIPPER_DISTANCE_LIFT_M on a gripper car, else LABEL_LIFT_M. */
  distanceLiftM: number;
  /** The beams, for a test. */
  beams: readonly Beam[];
  /** N19 E5: the gripper's tag (null without a gripper's sensors, or where a canvas could not be made), and whether it is on the screen now. */
  gripperLabel: WordsLabel | null;
  /**
   * N19 E4/E5 fix round 1: the jaws' room, which the gripper's tag keeps clear of on the screen (it would hide the beam and the spot it
   * names, seen from above): a box in the frame of the carriage (`frame`, three's axes, m), from its back to the fingers' tips, from under
   * the jaws to over a cube between them, as wide as the jaws open. Null without a gripper's sensors.
   */
  gripperRoom: { frame: Object3D; min: readonly [number, number, number]; max: readonly [number, number, number] } | null;
  gripperLabelShown(): boolean;
  /** N19 E5: the gripper's rays, for a test. */
  gripperRays: GripperRays | null;
  probe(): SensorOverlayProbe;
  dispose(): void;
};

type UltrasonicPart = {
  role: string;
  group: Group;
  mesh: Mesh;
  beam: Beam;
  label: DistanceLabel | null;
  glyphs: Int8Array;
  glyphCount: number;
  /**
   * The numbers of the latest reading, in a typed array (a double stored in an object's field makes garbage often enough to measure): what
   * the sensor heard (cm), the ray's length (m), and when the tag was last painted (s).
   */
  nums: Float64Array;
  /** Whether the latest reading had an echo. */
  echo: boolean;
  /** The axis ray's alpha as painted (strong with an echo). */
  axisEcho: boolean;
  /** The tag as painted: the reading's tenth (−2 for the words of no echo, −1 for nothing yet), and whether a later reading is held back. */
  paintedTenths: number;
  stale: boolean;
};

type ZonePart = { id: string; mesh: Mesh };

export function createSensorOverlay({ kit, model, scenario, decimal, unit, noEchoText, fovDeg, detail, makeLabel = createDistanceLabel, gripperWords, makeWordsLabel = createWordsLabel }: SensorOverlayOptions): SensorOverlay {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const own = (geometry: BufferGeometry): BufferGeometry => {
    geometries.push(geometry);
    return geometry;
  };
  // One shader program for every mesh: vertex colours with alpha. The zone's has a material of its own for its pulse (opacity).
  const material = (name: string): MeshBasicMaterial => {
    const made = new MeshBasicMaterial({ name, vertexColors: true, transparent: true, depthWrite: false });
    materials.push(made);
    return made;
  };
  const drawn = material('sensor-overlay');
  const zoneMaterial = material('sensor-goal');

  const root = new Group();
  root.name = 'sensor-overlay';
  const robot = new Group();
  robot.name = 'sensor-overlay-robot';
  // The robot's pose is written as a matrix (scene-math's `writePose` sets a quaternion, whose Euler sync makes about 145 bytes of garbage a
  // call: measured, sensor-overlay.allocation.test.ts), with the vector and the quaternion made here once.
  robot.matrixAutoUpdate = false;
  const robotAt = new Vector3();
  const robotTurn = new Quaternion();
  const robotScale = new Vector3(1, 1, 1);
  const placeRobot = (pose: Pose) => {
    robotAt.set(pose.xCm / CM_PER_M, pose.zCm / CM_PER_M, 0 - pose.yCm / CM_PER_M);
    robotTurn.set(pose.rotation.x, pose.rotation.z, 0 - pose.rotation.y, pose.rotation.w);
    robot.matrix.compose(robotAt, robotTurn, robotScale);
    robot.matrixWorldNeedsUpdate = true;
  };
  root.add(robot);

  // The ultrasonic sensors: at the mount, turned by its yaw; each beam one mesh in the sensor's frame.
  const beamLook = {
    cone: rgba(colors.cone, 0.1),
    edge: rgba(colors.cone, 0.55),
    axis: rgba(colors.ray, 0.92),
    axisQuiet: rgba(colors.ray, 0.3),
    hit: rgba(colors.hit, 0.95),
  };
  const ultrasonics: UltrasonicPart[] = model.ultrasonics.map((ultrasonic) => {
    const spec = kit.modules.find((module) => module.role === ultrasonic.role)?.spec as unknown as UltrasonicSpec | undefined;
    const group = new Group();
    group.name = `sensor-beam-${ultrasonic.role}`;
    group.position.set(...ultrasonic.position);
    group.rotation.y = ultrasonic.yawRad;
    const beam = buildBeam(spec?.coneHalfDeg ?? 15, detail, beamLook);
    const mesh = new Mesh(own(beam.geometry), drawn);
    mesh.name = 'sensor-beam';
    mesh.renderOrder = 22;
    // Its positions are written each frame: the bounding sphere of the unit beam would cull it wrongly.
    mesh.frustumCulled = false;
    const label = makeLabel({ decimal, unit, noEcho: noEchoText, fovDeg });
    group.add(mesh);
    if (label) group.add(label.sprite);
    group.visible = false;
    robot.add(group);
    return { role: ultrasonic.role, group, mesh, beam, label, glyphs: new Int8Array(LABEL_GLYPHS_MAX), glyphCount: 0, nums: new Float64Array(3), echo: false, axisEcho: true, paintedTenths: -1, stale: false };
  });

  // The line sensors: one mesh for all their spots, each eye's vertices moved to its floor spot.
  const eyes = model.lineSensors.map((sensor) => {
    const module = kit.modules.find((candidate) => candidate.role === sensor.role);
    const spec = module?.spec as unknown as LineSensorSpec | undefined;
    return { role: sensor.role, sensorIndex: sensor.sensorIndex, radiusM: spotDrawRadiusCm(spec?.spotRadiusCm) / CM_PER_M, heightM: sensor.position[1] };
  });
  const spots: Spots = buildSpots(eyes);
  const spotLook = { dark: rgba(colors.spotDark, 1), light: rgba(colors.spotLight, 1), ...SPOT_PAINT };
  const eyeShown = eyes.map(() => false);
  const eyeDark = eyes.map(() => false);
  eyes.forEach((_, i) => {
    spotsHide(spots, i);
    spotColor(spots, i, false, spotLook);
  });
  const spotMesh = new Mesh(own(spots.geometry), drawn);
  spotMesh.name = 'sensor-spots';
  spotMesh.renderOrder = 25;
  spotMesh.frustumCulled = false;
  spotMesh.visible = false;
  root.add(spotMesh);

  // The zones goals name (N19 E4/E5: a placed object's too), each one mesh (a fill and an outline) in the zone's own hue, shown one at a time.
  const named = goalZoneIds(scenario.goals);
  // N19 E4/E5: the objects' colours a goal placed by colour reads: the arena's own until a round is shown.
  const arenaColors: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(scenario.arena.objects.flatMap((object) => (object.color === undefined ? [] : [[object.id, object.color] as const]))));
  const round = { colors: arenaColors };
  const zones: ZonePart[] = scenario.arena.paint.zones
    .filter((zone) => named.has(zone.id))
    .map((zone) => {
      const hue = highlightColor(zone.color);
      const mesh = new Mesh(own(zoneHighlightGeometry(zone.polygonCm, rgba(hue, 0.24), rgba(hue, 0.8), ZONE_BAND_CM, ZONE_LIFT_M)), zoneMaterial);
      mesh.name = `sensor-goal-${zone.id}`;
      mesh.renderOrder = 20;
      mesh.visible = false;
      root.add(mesh);
      return { id: zone.id, mesh };
    });

  const carried = carriedSensors(kit, model, drawn, own, fovDeg, gripperWords, makeWordsLabel);
  const distanceLiftM = carried === null ? LABEL_LIFT_M : GRIPPER_DISTANCE_LIFT_M;
  if (carried !== null) robot.add(carried.group);

  root.traverse((node: Object3D) => {
    node.userData.compileWithScene = true;
  });

  // What `update` last did, for the probe: the clock and the pulse in a typed array, not variables of this closure or fields of an object
  // (a double stored in either makes a heap number often enough to measure; a typed array's element is written in place).
  const last = { shown: true, zone: null as string | null };
  const clock = new Float64Array([0, 0.5]);

  /** The ultrasonic reading of `role`, or null (no run yet). A loop, not a find: no closure is made. */
  const ultrasonicOf = (sensors: readonly SensorReadout[], role: string): Extract<SensorReadout, { kind: 'ultrasonic' }> | null => {
    for (let i = 0; i < sensors.length; i++) {
      const sensor = sensors[i]!;
      if (sensor.kind === 'ultrasonic' && sensor.role === role) return sensor;
    }
    return null;
  };

  /** Paints the tag with the part's latest reading. */
  const paint = (part: UltrasonicPart): void => {
    if (part.echo) {
      part.glyphCount = labelGlyphs(part.glyphs, part.nums[0]!);
      part.label?.show(part.glyphs, part.glyphCount);
      part.paintedTenths = Math.round(part.nums[0]! * 10);
    } else {
      part.glyphCount = 0;
      part.label?.showNoEcho();
      part.paintedTenths = -2;
    }
    part.nums[2] = clock[0]!;
    part.stale = false;
  };

  return {
    root,
    beams: ultrasonics.map((part) => part.beam),
    labels: ultrasonics.map((part) => part.label),
    labelShown: (index) => last.shown && ultrasonics[index]?.group.visible === true && ultrasonics[index]?.label !== null,
    labelReach: (index) => ultrasonics[index]?.nums[1] ?? 0,
    distanceLiftM,
    flushLabels() {
      if (!last.shown) return false;
      let painted = false;
      for (let i = 0; i < ultrasonics.length; i++) {
        const part = ultrasonics[i]!;
        if (!part.stale || !part.group.visible) continue;
        paint(part);
        painted = true;
      }
      return painted;
    },
    update(world, shown, pulse, timeS) {
      last.shown = shown;
      clock[0] = timeS;
      root.visible = shown;
      if (!shown) return;
      placeRobot(world.robot);

      for (let i = 0; i < ultrasonics.length; i++) {
        const part = ultrasonics[i]!;
        const reading = ultrasonicOf(world.sensors, part.role);
        part.group.visible = reading !== null;
        if (reading === null) continue;
        const echo = reading.hitId !== null;
        // With no echo the ray is the short, faded one of the 2D map (R4.6), not the sensor's whole 400 cm.
        const length = (echo || reading.cm < NO_ECHO_RAY_CM ? reading.cm : NO_ECHO_RAY_CM) / CM_PER_M;
        part.beam.length[0] = length;
        beamWrite(part.beam, echo);
        if (echo !== part.axisEcho) {
          beamAxisEcho(part.beam, echo);
          part.axisEcho = echo;
        }
        part.nums[0] = reading.cm;
        part.nums[1] = length;
        part.echo = echo;
        part.label?.sprite.position.set(length, distanceLiftM, 0);
        // The tag: painted when it is new, or the echo came or went, or the reading changed and the last paint is old enough; else held back.
        const tenths = echo ? Math.round(reading.cm * 10) : -2;
        if (tenths === part.paintedTenths) part.stale = false;
        else if (part.paintedTenths === -1 || (tenths === -2) !== (part.paintedTenths === -2) || timeS - part.nums[2]! >= LABEL_PERIOD_S) paint(part);
        else part.stale = true;
      }

      let anySpot = false;
      for (let i = 0; i < eyes.length; i++) {
        const eye = eyes[i]!;
        const reading = world.sensors[eye.sensorIndex];
        const at = reading?.kind === 'line-sensor' ? reading.spotCm : null;
        if (reading?.kind !== 'line-sensor' || at === null) {
          if (eyeShown[i]) {
            spotsHide(spots, i);
            eyeShown[i] = false;
          }
          continue;
        }
        anySpot = true;
        // The arena's (x, y) cm on the mat: (x, 0 − y) / 100 m in three's frame.
        spots.at[0] = at[0] / CM_PER_M;
        spots.at[1] = 0 - at[1] / CM_PER_M;
        spotsWrite(spots, i);
        eyeShown[i] = true;
        if (reading.dark !== eyeDark[i]) {
          spotColor(spots, i, reading.dark, spotLook);
          eyeDark[i] = reading.dark;
        }
      }
      spotMesh.visible = anySpot;

      const next = nextGoalZoneId(scenario.goals, world.score.goals, round.colors);
      last.zone = next;
      clock[1] = pulse;
      for (let i = 0; i < zones.length; i++) zones[i]!.mesh.visible = zones[i]!.id === next;
      zoneMaterial.opacity = 0.75 + 0.4 * pulse;
      carried?.update(world);
    },
    probe() {
      const sign = decimal;
      const text = (part: UltrasonicPart) => {
        if (part.paintedTenths === -2) return noEchoText;
        let out = '';
        for (let i = 0; i < part.glyphCount; i++) out += part.glyphs[i]! === GLYPH.separator ? sign : String(part.glyphs[i]);
        return `${out} ${unit}`;
      };
      return {
        shown: last.shown,
        ultrasonics: ultrasonics.map((part) => ({
          role: part.role,
          visible: last.shown && part.group.visible,
          echo: part.echo,
          cm: part.nums[0]!,
          ray: last.shown && part.group.visible && part.nums[1]! > 0,
          hit: last.shown && part.group.visible && part.echo,
          label: part.group.visible && part.paintedTenths !== -1 ? text(part) : null,
        })),
        spots: eyes.map((eye, i) => ({ role: eye.role, visible: last.shown && eyeShown[i]!, dark: eyeDark[i]! })),
        zone: last.shown ? last.zone : null,
        pulse: clock[1]!,
        gripper: carried?.probe(last.shown) ?? null,
      };
    },
    setRoundColors(colors) {
      round.colors = colors ?? arenaColors;
    },
    sameView: (a, b) => sameSensorView(a, b, scenario.goals, round.colors),
    gripperLabel: carried?.label ?? null,
    gripperRoom: carried?.room ?? null,
    gripperLabelShown: () => last.shown && carried !== null && carried.labelShown(),
    gripperRays: carried?.rays ?? null,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const made of materials) made.dispose();
      for (const part of ultrasonics) part.label?.dispose();
      carried?.label?.dispose();
    },
  };
}

/** N19 E5: where the gripper's tag stands over the jaws' middle, m above the carriage's origin (SensorOverlay.tsx may lift it more). */
export const GRIPPER_LABEL_LIFT_M = 0.045;

type Carried = {
  group: Group;
  room: NonNullable<SensorOverlay['gripperRoom']>;
  rays: GripperRays;
  label: WordsLabel | null;
  update(world: RobotSnapshot): void;
  labelShown(): boolean;
  probe(shown: boolean): NonNullable<SensorOverlayProbe['gripper']>;
};

/**
 * N19 E5: the sensors the gripper's carriage carries (null for a car without them): one mesh of their rays in a group the boom holds, and
 * their tag. `update` moves the group to the carriage (its pose from robot.gripper, gripper-pose.ts: level, at the boom's tip), paints the
 * IR beam and the colour spot only when what they read changes, and the tag only when its words do. It makes nothing.
 */
function carriedSensors(
  kit: Kit,
  model: RobotModel,
  material: MeshBasicMaterial,
  own: (geometry: BufferGeometry) => BufferGeometry,
  fovDeg: number,
  words: GripperWords | undefined,
  makeWordsLabel: (options: WordsLabelOptions) => WordsLabel | null,
): Carried | null {
  const gripper = model.gripper;
  if (gripper === null || (gripper.ir === null && gripper.color === null)) return null;
  const specOf = <T,>(role: string) => kit.modules.find((module) => module.role === role)?.spec as unknown as T | undefined;
  const ir = gripper.ir;
  const color = gripper.color;
  const irRangeM = ir === null ? 0 : (specOf<IrObstacleSpec>(ir.role)?.rangeCm ?? 2) / CM_PER_M;
  const colorRangeM = color === null ? 0 : (specOf<ColorSensorSpec>(color.role)?.rangeCm ?? 4) / CM_PER_M;
  const rays = buildGripperRays(ir === null ? null : { at: ir.position, rangeM: irRangeM }, color === null ? null : { at: color.position }, {
    irQuiet: rgba(colors.ir, 0.35),
    irSeen: rgba(colors.ir, 0.95),
    colorRay: rgba(colors.spotRing, 0.75),
    colorRayQuiet: rgba(colors.colorRayQuiet, COLOR_RAY_QUIET_ALPHA),
    spotRing: rgba(colors.spotRing, 0.95),
  });
  // The tints, by the colour's index in COLOR_NAMES (none for "không rõ").
  const tints: (Rgba | null)[] = COLOR_NAMES.map((name) => {
    const hex = readingTints[name];
    return hex === null ? null : rgba(hex, 1);
  });
  gripperRaysIr(rays, false);
  gripperRaysColor(rays, false, null);
  const group = new Group();
  group.name = 'sensor-gripper';
  group.visible = false;
  const mesh = new Mesh(own(rays.geometry), material);
  mesh.name = 'sensor-gripper-rays';
  mesh.renderOrder = 23;
  // Its positions are written as the colour ray's reach changes: its bounding sphere would cull it wrongly.
  mesh.frustumCulled = false;
  group.add(mesh);
  const label = words === undefined ? null : makeWordsLabel({ fovDeg });
  if (label !== null) {
    // Over the jaws' middle.
    label.sprite.position.set(gripper.hinge.uM + gripper.finger.lengthM / 2, GRIPPER_LABEL_LIFT_M, 0);
    group.add(label.sprite);
  }
  // What is painted now, as small integers in one typed array (a number in a closure's variable or an object's field makes garbage often
  // enough to measure): the IR beam (−1 not yet, 0 quiet, 1 seeing), the colour ray (−1 not yet, 0 no hit, 1 a hit), the spot's tint
  // (−2 not yet, −1 none, else the colour's index in COLOR_NAMES), the class of the last counts (−1 none yet), the tag's two lines (−3
  // never painted, −2 left out; the IR's 0/1; the colour's index, −1 for no reading), and whether each sensor is shown now (0/1).
  const S = { ir: 0, hit: 1, tint: 2, classified: 3, lineIr: 4, lineColor: 5, irOn: 6, colorOn: 7 } as const;
  const state = new Int8Array([-1, -1, -2, -1, -3, -3, 0, 0]);
  // The colour sensor's last counts (r, g, b, c), the ray's reach (m) and the lift the carriage was placed at (degrees), for what changed.
  const last = new Float64Array([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
  const [pivotX, pivotY, pivotZ] = gripper.position;
  const colorText = (index: number): string | null => (words === undefined ? null : index === -1 ? words.noReading : words.color[COLOR_NAMES[index]!]);
  // The jaws' room (`gripperRoom`): from the carriage's back to the fingers' tips, under the jaws to over a 4 cm cube between them, as wide
  // as the open jaws reach (the hinges and a finger's length turned out by its open angle). N19 E8 (review F1): and the claw servo's case
  // on the carriage, with 3 mm round it (its top at 2.67 cm stood over the room's 2.6, and "Theo xe" sees the tag over the case and the cube).
  const reach = gripper.hinge.uM + gripper.finger.lengthM;
  const half = gripper.hinge.vM + gripper.finger.lengthM * Math.sin((gripper.fingerOpenDeg * Math.PI) / 180) + gripper.finger.thicknessM;
  const { center: servoAt, size: servoSize } = gripper.clawServo;
  const room = {
    frame: group,
    min: [Math.min(-0.006, servoAt[0] - servoSize[0] / 2 - 0.003), -0.018, Math.min(-half, servoAt[2] - servoSize[2] / 2 - 0.003)] as const,
    max: [reach + 0.003, Math.max(0.026, servoAt[1] + servoSize[1] / 2 + 0.003), Math.max(half, servoAt[2] + servoSize[2] / 2 + 0.003)] as const,
  };
  return {
    group,
    room,
    rays,
    label,
    update(world) {
      // The carriage at the boom's tip, level (gripper-pose.ts's pose, written here: its pose object stores doubles in fields, which makes
      // garbage a call), placed again only when the lift moves.
      const liftDeg = gripperStateOf(world).liftDeg;
      if (liftDeg !== last[5]) {
        last[5] = liftDeg;
        const elevation = ((gripper.elevationAtLift0Deg + liftDeg) * Math.PI) / 180;
        const at = group.position;
        at.x = pivotX + gripper.boomLengthM * Math.cos(elevation);
        at.y = pivotY + gripper.boomLengthM * Math.sin(elevation);
        at.z = pivotZ;
      }
      const irReading = ir === null ? undefined : world.sensors[ir.sensorIndex];
      const irOn = irReading?.kind === 'ir-obstacle';
      if (irOn) {
        const seeing = irReading.detected ? 1 : 0;
        if (seeing !== state[S.ir]) {
          gripperRaysIr(rays, seeing === 1);
          state[S.ir] = seeing;
        }
      }
      const colorReading = color === null ? undefined : world.sensors[color.sensorIndex];
      const colorOn = colorReading?.kind === 'color-sensor';
      if (colorOn) {
        const reach = colorReading.distanceCm === null ? colorRangeM : colorReading.distanceCm / CM_PER_M;
        if (reach !== last[4]) {
          last[4] = reach;
          rays.reach[0] = reach;
          gripperRaysWrite(rays);
        }
        // The colour is classified again only when the counts change (a new window, about every 53 ms).
        const rgbc = colorReading.rgbc;
        if (rgbc === undefined) {
          state[S.classified] = -1;
          last[0] = Number.NaN;
        } else if (rgbc.r !== last[0] || rgbc.g !== last[1] || rgbc.b !== last[2] || rgbc.c !== last[3]) {
          last[0] = rgbc.r;
          last[1] = rgbc.g;
          last[2] = rgbc.b;
          last[3] = rgbc.c;
          state[S.classified] = classifyColor(rgbc);
        }
        const hit = colorReading.hitId === null ? 0 : 1;
        const tint = state[S.classified]!;
        if (hit !== state[S.hit] || tint !== state[S.tint]) {
          gripperRaysColor(rays, hit === 1, tint === -1 ? null : tints[tint]!);
          state[S.hit] = hit;
          state[S.tint] = tint;
        }
      }
      state[S.irOn] = irOn ? 1 : 0;
      state[S.colorOn] = colorOn ? 1 : 0;
      group.visible = irOn || colorOn;
      // The tag: painted when its words change.
      const irLine = irOn ? state[S.ir]! : -2;
      const colorLine = colorOn ? state[S.classified]! : -2;
      if (words !== undefined && (irLine !== state[S.lineIr] || colorLine !== state[S.lineColor])) {
        label?.show(irLine === -2 ? null : irLine === 1 ? words.irSeen : words.irClear, colorLine === -2 ? null : colorText(colorLine));
        state[S.lineIr] = irLine;
        state[S.lineColor] = colorLine;
      }
    },
    labelShown: () => group.visible && label !== null && label.widthShare > 0,
    probe(on) {
      const [irLine, colorLine] = [state[S.lineIr]!, state[S.lineColor]!];
      const lines = words === undefined || irLine === -3 ? null : [...(irLine === -2 ? [] : [irLine === 1 ? words.irSeen : words.irClear]), ...(colorLine === -2 ? [] : [colorText(colorLine)!])];
      const tint = state[S.tint]!;
      return {
        ir: ir === null ? null : { role: ir.role, visible: on && state[S.irOn] === 1, detected: state[S.ir] === 1 },
        color: color === null ? null : { role: color.role, visible: on && state[S.colorOn] === 1, hit: state[S.hit] === 1, reachCm: Number.isNaN(last[4]!) ? 0 : last[4]! * CM_PER_M, color: state[S.colorOn] === 1 && tint >= 0 ? COLOR_NAMES[tint]! : null },
        label: on && group.visible ? lines : null,
      };
    },
  };
}
