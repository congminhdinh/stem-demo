import { classifyColor, COLOR_NAMES, type ColorName } from '../../core/hardware/drivers';
import type { Scenario } from '../../core/scenario/scenario';
import type { RobotSnapshot, ScoreState, SensorReadout } from '../../core/world/snapshot';

// The arithmetic of the sensor overlays (N18 R4.3), in the 3D view (parts/sensor-overlay.ts) and on the 2D map (TopViewSensors.tsx): what
// the robot "sees" drawn over the arena so that a learner can read it. Plain numbers, tested exactly; nothing here imports three or Konva.
//
// The overlays draw the snapshot and never work a reading out again (the sensors are measured once per tick, in the world). What the
// snapshot holds of an ultrasonic sensor is the distance it heard (`cm`, the shortest of its five rays') and what that came from
// (`hitId`), not its five rays one by one, so the axis ray is drawn to the heard distance and the cone as an outline of the same slant
// length from the sensor: where the sensor listens, not five measured hits, and the dot at the end of the axis is the heard distance
// on the axis, not the point the echo came from (an edge ray may have heard it). With no echo the ray is NO_ECHO_RAY_CM long.

const RAD = Math.PI / 180;

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

/** The glyphs of the distance label's number: the digits are 0 to 9, then the decimal sign (the learner's: a comma in Vietnamese). */
export const GLYPH = { separator: 10 } as const;
export const GLYPH_COUNT = 11;
/** The most glyphs a number has: "400,0" is 5. */
export const LABEL_GLYPHS_MAX = 8;

/**
 * Writes the glyphs of the distance heard into `out` and returns how many: to a tenth of a cm ("23,4"). A reading that is negative or not
 * a number is 0. The unit is the label's own, from the messages. Allocates nothing, so a frame can call it.
 */
export function labelGlyphs(out: Int8Array, cm: number): number {
  const tenths = Math.round((Number.isFinite(cm) && cm > 0 ? cm : 0) * 10);
  let whole = Math.floor(tenths / 10);
  // The whole part's digits, written backwards and then turned round.
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
  out[n++] = GLYPH.separator;
  out[n++] = tenths % 10;
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
 * N19 E5: the colour a colour sensor's reading is drawn as (the tint of its spot, the word on its tag): the class of its last window's
 * counts by COLOR_RULES, the very colour `color.is` answers now; null before the sensor's first window (the snapshot has no counts yet).
 */
export function shownColor(readout: Pick<Extract<SensorReadout, { kind: 'color-sensor' }>, 'rgbc'>): ColorName | null {
  return readout.rgbc === undefined ? null : COLOR_NAMES[classifyColor(readout.rgbc)]!;
}

/** Two distances of a ray (cm, or null for none) draw the same: both none, or both within SAME_RAY_CM. */
const sameReach = (a: number | null, b: number | null): boolean => (a === null || b === null ? a === b : Math.abs(a - b) < SAME_RAY_CM);

/** Whether two readouts of one sensor draw the same overlay. */
function sameReadout(sa: SensorReadout, sb: SensorReadout): boolean {
  switch (sa.kind) {
    case 'ultrasonic':
      return sb.kind === 'ultrasonic' && sa.hitId === sb.hitId && Math.abs(sa.cm - sb.cm) < SAME_RAY_CM && Math.round(sa.cm * 10) === Math.round(sb.cm * 10);
    case 'line-sensor':
      return sb.kind === 'line-sensor' && sa.dark === sb.dark && (sa.spotCm === null) === (sb.spotCm === null);
    case 'ir-obstacle':
      return sb.kind === 'ir-obstacle' && sa.detected === sb.detected && sa.hitId === sb.hitId;
    case 'color-sensor':
      return sb.kind === 'color-sensor' && sa.hitId === sb.hitId && sameReach(sa.distanceCm, sb.distanceCm) && (sa.rgbc === undefined) === (sb.rgbc === undefined) && shownColor(sa) === shownColor(sb);
  }
}

/**
 * Whether two worlds draw the same overlays, apart from where the robot is (the view's own picture, `sameView`, sees that): each
 * ultrasonic reading to 0.05 cm and to the tenth the label writes, and its echo, what a line sensor sees (the colour, and whether it is
 * lifted), N19 E5: whether the IR sees and what its ray meets, what the colour sensor's ray meets, how far (to 0.05 cm) and the colour its
 * counts read; the zone the next goal needs and the run's status (the pulse runs while it is `running`). A robot at rest changes none of
 * these, so the overlays ask for no frame.
 */
export function sameSensorView(a: RobotSnapshot | null, b: RobotSnapshot | null, goals: Scenario['goals']): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.status !== b.status || a.sensors.length !== b.sensors.length) return false;
  if (nextGoalZoneId(goals, a.score.goals) !== nextGoalZoneId(goals, b.score.goals)) return false;
  for (let i = 0; i < a.sensors.length; i++) {
    if (!sameReadout(a.sensors[i]!, b.sensors[i]!)) return false;
  }
  return true;
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n * 255))).toString(16).padStart(2, '0');

/**
 * The colour of a zone's highlight: the zone's own hue, strong (saturation at least 0.65) and darkish (lightness 0.38). A highlight of
 * the same family never goes muddy over the zone's pastel paint, whatever the zone's colour is (an amber one over a light green zone did).
 */
export function highlightColor(zoneHex: string): string {
  const value = Number.parseInt(zoneHex.slice(1, 7), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255) as [number, number, number];
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / delta + 2) / 6;
    else hue = ((r - g) / delta + 4) / 6;
  }
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const [h, s, l] = [hue, delta === 0 ? 0 : Math.max(0.65, saturation), 0.38];
  // HSL to RGB.
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return `#${hex2(channel(h + 1 / 3))}${hex2(channel(h))}${hex2(channel(h - 1 / 3))}`;
}
