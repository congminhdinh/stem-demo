import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import { countUp, getVar, mul, num, print, program, text, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWriteAnalog, servoWrite } from '../program/__fixtures__/ybc-pin-blocks';
import { createRunSession, type RunSession, type RunSnapshot } from './run-session';
import { createPinCapabilities } from './ybc-pin-io';

// N17 B5 through the production RunSession: "analog write" dims an LED fed from the pin through a resistor, and a servo on P0–P2
// turns. Real compiler, interpreter and simulation; only the clock is fake. Review Focus 1: Stop ends it all at once, and the next
// run starts clean, the servo at 90° and the LED off.

const registry = createDeviceRegistry(localDeviceDefinitions);
const at = { x: 0, y: 0 };
const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: at };
const part = (id: string, deviceType: string) => ({ id, deviceType, position: at });
const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});

/** An LED on P0 through a resistor, and a servo whose signal is on P1, powered from 3V3 and GND. */
const ledAndServo = {
  components: [board, part('resistor-1', 'resistor'), part('led-1', 'led'), part('servo-1', 'servo')],
  wires: [
    wire('w1', ['ybc-board-1', 'p0'], ['resistor-1', 'a']),
    wire('w2', ['resistor-1', 'b'], ['led-1', 'anode']),
    wire('w3', ['led-1', 'cathode'], ['ybc-board-1', 'gnd']),
    wire('s1', ['servo-1', 'signal'], ['ybc-board-1', 'p1']),
    wire('s2', ['servo-1', 'vcc'], ['ybc-board-1', '3v3']),
    wire('s3', ['servo-1', 'gnd'], ['ybc-board-1', 'gnd']),
  ],
};

function document(blocks: Json, profile = 'ybc-advanced'): ProjectDocument {
  return { ...fixtureDocument(profile, { blocks }), circuit: ledAndServo } as ProjectDocument;
}

