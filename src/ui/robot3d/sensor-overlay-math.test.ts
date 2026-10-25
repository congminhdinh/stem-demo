import { describe, expect, it } from 'vitest';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import type { Pose, RobotSnapshot, SensorReadout } from '../../core/world/snapshot';
import { idleSnapshot } from './scene-math';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { GLYPH, highlightColor, labelGlyphs, LABEL_GLYPHS_MAX, nextGoalZoneId, pulseLevel, PULSE_PERIOD_S, sameSensorView, spotDrawRadiusCm, SECTOR_ARC_STEPS, SECTOR_POINTS_LENGTH, sectorPointsCm } from './sensor-overlay-math';
import { ultrasonicEndsCm } from './__fixtures__/ray-oracle';

// N18 R4.3: the arithmetic of the sensor overlays, in plain numbers and tested exactly: the glyphs of the distance label (the learner's
// decimal comma), which zone the next unmet goal needs and the colour of its highlight, when the overlay's picture changed, the pulse, and
// the cone on the 2D map (held against the 3D oracle's edges).

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const stopAtWall = scenarioCatalog.get('rb-stop-at-wall')!;
const checkpoints = scenarioCatalog.get('rb-square-route')!;

const pose = (xCm: number, yCm: number, yawDeg: number): Pose => {
  const half = (yawDeg * Math.PI) / 360;
  return { xCm, yCm, zCm: 0, yawDeg, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
};
const mount = { posCm: [7.5, 0, 4] as const, yawDeg: 0 };
const close = (actual: readonly number[], expected: readonly number[], digits = 9) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
};

describe('the line sensors’ spots', () => {
  it('are drawn as big as the kit’s spot, and at least 0.7 cm so that a spot of 3 mm shows', () => {
    expect(spotDrawRadiusCm(0.3)).toBe(0.7);
    expect(spotDrawRadiusCm(2.5)).toBe(2.5);
    expect(spotDrawRadiusCm(undefined)).toBe(1);
  });
});

describe('the cone on the 2D map', () => {
  it('is a fan from the sensor over an arc from the left edge to the right edge, every arc point the reading from the sensor', () => {
    const out = new Array<number>(SECTOR_POINTS_LENGTH).fill(0);
    sectorPointsCm(out, 10, 20, 90, 15, 40);
    close(out.slice(0, 2), [10, 20]);
    // Facing +y, the left edge is towards −x: 15° left of the heading.
    close(out.slice(2, 4), [10 + 40 * Math.cos((105 * Math.PI) / 180), 20 + 40 * Math.sin((105 * Math.PI) / 180)]);
    // The middle of the arc is the axis end.
    close(out.slice(2 + SECTOR_ARC_STEPS, 4 + SECTOR_ARC_STEPS), [10, 60]);
    close(out.slice(SECTOR_POINTS_LENGTH - 2), [10 + 40 * Math.cos((75 * Math.PI) / 180), 20 + 40 * Math.sin((75 * Math.PI) / 180)]);
    for (let k = 1; k < SECTOR_POINTS_LENGTH / 2; k++) expect(Math.hypot(out[2 * k]! - 10, out[2 * k + 1]! - 20)).toBeCloseTo(40, 9);
  });

  it('agrees with the 3D cone’s edges seen from above', () => {
    const half = 15;
    const out = new Array<number>(SECTOR_POINTS_LENGTH).fill(0);
    const robot = pose(50, 40, 20);
    const { origin, ends } = ultrasonicEndsCm(robot, mount, half, 80);
    sectorPointsCm(out, origin[0], origin[1], 20 + mount.yawDeg, half, 80);
    // The left and the right edge of the cone, from above (the edge rays lie in the floor plane).
    close(out.slice(2, 4), [ends[1]![0], ends[1]![1]]);
    close(out.slice(SECTOR_POINTS_LENGTH - 2), [ends[2]![0], ends[2]![1]]);
  });
});

