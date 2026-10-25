import { BufferGeometry, CylinderGeometry, DataTexture, Euler, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion, SphereGeometry, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Kit, LineSensorSpec, UltrasonicSpec } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import type { RobotModel } from '../robot-model';
import { CM_PER_M } from '../../../core/world/units';
import { sensorColors as colors } from '../sensor-colors';
import { GLYPH, labelGlyphs, LABEL_GLYPHS_MAX, nextGoalZoneId, spotDrawRadiusCm } from '../sensor-overlay-math';
import { createDistanceLabel, type DistanceLabel } from './distance-label';
import { spotMaskTexture } from './spot-mask';
import { zoneBandGeometry, zoneFillGeometry } from './zone-highlight';

// The sensor overlays of the 3D view (N18 R4.3): what the robot "sees", drawn over the arena for a learner to read, from the snapshot's
// readouts and score and never worked out again.
//
//   - Ultrasonic: the axis ray from the module's mount to the distance it heard (400 cm when there is no echo), the nearest echo as a
//     dot and a tag with the distance in cm. The snapshot carries the nearest echo of the sensor's five rays (its `cm` and `hitId`), not the
//     rays one by one, so the cone is an outline of the same slant length from the sensor (four edges and a soft fill): where the sensor
//     listens, not five measured hits.
//   - Line sensors: the floor spot each reads (its centre from the readout, its radius the kit's), a red disc in a ring where it reads
//     dark, a slate ring where it reads bright. Drawn over the robot (no depth test): the spots are under the chassis.
//   - The goal's zone: a soft fill and outline on the zone the next unmet goal needs, pulsing while a run goes on.
//
// It is plain three with no React: `createSensorOverlay` builds the geometry and the materials once, `update` sets them from a world in a
// frame callback and makes nothing (it moves, scales, shows and hides what exists). Every material is a MeshBasicMaterial with an alpha
// map, transparent, as the contact shadows are (and the tags' sprite for the tag), so the overlays add no shader program to the scene's.
// Everything is flagged `compileWithScene` (Scene.tsx CompiledDraw): hidden until a reading comes, but compiled with the scene.

const RAY_RADIUS_M = 0.003;
/** The cone's edges are one mesh scaled in all directions by the reading: this thick at 1 m, thinner at less (0.7 mm at 30 cm). */
const EDGE_RADIUS_M = 0.0024;
const HIT_RADIUS_M = 0.012;
/** The tag floats this far over the point of the echo, m. */
const LABEL_LIFT_M = 0.07;
/** With no echo the ray goes on to 400 cm; the tag stays this far from the sensor, where the learner can read it, m. */
const NO_ECHO_LABEL_M = 0.25;
const ZONE_LIFT_M = 0.003;
const SPOT_LIFT_M = 0.005;
/** The width of the goal zone's outline, cm. */
const ZONE_BAND_CM = 1.2;
const CONE_RING_SEGMENTS = 24;
/** A spot's quad is this much wider than the spot (the mask's shape fills SPOT_EXTENT of it, with room for its soft edge). */
const SPOT_QUAD = 1 / 0.9;

export type SensorOverlayOptions = {
  kit: Kit;
  model: RobotModel;
  scenario: Pick<Scenario, 'arena' | 'goals'>;
  /** The learner's decimal sign: ',' in Vietnamese. */
  decimal: string;
  /** The camera's vertical field of view, degrees (the tag keeps its size on the screen through it). */
  fovDeg: number;
  /** Makes the distance tag; tests give none. */
  makeLabel?: ((options: { decimal: string; fovDeg: number }) => DistanceLabel | null) | undefined;
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
  /** Sets the overlay from `world`: hidden when `shown` is false; `pulse` (0 to 1) is the goal zone's glow. Allocates nothing. */
  update(world: RobotSnapshot, shown: boolean, pulse: number): void;
  /** The distance tags (null where a canvas could not be made), one for each ultrasonic sensor, in the kit's order. */
  labels: readonly (DistanceLabel | null)[];
  /** Whether the tag of the sensor at `index` is on the screen now: the overlay is shown and the sensor has a reading. */
  labelShown(index: number): boolean;
  /** How far along the sensor's axis its tag belongs (m): at the echo, or near the sensor when there is none. The tag may be moved back along it. */
  labelReach(index: number): number;
  probe(): SensorOverlayProbe;
  dispose(): void;
};

