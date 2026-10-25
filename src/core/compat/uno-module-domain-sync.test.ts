import { describe, expect, it } from 'vitest';
import { buzzerTone, compileRobot, digitalRead, kitWithout, motorSet, pwmWrite, servoSet } from '../program/__fixtures__/uno-blocks';
import { robot } from '../program/__fixtures__/uno-run';
import { add, getVar, num, print, setVar, type Json } from '../program/__fixtures__/ybc-blocks';
import type { Expr, YbcStatement } from '../program/ybc-ir';
import { unoContract } from './uno-contract';

// N18 R2.2: the clamped arguments of the module rows (contract UNO §0.5, U-20, U-23, U-25, U-32) at their boundaries. A value inside
// the contract's range is used as it is; one outside is clamped to the contract's bound and warned with the contract's code: by the
// compiler for a typed-in value (written clamped into the IR), by the run for a computed one (once per role per run). The bounds
// are the contract's constants (test-only data), never the production constants under test.

const constants = unoContract.constants;
const clampCode = unoContract.diagnostics.find((diagnostic) => diagnostic.id === 'value-clamped');

type Case = {
  name: string;
  low: number;
  high: number;
  /** The block with the value; `slot` 0 or 1 is the argument of the IR call that holds it. */
  block(value: Json): Json;
  slot: number;
  /** What the pins show of the value the board was given. */
  shown(pin: (id: string) => { duty: number; servoDeg: number | null; toneHz: number | null }): number | null;
  kit?: ReturnType<typeof kitWithout>;
};

const cases: Case[] = [
  // The motor's duty is round(|s| × 255 / 100): show the speed as the duty it gives (EMU-02).
  { name: 'motor speed (U-20)', low: -constants.MOTOR_SPEED_MAX, high: constants.MOTOR_SPEED_MAX, block: (value) => motorSet('motorLeft', value, 'b'), slot: 0, shown: (pin) => pin('D5').duty },
  { name: 'servo angle (U-23)', low: 0, high: constants.SERVO_ANGLE_MAX, block: (value) => servoSet('servo1', value, 'b'), slot: 0, shown: (pin) => pin('D9').servoDeg },
  { name: 'tone Hz (U-25)', low: constants.TONE_MIN_HZ, high: constants.TONE_MAX_HZ, block: (value) => buzzerTone(value, num(1000), 'b'), slot: 0, shown: (pin) => pin('D10').toneHz },
  { name: 'tone ms (U-25)', low: constants.TONE_MIN_MS, high: constants.TONE_MAX_MS, block: (value) => buzzerTone(num(440), value, 'b'), slot: 1, shown: () => null },
  { name: 'PWM value (U-32)', low: 0, high: constants.PWM_MAX, block: (value) => pwmWrite('D10', value, 'b'), slot: 0, shown: (pin) => pin('D10').duty, kit: kitWithout('buzzer') },
];

const duty = (speed: number) => Math.round((Math.abs(speed) * 255) / 100);

describe.each(cases)('$name', ({ low, high, block, slot, shown, kit, name }) => {
  const values = [low - 1, low, high, high + 1];
  const clampedOf = (value: number) => Math.min(high, Math.max(low, value));
  const options = kit ? { kit } : {};

  it.each(values)('a typed-in %d is written as the contract’s clamp of it, warned only outside the range', (value) => {
    const compiled = compileRobot([block(num(value))], undefined, options);
    if (!compiled.ok) {
      throw new Error(JSON.stringify(compiled.diagnostics));
    }
    const call = compiled.ir.onStart[0] as YbcStatement & { args: Expr[] };
    expect(call.args[slot]).toMatchObject({ kind: 'int', value: clampedOf(value) });
    const outside = value < low || value > high;
    expect(compiled.diagnostics.map((diagnostic) => [diagnostic.severity, diagnostic.code])).toEqual(outside ? [[clampCode?.severity, clampCode?.id]] : []);
  });

  it.each(values)('a computed %d runs as the contract’s clamp of it, warned only outside the range', async (value) => {
    const { run, pin } = robot([setVar('x', add(num(value), num(0))), block(getVar('x'))], undefined, options);
    expect(await run.runUntilDone(50)).not.toBeNull();
    expect(run.outcome()).toEqual({ status: 'finished' });
    const outside = value < low || value > high;
    expect(run.warnings.map((warning) => [warning.code, warning.blockId])).toEqual(outside ? [[clampCode?.id, 'b']] : []);
    const expected = name.startsWith('motor') ? duty(clampedOf(value)) : name.startsWith('tone ms') ? null : clampedOf(value);
    expect(shown(pin)).toBe(expected);
  });
});

describe('U-33 digital read (raw pin): setup() gives a module-wired pin its driver’s pinMode (contract 0.1.2, fix round 1)', () => {
  const u33 = unoContract.constructs.find((row) => row.id === 'U-33');

  it('is the contract’s setup line, with the mode of the module’s driver', async () => {
    expect(unoContract.version).toBe('0.1.7');
    expect(u33?.cpp?.setup).toEqual(['pinMode(<pin>, <mode>);']);
    expect(u33?.fields.default.label).toBe('VERIFIED');
    // The button's driver (button-pullup) sets INPUT_PULLUP, as U-30's setup line says; the run does the same for a raw read alone.
    const u30 = unoContract.constructs.find((row) => row.id === 'U-30');
    expect(u30?.cpp?.setup).toEqual(['pinMode(<ROLE>_PIN, INPUT_PULLUP);']);
    const { run, pin } = robot([print(digitalRead('D3'))]);
    expect(pin('D3').mode).toBe('INPUT_PULLUP');
    expect(await run.runUntilDone(5)).not.toBeNull();
  });
});