describe('the distance label', () => {
  const glyphsOf = (cm: number) => {
    const out = new Int8Array(LABEL_GLYPHS_MAX);
    const n = labelGlyphs(out, cm);
    return Array.from(out.subarray(0, n));
  };
  const { separator } = GLYPH;

  it('writes the distance to a tenth of a cm: 23,4', () => {
    expect(glyphsOf(23.4)).toEqual([2, 3, separator, 4]);
  });

  it('rounds to the nearest tenth, and carries into the whole part', () => {
    expect(glyphsOf(23.449)).toEqual([2, 3, separator, 4]);
    expect(glyphsOf(23.451)).toEqual([2, 3, separator, 5]);
    expect(glyphsOf(9.96)).toEqual([1, 0, separator, 0]);
  });

  it('writes a whole part of one digit, and 0 for a reading of nothing', () => {
    expect(glyphsOf(7)).toEqual([7, separator, 0]);
    expect(glyphsOf(0)).toEqual([0, separator, 0]);
  });

  it('fits the room of a reading as long as the sensor’s range: 400,0', () => {
    expect(glyphsOf(400)).toEqual([4, 0, 0, separator, 0]);
  });

  it('never writes a negative or non-finite reading as anything but 0', () => {
    expect(glyphsOf(-3)).toEqual([0, separator, 0]);
    expect(glyphsOf(Number.NaN)).toEqual([0, separator, 0]);
  });
});

describe('the colour of a zone’s highlight', () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
    const delta = max - min;
    if (delta === 0) return 0;
    const h = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return h * 60;
  };
  const lightness = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  };

  it('keeps the zone’s own hue: the pilots’ light green target stays green, the light yellow checkpoint stays yellow', () => {
    for (const zone of ['#d9ead3', '#fff2cc', '#cfe2f3']) {
      expect(Math.abs(hue(highlightColor(zone)) - hue(zone))).toBeLessThan(2);
    }
  });

  it('is much darker than the pastel paint and strongly coloured (lightness 0.38, saturation at least 0.65)', () => {
    const green = highlightColor('#d9ead3');
    expect(lightness(green)).toBeCloseTo(0.38, 2);
    expect(lightness(green)).toBeLessThan(lightness('#d9ead3') - 0.3);
    expect(green).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(green.slice(i, i + 2), 16));
    expect(g!).toBeGreaterThan(r! * 1.6);
    expect(g!).toBeGreaterThan(b! * 1.6);
  });

  it('is a plain dark grey for a zone with no colour of its own', () => {
    const grey = highlightColor('#cccccc');
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(grey.slice(3, 5)).toBe(grey.slice(5, 7));
  });
});

describe('the zone the next unmet goal needs', () => {
  const result = (id: string, passed: boolean, progress = passed ? 1 : 0) => ({ id, passed, points: passed ? 10 : 0, progress });

  it('is the first unmet goal that has a zone: stop-at-wall’s stop-in-zone, whose avoid-contact goal needs none', () => {
    expect(nextGoalZoneId(stopAtWall.goals, [])).toBe('stop-zone');
    expect(nextGoalZoneId(stopAtWall.goals, [result('stop-near-wall', false, 0.3), result('no-crash', false)])).toBe('stop-zone');
  });

  it('is none once every goal with a zone has passed', () => {
    expect(nextGoalZoneId(stopAtWall.goals, [result('stop-near-wall', true), result('no-crash', false)])).toBeNull();
  });

  it('takes the checkpoints in their order: the share of the route counted says which is next', () => {
    const route = checkpoints.goals.find((goal) => goal.id === 'full-square')!;
    if (route.kind !== 'checkpoints-in-order') throw new Error('rb-square-route has a full-square route');
    const zones = route.zones;
    expect(zones).toEqual(['cp-1', 'cp-2', 'cp-3', 'cp-4']);
    const at = (counted: number) => nextGoalZoneId([route], [result(route.id, false, counted / zones.length)]);
    expect(at(0)).toBe('cp-1');
    expect(at(1)).toBe('cp-2');
    expect(at(2)).toBe('cp-3');
    expect(at(3)).toBe('cp-4');
  });

  it('goes on to the next goal when a route is done: half-square first, then full-square', () => {
    const half = result('half-square', false, 0.5);
    expect(nextGoalZoneId(checkpoints.goals, [half, result('full-square', false, 0.25)])).toBe('cp-2');
    expect(nextGoalZoneId(checkpoints.goals, [result('half-square', true), result('full-square', false, 0.5)])).toBe('cp-3');
    expect(nextGoalZoneId(checkpoints.goals, [result('half-square', true), result('full-square', true)])).toBeNull();
  });

  it('asks for the zone a servo goal waits in', () => {
    const servo = scenarioCatalog.get('rb-servo-gate')!;
    const goal = servo.goals.find((candidate) => candidate.kind === 'servo-angle')!;
    if (goal.kind !== 'servo-angle') throw new Error('rb-servo-gate has a servo goal');
    const others = servo.goals.filter((candidate) => candidate.id !== goal.id).map((candidate) => result(candidate.id, true));
    expect(nextGoalZoneId(servo.goals, others)).toBe(goal.whenInZone ?? null);
  });

  it('is none for goals that name no zone', () => {
    expect(nextGoalZoneId([{ id: 'time', kind: 'finish-within', label: { vi: 'a', en: 'a' }, points: 5, seconds: 10 }], [])).toBeNull();
  });
});