type UltrasonicPart = {
  role: string;
  group: Group;
  cone: Mesh;
  axis: Mesh;
  /** The cone's four edges, one mesh; `tips` mark where the left, right, up and down edge end (for a test). */
  edges: Mesh;
  tips: Object3D[];
  hit: Mesh;
  label: DistanceLabel | null;
  glyphs: Int8Array;
  glyphCount: number;
  tenths: number;
  echo: boolean;
  cm: number;
};

type SpotPart = { role: string; sensorIndex: number; spot: Mesh; dark: boolean };

type ZonePart = { id: string; group: Group };

/** The cone of `halfDeg` as a surface: the apex and a fan to a ring of segments at slant length 1, facing outward (one layer, no cap). */
function coneGeometry(halfDeg: number): BufferGeometry {
  const half = (halfDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(half), Math.sin(half)];
  // three's frame: forward +X, up +Y, right +Z; the ring starts at the up edge and goes towards the right.
  const positions: number[] = [0, 0, 0];
  for (let k = 0; k < CONE_RING_SEGMENTS; k++) {
    const angle = (2 * Math.PI * k) / CONE_RING_SEGMENTS;
    positions.push(c, s * Math.cos(angle), s * Math.sin(angle));
  }
  const index: number[] = [];
  for (let k = 0; k < CONE_RING_SEGMENTS; k++) index.push(0, 1 + ((k + 1) % CONE_RING_SEGMENTS), 1 + k);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

/** A cylinder of `radius` along +X from 0 to 1 (scaled in x to the length wanted). */
function rodGeometry(radius: number): BufferGeometry {
  return new CylinderGeometry(radius, radius, 1, 6, 1, true).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
}

/** The four edges of a cone of `half` rad as one geometry of unit-length rods from the apex: left (towards −Z), right, up, down. */
function edgesGeometry(half: number): BufferGeometry {
  const turns = [new Euler(0, half, 0), new Euler(0, -half, 0), new Euler(0, 0, half), new Euler(0, 0, -half)];
  return mergeGeometries(turns.map((turn) => rodGeometry(EDGE_RADIUS_M).applyMatrix4(new Matrix4().makeRotationFromEuler(turn))))!;
}

export function createSensorOverlay({ kit, model, scenario, decimal, fovDeg, makeLabel = createDistanceLabel }: SensorOverlayOptions): SensorOverlay {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: DataTexture[] = [];
  const own = <T extends BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  // The alpha map lets all of it through; it is there so that the meshes are drawn with the contact shadows' program.
  const clear = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  clear.needsUpdate = true;
  textures.push(clear);
  const basic = (name: string, color: string, opacity: number, depthTest = true): MeshBasicMaterial => {
    const material = new MeshBasicMaterial({ name, color, alphaMap: clear, transparent: true, opacity, depthWrite: false, depthTest });
    materials.push(material);
    return material;
  };
  const spotMaterial = (name: string, color: string, shape: 'ring' | 'disc'): MeshBasicMaterial => {
    const mask = spotMaskTexture(shape);
    textures.push(mask);
    const material = new MeshBasicMaterial({ name, color, alphaMap: mask, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    materials.push(material);
    return material;
  };
  const look = {
    axisEcho: basic('sensor-ray', colors.ray, 0.92),
    axisQuiet: basic('sensor-ray-quiet', colors.ray, 0.3),
    cone: basic('sensor-cone', colors.cone, 0.1),
    edge: basic('sensor-cone-edge', colors.cone, 0.55),
    hit: basic('sensor-hit', colors.hit, 0.95),
    // A spot is a quad cut by a mask: a ring where the sensor reads bright, a disc where it reads dark; over the robot (no depth test).
    spotLight: spotMaterial('sensor-spot-light', colors.spotLight, 'ring'),
    spotDark: spotMaterial('sensor-spot-dark', colors.spotDark, 'disc'),
    goalFill: basic('sensor-goal', colors.goal, 0.22),
    goalBand: basic('sensor-goal-edge', colors.goalEdge, 0.75),
  };

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

  // The ultrasonic sensors: at the mount, turned by its yaw; everything of the beam is built at slant length 1 m and scaled by the reading.
  const rod = own(rodGeometry(RAY_RADIUS_M));
  const dot = own(new SphereGeometry(HIT_RADIUS_M, 12, 8));
  const ultrasonics: UltrasonicPart[] = model.ultrasonics.map((ultrasonic) => {
    const spec = kit.modules.find((module) => module.role === ultrasonic.role)?.spec as unknown as UltrasonicSpec | undefined;
    const half = (spec?.coneHalfDeg ?? 15) * (Math.PI / 180);
    const group = new Group();
    group.name = `sensor-beam-${ultrasonic.role}`;
    group.position.set(...ultrasonic.position);
    group.rotation.y = ultrasonic.yawRad;
    const cone = new Mesh(own(coneGeometry(spec?.coneHalfDeg ?? 15)), look.cone);
    cone.name = 'sensor-cone';
    cone.renderOrder = 22;
    const axis = new Mesh(rod, look.axisEcho);
    axis.name = 'sensor-axis';
    axis.renderOrder = 23;
    // The four edges, left (towards −Z), right, up and down, one mesh (a tip marks the end of each, where a test looks).
    const edges = new Mesh(own(edgesGeometry(half)), look.edge);
    edges.name = 'sensor-cone-edges';
    edges.renderOrder = 22;
    const tips = [new Euler(0, half, 0), new Euler(0, -half, 0), new Euler(0, 0, half), new Euler(0, 0, -half)].map((turn) => {
      const tip = new Object3D();
      tip.name = 'sensor-cone-tip';
      tip.position.set(1, 0, 0).applyEuler(turn);
      edges.add(tip);
      return tip;
    });
    const hit = new Mesh(dot, look.hit);
    hit.name = 'sensor-hit';
    hit.renderOrder = 24;
    const label = makeLabel({ decimal, fovDeg });
    group.add(cone, axis, edges, hit);
    if (label) group.add(label.sprite);
    group.visible = false;
    robot.add(group);
    return { role: ultrasonic.role, group, cone, axis, edges, tips, hit, label, glyphs: new Int8Array(LABEL_GLYPHS_MAX), glyphCount: 0, tenths: -1, echo: false, cm: 0 };
  });

  // The line sensors: a quad flat on the mat at the readout's spot, as big as the kit's spot (at least MIN_SPOT_RADIUS_CM), one draw each.
  const quad = own(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2));
  const spots: SpotPart[] = model.lineSensors.map((sensor) => {
    const spec = kit.modules.find((module) => module.role === sensor.role)?.spec as unknown as LineSensorSpec | undefined;
    const radius = (spotDrawRadiusCm(spec?.spotRadiusCm) / CM_PER_M) * SPOT_QUAD;
    const spot = new Mesh(quad, look.spotLight);
    spot.name = `sensor-spot-${sensor.role}`;
    spot.scale.set(radius, 1, radius);
    spot.renderOrder = 25;
    spot.visible = false;
    root.add(spot);
    return { role: sensor.role, sensorIndex: sensor.sensorIndex, spot, dark: false };
  });

  // The zones goals name, each a fill and an outline, shown one at a time.
  const named = new Set<string>();
  for (const goal of scenario.goals) {
    if (goal.kind === 'reach-zone' || goal.kind === 'object-in-zone' || goal.kind === 'stop-in-zone') named.add(goal.zone);
    else if (goal.kind === 'checkpoints-in-order') goal.zones.forEach((zone) => named.add(zone));
    else if (goal.kind === 'servo-angle' && goal.whenInZone !== undefined) named.add(goal.whenInZone);
  }
  const zones: ZonePart[] = scenario.arena.paint.zones
    .filter((zone) => named.has(zone.id))
    .map((zone) => {
      const group = new Group();
      group.name = `sensor-goal-${zone.id}`;
      const fill = new Mesh(own(zoneFillGeometry(zone.polygonCm, ZONE_LIFT_M)), look.goalFill);
      fill.renderOrder = 20;
      const band = new Mesh(own(zoneBandGeometry(zone.polygonCm, ZONE_BAND_CM, ZONE_LIFT_M + 0.0005)), look.goalBand);
      band.renderOrder = 21;
      group.add(fill, band);
      group.visible = false;
      root.add(group);
      return { id: zone.id, group };
    });

  root.traverse((node: Object3D) => {
    node.userData.compileWithScene = true;
  });

  // What `update` last did, for the probe: fields, not variables of this closure (storing a number in a closure's variable makes a heap
  // number each time; in a field it is written in place).
  const last = { shown: true, zone: null as string | null, pulse: 0.5 };

  /** The ultrasonic reading of `role`, or null (no run yet). A loop, not a find: no closure is made. */
  const ultrasonicOf = (sensors: readonly SensorReadout[], role: string): Extract<SensorReadout, { kind: 'ultrasonic' }> | null => {
    for (let i = 0; i < sensors.length; i++) {
      const sensor = sensors[i]!;
      if (sensor.kind === 'ultrasonic' && sensor.role === role) return sensor;
    }
    return null;
  };

  return {
    root,
    labels: ultrasonics.map((part) => part.label),
    labelShown: (index) => last.shown && ultrasonics[index]?.group.visible === true && ultrasonics[index]?.label !== null,
    labelReach: (index) => {
      const part = ultrasonics[index];
      return part === undefined ? 0 : part.echo ? part.cm / CM_PER_M : Math.min(part.cm / CM_PER_M, NO_ECHO_LABEL_M);
    },
    update(world, shown, pulse) {
      last.shown = shown;
      root.visible = shown;
      if (!shown) return;
      placeRobot(world.robot);

      for (let i = 0; i < ultrasonics.length; i++) {
        const part = ultrasonics[i]!;
        const reading = ultrasonicOf(world.sensors, part.role);
        part.group.visible = reading !== null;
        if (reading === null) continue;
        const echo = reading.hitId !== null;
        const length = reading.cm / 100;
        part.cone.scale.set(length, length, length);
        part.axis.scale.x = length;
        part.axis.material = echo ? look.axisEcho : look.axisQuiet;
        part.edges.scale.set(length, length, length);
        part.hit.visible = echo;
        part.hit.position.x = length;
        part.cm = reading.cm;
        const tenths = Math.round(reading.cm * (echo ? 10 : 1));
        if (tenths !== part.tenths || echo !== part.echo) {
          part.glyphCount = labelGlyphs(part.glyphs, reading.cm, echo);
          part.label?.show(part.glyphs, part.glyphCount);
          part.tenths = tenths;
          part.echo = echo;
        }
        part.label?.sprite.position.set(echo ? length : Math.min(length, NO_ECHO_LABEL_M), LABEL_LIFT_M, 0);
      }

      for (let i = 0; i < spots.length; i++) {
        const spot = spots[i]!;
        const reading = world.sensors[spot.sensorIndex];
        const at = reading?.kind === 'line-sensor' ? reading.spotCm : null;
        if (reading?.kind !== 'line-sensor' || at === null) {
          spot.spot.visible = false;
          continue;
        }
        spot.spot.visible = true;
        // The arena's (x, y) cm on the mat: (x, 0 − y) / 100 m in three's frame.
        spot.spot.position.set(at[0] / CM_PER_M, SPOT_LIFT_M, 0 - at[1] / CM_PER_M);
        spot.dark = reading.dark;
        spot.spot.material = reading.dark ? look.spotDark : look.spotLight;
      }

      const next = nextGoalZoneId(scenario.goals, world.score.goals);
      last.zone = next;
      last.pulse = pulse;
      for (let i = 0; i < zones.length; i++) zones[i]!.group.visible = zones[i]!.id === next;
      look.goalFill.opacity = 0.14 + 0.16 * pulse;
      look.goalBand.opacity = 0.55 + 0.4 * pulse;
    },
    probe() {
      const sign = decimal;
      const text = (part: UltrasonicPart) => {
        let out = '';
        for (let i = 0; i < part.glyphCount; i++) {
          const glyph = part.glyphs[i]!;
          out += glyph < 10 ? String(glyph) : glyph === GLYPH.separator ? sign : glyph === GLYPH.space ? ' ' : glyph === GLYPH.c ? 'c' : 'm';
        }
        return out;
      };
      return {
        shown: last.shown,
        ultrasonics: ultrasonics.map((part) => ({
          role: part.role,
          visible: last.shown && part.group.visible,
          echo: part.echo,
          cm: part.cm,
          ray: last.shown && part.group.visible && part.axis.scale.x > 0,
          hit: last.shown && part.group.visible && part.hit.visible,
          label: part.group.visible && part.glyphCount > 0 ? text(part) : null,
        })),
        spots: spots.map((spot) => ({ role: spot.role, visible: last.shown && spot.spot.visible, dark: spot.dark })),
        zone: last.shown ? last.zone : null,
        pulse: last.pulse,
      };
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      for (const part of ultrasonics) part.label?.dispose();
    },
  };
}
