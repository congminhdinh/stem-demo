import type { RobotPointCm } from '../../core/hardware/kit';
import type { Scenario } from '../../core/scenario/scenario';
import type { Pose, RobotSnapshot, ScoreState } from '../../core/world/snapshot';

// The arithmetic of the sensor overlays (N18 R4.3), in the 3D view (parts/sensor-overlay.ts) and on the 2D map (TopViewSensors.tsx): what
// the robot "sees" drawn over the arena so that a learner can read it. Plain numbers, tested exactly; nothing here imports three or Konva.
//
// The overlays draw the snapshot and never work a reading out again (the sensors are measured once per tick, in the world). What the
// snapshot holds of an ultrasonic sensor is its nearest echo (`cm`, `hitId`), not its five rays one by one, so the axis ray is drawn to
// that distance and the cone as an outline of the same slant length from the sensor: where the sensor listens, not five measured hits.

export type Vec3Cm = readonly [number, number, number];

const RAD = Math.PI / 180;

/**
 * The five rays of an ultrasonic cone in the sensor's frame (forward +x, left +y, up +z, as the kit's mounts): the axis, then the cone's
 * edge to the left, to the right, up and down at `coneHalfDeg`. The very rays of core/world/sensors/ultrasonic.ts (there in Rapier's
 * frame, forward +X, up +Y, left −Z), as unit vectors.
 */
export function coneDirections(coneHalfDeg: number): readonly Vec3Cm[] {
  const [c, s] = [Math.cos(coneHalfDeg * RAD), Math.sin(coneHalfDeg * RAD)];
  return [
    [1, 0, 0],
    [c, s, 0],
    [c, -s, 0],
    [c, 0, s],
    [c, 0, -s],
  ];
}

/** A vector turned by the unit quaternion `q`. */
function rotated(q: Pose['rotation'], [x, y, z]: Vec3Cm): Vec3Cm {
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
}

export type UltrasonicEnds = {
  /** The sensor on the arena (cm, z up from the floor). */
  origin: Vec3Cm;
  /** Where the rays end, `lengthCm` from the sensor along each of `coneDirections`: the axis first, then left, right, up, down. */
  ends: readonly Vec3Cm[];
};

/**
 * Where the rays of an ultrasonic sensor at `mount` (the kit's: its place in the robot frame and its yaw) end on the arena, for a
 * robot at `robot` and a reading of `lengthCm`. The robot's whole rotation counts (tilt included), as in the world.
 */
export function ultrasonicEndsCm(robot: Pose, mount: { readonly posCm: RobotPointCm; readonly yawDeg: number }, coneHalfDeg: number, lengthCm: number): UltrasonicEnds {
  const [c, s] = [Math.cos(mount.yawDeg * RAD), Math.sin(mount.yawDeg * RAD)];
  const world = (point: Vec3Cm): Vec3Cm => {
    const [x, y, z] = rotated(robot.rotation, point);
    return [robot.xCm + x, robot.yCm + y, robot.zCm + z];
  };
  const [mx, my, mz] = mount.posCm;
  return {
    origin: world([mx, my, mz]),
    ends: coneDirections(coneHalfDeg).map(([x, y, z]) => world([mx + lengthCm * (x * c - y * s), my + lengthCm * (x * s + y * c), mz + lengthCm * z])),
  };
}

/** How many steps the cone's arc has on the 2D map. */
export const SECTOR_ARC_STEPS = 8;
/** The length `sectorPointsCm` needs: the sensor, then the arc's points. */
export const SECTOR_POINTS_LENGTH = 2 * (SECTOR_ARC_STEPS + 2);

/**
 * The cone seen from above, for the 2D map: writes into `out` (a number array of SECTOR_POINTS_LENGTH) the flat points of a fan from the
 * sensor at (`xCm`, `yCm`) looking along `headingDeg` (counter-clockwise from the arena's +x): the sensor, then an arc of radius
 * `lengthCm` from the cone's left edge to its right edge. Makes nothing.
 */
export function sectorPointsCm(out: number[], xCm: number, yCm: number, headingDeg: number, coneHalfDeg: number, lengthCm: number): void {
  out[0] = xCm;
  out[1] = yCm;
  for (let k = 0; k <= SECTOR_ARC_STEPS; k++) {
    const angle = (headingDeg + coneHalfDeg - (2 * coneHalfDeg * k) / SECTOR_ARC_STEPS) * RAD;
    out[2 + 2 * k] = xCm + lengthCm * Math.cos(angle);
    out[3 + 2 * k] = yCm + lengthCm * Math.sin(angle);
  }
}

/**
 * A spot is drawn at least this big, cm: the kit's spots are 3 mm in radius and would show nothing, and the three eyes are 1.5 cm apart, so
 * it is also no bigger than the rings can be without covering each other.
 */
export const MIN_SPOT_RADIUS_CM = 0.7;

/** The radius a line sensor's spot is drawn with: the kit's own, at least MIN_SPOT_RADIUS_CM. */
export const spotDrawRadiusCm = (kitRadiusCm: number | undefined): number => Math.max(MIN_SPOT_RADIUS_CM, kitRadiusCm ?? 1);