describe('when the overlay’s picture changed', () => {
  const idle = idleSnapshot(stopAtWall, kit);
  const ultrasonic = (cm: number, hitId: string | null): SensorReadout => ({ role: 'ultrasonic', kind: 'ultrasonic', cm, hitId });
  const line = (dark: boolean, spotCm: readonly [number, number] | null): SensorReadout => ({ role: 'lineLeft', kind: 'line-sensor', reflectance: dark ? 0 : 1, dark, spotCm });
  const world = (changes: Partial<RobotSnapshot>): RobotSnapshot => ({ ...idle, status: 'running', ...changes });
  const goals = stopAtWall.goals;

  it('is the same picture for the same snapshot, and for one that changes only the time', () => {
    const a = world({ sensors: [ultrasonic(50, 'front-wall')], t: 1 });
    expect(sameSensorView(a, a, goals)).toBe(true);
    expect(sameSensorView(a, { ...a, t: 2 }, goals)).toBe(true);
  });

  it('changes with a reading of 0.05 cm or more, with a different tenth, or with another echo', () => {
    const a = world({ sensors: [ultrasonic(50, 'front-wall')] });
    expect(sameSensorView(a, world({ sensors: [ultrasonic(50.04, 'front-wall')] }), goals)).toBe(true);
    expect(sameSensorView(a, world({ sensors: [ultrasonic(50.05, 'front-wall')] }), goals)).toBe(false);
    expect(sameSensorView(world({ sensors: [ultrasonic(23.44, 'front-wall')] }), world({ sensors: [ultrasonic(23.46, 'front-wall')] }), goals)).toBe(false);
    expect(sameSensorView(a, world({ sensors: [ultrasonic(50, null)] }), goals)).toBe(false);
  });

  it('changes when a line sensor sees the other colour, or lifts off or lands', () => {
    const a = world({ sensors: [line(false, [10, 20])] });
    expect(sameSensorView(a, world({ sensors: [line(true, [10, 20])] }), goals)).toBe(false);
    expect(sameSensorView(a, world({ sensors: [line(false, null)] }), goals)).toBe(false);
    expect(sameSensorView(a, world({ sensors: [line(false, [10.5, 20])] }), goals)).toBe(true);
  });

  it('changes when the run starts or ends (the pulse), and when the next goal zone changes', () => {
    expect(sameSensorView(idle, world({}), goals)).toBe(false);
    expect(sameSensorView(world({}), world({ status: 'finished' }), goals)).toBe(false);
    const done = world({ score: { points: 70, maxScore: 100, goals: [{ id: 'stop-near-wall', passed: true, points: 70, progress: 1 }] } });
    expect(sameSensorView(world({}), done, goals)).toBe(false);
  });

  it('treats a missing snapshot as a change from one and the same as itself', () => {
    expect(sameSensorView(null, null, goals)).toBe(true);
    expect(sameSensorView(null, idle, goals)).toBe(false);
  });
});

describe('the pulse', () => {
  it('rests at the middle with no run, and with reduced motion', () => {
    expect(pulseLevel(false, false, 0.4)).toBe(0.5);
    expect(pulseLevel(true, true, 0.4)).toBe(0.5);
  });

  it('swings between 0 and 1 over its period while a run goes on', () => {
    expect(pulseLevel(true, false, 0)).toBeCloseTo(0.5, 12);
    expect(pulseLevel(true, false, PULSE_PERIOD_S / 4)).toBeCloseTo(1, 12);
    expect(pulseLevel(true, false, (3 * PULSE_PERIOD_S) / 4)).toBeCloseTo(0, 12);
    expect(pulseLevel(true, false, PULSE_PERIOD_S)).toBeCloseTo(0.5, 12);
  });
});