const newSession = () =>
  createRunSession(registry, {
    capabilities: (environment) => ({ ...createOnboardCapabilities(environment), ...createPinCapabilities(registry)(environment) }),
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const led = (session: RunSession) => session.getSnapshot().simulation?.components['led-1'];
const servo = (session: RunSession) => session.getSnapshot().simulation?.components['servo-1'];
const warnings = (session: RunSession) => session.getSnapshot().diagnostics.filter((diagnostic) => diagnostic.code === 'value-clamped');

describe('analog write dims the LED (C-26)', () => {
  it('lights the LED at duty / 1023, puts it out at 0, and keeps the last duty after the program ends', async () => {
    const session = newSession();
    session.start(document(program([pinWriteAnalog('P0', num(512)), wait(num(100)), pinWriteAnalog('P0', num(0)), wait(num(100)), pinWriteAnalog('P0', num(1023))])));
    expect(led(session)).toEqual({ lit: false });
    await settle();
    expect(led(session)).toEqual({ lit: true, brightness: 512 / 1023 });
    await tick(100);
    expect(led(session)).toEqual({ lit: false });
    await tick(100);
    expect(session.getSnapshot().status).toBe('finished');
    expect(led(session)).toEqual({ lit: true, brightness: 1 });
    session.stop();
  });

  it('fades: a count up writes a brighter duty every step', async () => {
    const session = newSession();
    session.start(document(program([countUp('x', num(0), num(3), 1, [pinWriteAnalog('P0', mul(getVar('x'), num(341))), wait(num(50))])])));
    const seen: number[] = [];
    for (let step = 0; step < 4; step += 1) {
      await settle();
      seen.push(led(session)?.brightness ?? 0);
      await tick(50);
    }
    // Step 0 writes a duty of 0: the LED is off and has no brightness.
    expect(seen).toEqual([0, 341 / 1023, 682 / 1023, 1]);
    session.stop();
  });
});

describe('the servo turns (C-27)', () => {
  it('stands at 90° when the run starts and turns to the angle the program writes', async () => {
    const session = newSession();
    session.start(document(program([servoWrite('P1', num(30)), wait(num(100)), servoWrite('P1', num(150))])));
    expect(servo(session)).toEqual({ angle: 90 });
    await settle();
    expect(servo(session)).toEqual({ angle: 30 });
    await tick(100);
    expect(servo(session)).toEqual({ angle: 150 });
    session.stop();
  });

  it('Stop ends it at once and the next run starts clean: the servo at 90°, the LED off (Review Focus 1)', async () => {
    const session = newSession();
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    const sweep = [servoWrite('P1', num(0)), pinWriteAnalog('P0', num(800)), wait(num(200)), servoWrite('P1', num(180)), wait(num(200))];
    session.start(document(program([], sweep)));
    await settle();
    expect(servo(session)).toEqual({ angle: 0 });
    expect(led(session)).toEqual({ lit: true, brightness: 800 / 1023 });
    session.stop();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    const afterStop = published.length;
    await tick(1000);
    expect(published.length).toBe(afterStop);

    session.start(document(program([print(text('again'))])));
    expect(servo(session)).toEqual({ angle: 90 });
    expect(led(session)).toEqual({ lit: false });
    session.stop();
  });

  it('a run that replaces another also starts with the servo at 90° and the LED off', async () => {
    const session = newSession();
    session.start(document(program([servoWrite('P1', num(10)), pinWriteAnalog('P0', num(1023))])));
    await settle();
    expect(servo(session)).toEqual({ angle: 10 });
    session.start(document(program([])));
    expect(servo(session)).toEqual({ angle: 90 });
    expect(led(session)).toEqual({ lit: false });
    session.stop();
  });
});

describe('a value outside its range', () => {
  it('is clamped, and the run says so once per pin and kind, as a warning; the program goes on', async () => {
    const session = newSession();
    session.start(document(program([], [pinWriteAnalog('P0', num(2000)), servoWrite('P1', num(-40)), print(text('on')), wait(num(50))])));
    await settle();
    expect(led(session)).toEqual({ lit: true, brightness: 1 });
    expect(servo(session)).toEqual({ angle: 0 });
    await tick(200);
    expect(session.getSnapshot().status).toBe('running');
    expect(warnings(session)).toEqual([
      { severity: 'warning', code: 'value-clamped', message: 'The analog value 2000 for P0 is outside 0 to 1023, so it is clamped to 1023.' },
      { severity: 'warning', code: 'value-clamped', message: 'The servo angle -40 for P1 is outside 0 to 180, so it is clamped to 0.' },
    ]);
    expect(session.getSnapshot().console?.lines.length).toBeGreaterThan(1);
    session.stop();

    // A new run is warned again.
    session.start(document(program([pinWriteAnalog('P0', num(5000))])));
    await settle();
    expect(warnings(session).map((warning) => warning.message)).toEqual(['The analog value 5000 for P0 is outside 0 to 1023, so it is clamped to 1023.']);
    session.stop();
  });
});

describe('reading a pin the program writes still stops the run (self-written pin)', () => {
  it.each([
    ['an on/off read of a PWM pin', [pinWriteAnalog('P0', num(512)), print(pinRead('P0'))], 'P0'],
    ['an analog read of a servo pin', [servoWrite('P1', num(45)), print(pinAnalog('P1'))], 'P1'],
  ])('%s', async (_name, statements, pin) => {
    const session = newSession();
    session.start(document(program(statements)));
    await settle();
    expect(session.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'out-of-domain', message: `Pin ${pin} is set by this program, so it cannot be read as well.` },
    });
    session.stop();
  });
});

describe('the profiles', () => {
  it('Basic has neither block: the run does not start', () => {
    const session = newSession();
    const result = session.start({ ...document(program([pinWriteAnalog('P0', num(512))]), 'ybc-basic'), circuit: { components: [board], wires: [] } } as ProjectDocument);
    expect(result).toMatchObject({ ok: false, reason: 'compile-error' });
  });

  it('Basic cannot hold the servo part: a Basic project with one is not ready to run', () => {
    const session = newSession();
    const result = session.start(document(program([]), 'ybc-basic'));
    expect(result).toMatchObject({ ok: false, reason: 'incompatible-devices' });
  });
});