/** The glyphs of the distance label: the digits are 0 to 9, then these. The decimal sign is the learner's (a comma in Vietnamese). */
export const GLYPH = { separator: 10, space: 11, c: 12, m: 13 } as const;
export const GLYPH_COUNT = 14;
/** The most glyphs a label has: "400,0 cm" is 8. */
export const LABEL_GLYPHS_MAX = 12;

/**
 * Writes the distance label's glyphs into `out` and returns how many: an echo to a tenth of a cm ("23,4 cm"), no echo as the whole 400
 * the program reads ("400 cm"). A reading that is negative or not a number is 0. Allocates nothing, so a frame can call it.
 */
export function labelGlyphs(out: Int8Array, cm: number, echo: boolean): number {
  const reading = Number.isFinite(cm) && cm > 0 ? cm : 0;
  const tenths = Math.round(reading * 10);
  let whole = echo ? Math.floor(tenths / 10) : Math.round(reading);
  // The whole part's digits, written backwards from the end of the room it can take (5), then moved to the front.
  let n = 0;
  do {
    out[n++] = whole % 10;
    whole = Math.floor(whole / 10);
  } while (whole > 0);
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const digit = out[i]!;
    out[i] = out[j]!;
    out[j] = digit;
  }
  if (echo) {
    out[n++] = GLYPH.separator;
    out[n++] = tenths % 10;
  }
  out[n++] = GLYPH.space;
  out[n++] = GLYPH.c;
  out[n++] = GLYPH.m;
  return n;
}

/** The pulse of the next goal's zone takes this long for a swing, s. */
export const PULSE_PERIOD_S = 1.6;

/**
 * The pulse's level, 0 to 1: it swings over PULSE_PERIOD_S while a run goes on, and rests at the middle with no run and with reduced
 * motion (a still, soft highlight, no movement).
 */
export function pulseLevel(running: boolean, reducedMotion: boolean, seconds: number): number {
  return running && !reducedMotion ? 0.5 + 0.5 * Math.sin((2 * Math.PI * seconds) / PULSE_PERIOD_S) : 0.5;
}

/**
 * The zone the next unmet goal needs: the first goal, in the scenario's order, that has not passed and names a zone. A route of
 * checkpoints needs the one after those counted (its `progress` is the counted share of the list); a servo goal the zone it waits in.
 * Null when every goal that names a zone has passed, or the scenario names none. `results` is the snapshot's score (none before the
 * first tick: every goal is unmet then).
 */
export function nextGoalZoneId(goals: Scenario['goals'], results: ScoreState['goals']): string | null {
  for (let g = 0; g < goals.length; g++) {
    const goal = goals[g]!;
    let result: ScoreState['goals'][number] | undefined;
    for (let r = 0; r < results.length; r++) {
      if (results[r]!.id === goal.id) {
        result = results[r];
        break;
      }
    }
    if (result?.passed === true) continue;
    switch (goal.kind) {
      case 'reach-zone':
      case 'object-in-zone':
      case 'stop-in-zone':
        return goal.zone;
      case 'checkpoints-in-order': {
        const counted = Math.floor((result?.progress ?? 0) * goal.zones.length + 1e-9);
        return goal.zones[Math.min(goal.zones.length - 1, Math.max(0, counted))] ?? null;
      }
      case 'servo-angle':
        if (goal.whenInZone !== undefined) return goal.whenInZone;
        break;
      default:
        break;
    }
  }
  return null;
}

/** An ultrasonic reading changes the picture from this much (cm): below it the ray is as long to the eye, even close up. */
const SAME_RAY_CM = 0.05;

/**
 * Whether two worlds draw the same overlays, apart from where the robot is (the view's own picture, `sameView`, sees that): each
 * ultrasonic reading to 0.05 cm and to the tenth the label writes, and its echo, what a line sensor sees (the colour, and whether it is
 * lifted), the zone the next goal needs and the run's status (the pulse runs while it is `running`). A robot at rest changes none of
 * these, so the overlays ask for no frame.
 */
export function sameSensorView(a: RobotSnapshot | null, b: RobotSnapshot | null, goals: Scenario['goals']): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.status !== b.status || a.sensors.length !== b.sensors.length) return false;
  if (nextGoalZoneId(goals, a.score.goals) !== nextGoalZoneId(goals, b.score.goals)) return false;
  for (let i = 0; i < a.sensors.length; i++) {
    const [sa, sb] = [a.sensors[i]!, b.sensors[i]!];
    if (sa.kind === 'ultrasonic') {
      if (sb.kind !== 'ultrasonic' || sa.hitId !== sb.hitId || !(Math.abs(sa.cm - sb.cm) < SAME_RAY_CM) || Math.round(sa.cm * 10) !== Math.round(sb.cm * 10)) return false;
    } else if (sb.kind !== 'line-sensor' || sa.dark !== sb.dark || (sa.spotCm === null) !== (sb.spotCm === null)) {
      return false;
    }
  }
  return true;
}
