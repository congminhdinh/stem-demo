import { Group, Mesh, MeshBasicMaterial, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import type { Kit, LineSensorSpec, UltrasonicSpec } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { CM_PER_M } from '../../../core/world/units';
import type { Detail } from '../lighting/look';
import type { RobotModel } from '../robot-model';
import { sensorColors as colors } from '../sensor-colors';
import { GLYPH, highlightColor, labelGlyphs, LABEL_GLYPHS_MAX, nextGoalZoneId, spotDrawRadiusCm } from '../sensor-overlay-math';
import { NO_ECHO_RAY_CM } from '../top-view-math';
import { createDistanceLabel, type DistanceLabel, type DistanceLabelOptions } from './distance-label';
import { beamAxisEcho, beamWrite, buildBeam, buildSpots, rgba, spotColor, spotsHide, spotsWrite, type Beam, type Spots } from './overlay-geometry';
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
//
// It is plain three with no React, and its whole cost is four draw calls (a beam's mesh, the spots' mesh, the zone's mesh, the tag): each
// is a vertex-coloured mesh (overlay-geometry.ts) built once, whose positions `update` writes in place. `update` makes no object. All of
// it shares one shader program (MeshBasicMaterial with vertex colours and alpha) and, with the tag's sprite, adds only that to the scene's.
// Everything is flagged `compileWithScene` (Scene.tsx CompiledDraw): hidden until a reading comes, but compiled with the scene.

const LABEL_LIFT_M = 0.07;
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
};

/** What the overlay shows now, for a test or the E2E (made on demand: it allocates). */
export type SensorOverlayProbe = {
  shown: boolean;
  ultrasonics: { role: string; visible: boolean; echo: boolean; cm: number; ray: boolean; hit: boolean; label: string | null }[];
  spots: { role: string; visible: boolean; dark: boolean }[];
  zone: string | null;
  /** The glow level the zone was last drawn at, 0 to 1. */
  pulse: number;
};

export type SensorOverlay = {
  /** Add this to the scene. */
  root: Group;
  /** Sets the overlay from `world` at `timeS` (the clock, for the tag's pace): hidden when `shown` is false; `pulse` (0 to 1) is the goal zone's glow. Allocates nothing. */
  update(world: RobotSnapshot, shown: boolean, pulse: number, timeS: number): void;
  /** Paints the tags that were held back to their latest reading; true when it did, so that a frame shows them. */
  flushLabels(): boolean;
  /** The distance tags (null where a canvas could not be made), one for each ultrasonic sensor, in the kit's order. */
  labels: readonly (DistanceLabel | null)[];
  /** Whether the tag of the sensor at `index` is on the screen now: the overlay is shown and the sensor has a reading. */
  labelShown(index: number): boolean;
  /** How far along the sensor's axis its tag belongs (m): at the end of its ray. The tag may be moved back along it. */
  labelReach(index: number): number;
  /** The beams, for a test. */
  beams: readonly Beam[];
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

export function createSensorOverlay({ kit, model, scenario, decimal, unit, noEchoText, fovDeg, detail, makeLabel = createDistanceLabel }: SensorOverlayOptions): SensorOverlay {
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

  // The zones goals name, each one mesh (a fill and an outline) in the zone's own hue, shown one at a time.
  const named = new Set<string>();
  for (const goal of scenario.goals) {
    if (goal.kind === 'reach-zone' || goal.kind === 'object-in-zone' || goal.kind === 'stop-in-zone') named.add(goal.zone);
    else if (goal.kind === 'checkpoints-in-order') goal.zones.forEach((zone) => named.add(zone));
    else if (goal.kind === 'servo-angle' && goal.whenInZone !== undefined) named.add(goal.whenInZone);
  }
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
        part.label?.sprite.position.set(length, LABEL_LIFT_M, 0);
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

      const next = nextGoalZoneId(scenario.goals, world.score.goals);
      last.zone = next;
      clock[1] = pulse;
      for (let i = 0; i < zones.length; i++) zones[i]!.mesh.visible = zones[i]!.id === next;
      zoneMaterial.opacity = 0.75 + 0.4 * pulse;
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
      };
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const made of materials) made.dispose();
      for (const part of ultrasonics) part.label?.dispose();
    },
  };
}
