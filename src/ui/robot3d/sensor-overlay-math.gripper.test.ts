import { describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { RobotSnapshot, SensorReadout } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { idleSnapshot } from './scene-math';
import { sameSensorView, shownColor } from './sensor-overlay-math';

// N19 E5 (review B3/B4 M1): the overlays of a gripper car ask for a frame only when what they draw changes, as the rover's do. The IR
// sensor's beam is drawn from whether it sees something and what its ray met; the colour sensor's spot from what its ray met, how far, and
// the class of its last window's counts (the colour `color.is` answers, which tints the spot and names it on the tag).

const kit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-sandbox')!;
const idle = idleSnapshot(scenario, kit);
const goals = scenario.goals;

const ir = (detected: boolean, hitId: string | null): SensorReadout => ({ role: 'irClaw', kind: 'ir-obstacle', detected, hitId });
type ColorReadout = Extract<SensorReadout, { kind: 'color-sensor' }>;
const color = (hitId: string | null, distanceCm: number | null, rgbc?: { r: number; g: number; b: number; c: number }): ColorReadout => ({
  role: 'color1',
  kind: 'color-sensor',
  hitId,
  distanceCm,
  ...(rgbc === undefined ? {} : { rgbc }),
});
/** Counts (16 bits, as the TCS34725's) of a red cube near the sensor, a little more light of the same red (the same class), and a blue one. */
const red = { r: 14_000, g: 3000, b: 2800, c: 19_800 };
const redBrighter = { r: 14_100, g: 3010, b: 2810, c: 19_920 };
const blue = { r: 3000, g: 5000, b: 13_000, c: 21_000 };
const world = (sensors: SensorReadout[], changes: Partial<RobotSnapshot> = {}): RobotSnapshot => ({ ...idle, status: 'running', sensors, ...changes });

describe('when a gripper car’s overlays changed (N19 E5)', () => {
  it('is the same picture for the same readings, a new time and new counts of the same colour: a car at rest asks for no frame', () => {
    const a = world([ir(true, 'cube'), color('cube', 1.4, red)], { t: 4 });
    expect(sameSensorView(a, { ...a, t: 4.1 }, goals)).toBe(true);
    expect(sameSensorView(a, world([ir(true, 'cube'), color('cube', 1.4, redBrighter)], { t: 4.2 }), goals)).toBe(true);
    expect(sameSensorView(a, world([ir(true, 'cube'), color('cube', 1.449, red)]), goals)).toBe(true);
  });

  it('changes when the IR sees or stops seeing, or its ray meets another body', () => {
    const a = world([ir(false, null), color(null, null)]);
    expect(sameSensorView(a, world([ir(true, 'cube'), color(null, null)]), goals)).toBe(false);
    // A black cube: met, not seen.
    expect(sameSensorView(a, world([ir(false, 'cube'), color(null, null)]), goals)).toBe(false);
    expect(sameSensorView(world([ir(true, 'cube'), color(null, null)]), world([ir(true, 'base'), color(null, null)]), goals)).toBe(false);
  });

  it('changes when the colour sensor’s ray meets something else or moves 0.05 cm or more, or its counts read another colour, or the first window ends', () => {
    const a = world([ir(true, 'cube'), color('cube', 1.4, red)]);
    expect(sameSensorView(a, world([ir(true, 'cube'), color('cube', 1.46, red)]), goals)).toBe(false);
    expect(sameSensorView(a, world([ir(true, 'cube'), color('#gripper', 1.4, red)]), goals)).toBe(false);
    expect(sameSensorView(a, world([ir(true, 'cube'), color(null, null, red)]), goals)).toBe(false);
    expect(sameSensorView(a, world([ir(true, 'cube'), color('cube', 1.4, blue)]), goals)).toBe(false);
    expect(sameSensorView(world([ir(true, 'cube'), color('cube', 1.4)]), a, goals)).toBe(false);
  });

  it('is a change when the kinds at a place differ (a kit is never swapped under a view, but the comparison holds)', () => {
    expect(sameSensorView(world([ir(true, 'cube')]), world([color('cube', 1.4, red)]), goals)).toBe(false);
    expect(sameSensorView(world([color('cube', 1.4, red)]), world([ir(true, 'cube')]), goals)).toBe(false);
  });
});

describe('the colour a reading is drawn as (N19 E5)', () => {
  it('is the class `color.is` answers from the counts (COLOR_RULES), and none before the sensor’s first window', () => {
    expect(shownColor(color('cube', 1.4, red))).toBe('red');
    expect(shownColor(color('cube', 1.4, blue))).toBe('blue');
    expect(shownColor(color('cube', 1.4, { r: 100, g: 100, b: 50, c: 250 }))).toBe('unknown');
    expect(shownColor(color(null, null))).toBeNull();
  });
});
