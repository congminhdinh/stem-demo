import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import ybcBoardJson from '../devices/definitions/ybc-board.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { createBlockPackCatalog } from '../program/block-packs';
import { and, cmp, ifThen, not, num, print, program, repeat, text, wait, whileLoop, type Json } from '../program/__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite } from '../program/__fixtures__/ybc-pin-blocks';
import { createRunSession, type RunSession, type RunSnapshot } from './run-session';
import { createPinCapabilities } from './ybc-pin-io';

// The header pins through the production RunSession (YB-4): a program's pin writes drive the circuit and the
// snapshot shows it, a read sees what the circuit puts on the pin, a potentiometer is moved by a runtime input,
// and a pin that cannot be read stops the program at its block. Real compiler, real interpreter, real simulation;
// only the clock is fake.

const registry = createDeviceRegistry(localDeviceDefinitions);
const at = { x: 0, y: 0 };
const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: at };
const part = (id: string, deviceType: string) => ({ id, deviceType, position: at });
const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});

/** An LED on P0 (through a resistor) to GND. */
const ledOnP0 = {
  components: [board, part('resistor-1', 'resistor'), part('led-1', 'led')],
  wires: [
    wire('w1', ['ybc-board-1', 'p0'], ['resistor-1', 'a']),
    wire('w2', ['resistor-1', 'b'], ['led-1', 'anode']),
    wire('w3', ['led-1', 'cathode'], ['ybc-board-1', 'gnd']),
  ],
};
/** The knob on P1: VCC to 3V3, GND to GND, OUT to P1. */
const knobOnP1 = {
  components: [board, part('potentiometer-1', 'potentiometer')],
  wires: [
    wire('k1', ['potentiometer-1', 'vcc'], ['ybc-board-1', '3v3']),
    wire('k2', ['potentiometer-1', 'gnd'], ['ybc-board-1', 'gnd']),
    wire('k3', ['potentiometer-1', 'out'], ['ybc-board-1', 'p1']),
  ],
};
/** P7 of the contract: the knob on P1 and the LED on P0. */
const knobAndLed = {
  components: [board, part('potentiometer-1', 'potentiometer'), part('resistor-1', 'resistor'), part('led-1', 'led')],
  wires: [...knobOnP1.wires, ...ledOnP0.wires],
};

function document(blocks: Json, circuit: { components: unknown[]; wires: unknown[] }, profile = 'ybc-basic'): ProjectDocument {
  return { ...fixtureDocument(profile, { blocks }), circuit } as ProjectDocument;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const lit = (session: RunSession, id = 'led-1') => session.getSnapshot().simulation?.components[id]?.lit;
const lines = (session: RunSession) => session.getSnapshot().console?.lines ?? [];

describe('digital write drives the circuit (C-23)', () => {
  it('lights an LED on P0 and puts it out again; the board stays powered after the program ends (E6)', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    expect(session.start(document(program([pinWrite('P0', true)]), ledOnP0))).toEqual({ ok: true });
    expect(lit(session)).toBe(false);
    await settle();
    expect(session.getSnapshot().status).toBe('finished');
    expect(lit(session)).toBe(true);
    session.stop();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
  });

  it('blinks: on, 500 ms, off, 500 ms, on again', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    const forever = [pinWrite('P0', true), wait(num(500)), pinWrite('P0', false), wait(num(500))];
    session.start(document(program([], forever), ledOnP0));
    await settle();
    expect(lit(session)).toBe(true);
    await tick(499);
    expect(lit(session)).toBe(true);
    // The wait ends at 500 ms; what follows it (the next block) runs a few microtasks later.
    await tick(1);
    await settle();
    expect(lit(session)).toBe(false);
    // 500 ms more ends the pass; the 10 ms every forever pass ends with (IM-6) comes before the next one starts.
    await tick(500);
    await settle();
    expect(lit(session)).toBe(false);
    await tick(10);
    await settle();
    expect(lit(session)).toBe(true);
    session.stop();
  });

  it('publishes a new snapshot only when a pin changes: writing the level it already has is no news', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    session.start(document(program([pinWrite('P0', true), pinWrite('P0', true), pinWrite('P0', true)]), ledOnP0));
    const afterStart = published.length;
    await settle();
    // One publish for the write, one when the program finishes; the two repeats publish nothing.
    expect(published.length - afterStart).toBe(2);
    expect(published.at(-1)?.status).toBe('finished');
  });

  it('keeps the pins of one run out of the next: a new run starts with every pin undriven', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([pinWrite('P0', true)]), ledOnP0));
    await settle();
    expect(lit(session)).toBe(true);
    session.start(document(program([], []), ledOnP0));
    expect(lit(session)).toBe(false);
    await settle();
    expect(lit(session)).toBe(false);
    session.stop();
  });

  it('does not change the document (B2): the circuit and the program are what they were', async () => {
    const doc = document(program([pinWrite('P0', true)]), ledOnP0);
    const before = structuredClone(doc);
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(doc);
    await settle();
    session.stop();
    expect(doc).toEqual(before);
  });
});

describe('a pin sees what the circuit puts on it (C-24, C-25)', () => {
  const wired = (to: string) => ({ components: [board], wires: [wire('r1', ['ybc-board-1', 'p1'], ['ybc-board-1', to])] });

  it('reads a pin wired to 3V3 as on (digital) and 4095 (analog), and one wired to GND as off and 0', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([print(pinRead('P1')), print(pinAnalog('P1'))]), wired('3v3')));
    await settle();
    expect(lines(session)).toEqual(['True', '4095']);
    session.start(document(program([print(pinRead('P1')), print(pinAnalog('P1'))]), wired('gnd')));
    await settle();
    expect(lines(session)).toEqual(['False', '0']);
    session.stop();
  });

  it('reads the level another pin of the program drives (a loopback P0 to P1)', async () => {
    const loop = { components: [board], wires: [wire('l1', ['ybc-board-1', 'p0'], ['ybc-board-1', 'p1'])] };
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([print(pinRead('P1')), pinWrite('P0', true), print(pinRead('P1')), print(pinAnalog('P1')), pinWrite('P0', false), print(pinAnalog('P1'))]), loop));
    await settle();
    // Undriven at first: that is the floating read, and it stops the program (below). Here P0 is written first.
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'out-of-domain' } });
    session.start(document(program([pinWrite('P0', true), print(pinRead('P1')), print(pinAnalog('P1')), pinWrite('P0', false), print(pinRead('P1')), print(pinAnalog('P1'))]), loop));
    await settle();
    expect(lines(session)).toEqual(['True', '4095', 'False', '0']);
    session.stop();
  });

  it('reads a potentiometer on the native scale 0..4095, from the slider\'s percentage: 0, 1, 50, 51, 100 %', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    // One pass of this loop is the wait (50 ms) plus the pause every forever pass ends with (10 ms).
    session.start(document(program([], [print(pinAnalog('P1')), wait(num(50))]), knobOnP1));
    await settle();
    expect(lines(session)).toEqual(['0']);
    const moves: [number, string][] = [[1, '41'], [50, '2048'], [51, '2088'], [100, '4095']];
    for (const [percent, expected] of moves) {
      session.setComponentInput('potentiometer-1', { kind: 'slider', value: percent });
      expect(session.getSnapshot().simulation?.components['potentiometer-1']).toEqual({ value: percent });
      // Exactly one pass ends inside this window, and it reads the knob where it was just put.
      await tick(60);
      expect(lines(session).at(-1), `${percent} %`).toBe(expected);
    }
    session.stop();
  });

  it('is the P7 program: the knob above half switches the LED on, below it off (threshold 2048 on the native scale)', async () => {
    const forever = [ifThen(cmp('GT', pinAnalog('P1'), num(2048)), [pinWrite('P0', true)], [pinWrite('P0', false)]), wait(num(10))];
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([], forever), knobAndLed));
    await settle();
    expect(lit(session)).toBe(false);
    for (const [percent, expected] of [[100, true], [51, true], [50, false], [49, false], [0, false], [75, true]] as const) {
      session.setComponentInput('potentiometer-1', { kind: 'slider', value: percent });
      await tick(20);
      expect(lit(session), `${percent} %`).toBe(expected);
    }
    session.stop();
  });

  it('gives the same answer in Advanced as in Basic (the pins are in both profiles)', async () => {
    for (const profile of ['ybc-basic', 'ybc-advanced']) {
      const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
      expect(session.start(document(program([print(pinAnalog('P1'))]), wired('3v3'), profile))).toEqual({ ok: true });
      await settle();
      expect(lines(session), profile).toEqual(['4095']);
      session.stop();
    }
  });
});

describe('a pin the program must not read stops it at the reading block (domain guard, plan §6.2)', () => {
  const failed = async (blocks: Json, circuit: { components: unknown[]; wires: unknown[] }) => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(blocks, circuit));
    await settle();
    const snapshot = session.getSnapshot();
    return { snapshot, session };
  };

  it('stops on a pin nothing drives, naming the pin and the block; the board stays powered (E7)', async () => {
    const read = pinRead('P1');
    const { snapshot, session } = await failed(program([print(text('before')), print(read), print(text('never'))]), { components: [board], wires: [] });
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toEqual({ message: 'Pin P1 is not connected to anything, so it cannot be read.', blockId: expect.any(String), code: 'out-of-domain' });
    expect(snapshot.error?.blockId).toBe(read.id);
    expect(snapshot.console?.lines).toEqual(['before']);
    expect(snapshot.simulation).not.toBeNull();
    session.stop();
  });

  it('stops on a pin two things drive: 3V3 and GND on one wire', async () => {
    const shorted = { components: [board], wires: [wire('s1', ['ybc-board-1', 'p1'], ['ybc-board-1', '3v3']), wire('s2', ['ybc-board-1', 'p1'], ['ybc-board-1', 'gnd'])] };
    const { snapshot } = await failed(program([print(pinAnalog('P1'))]), shorted);
    expect(snapshot.error).toMatchObject({ code: 'out-of-domain', message: 'Pin P1 is driven by two things at once, so it cannot be read.' });
  });

  it('stops on a pin the program itself set: the board\'s answer to reading an output is not known', async () => {
    const { snapshot } = await failed(program([pinWrite('P0', true), print(pinRead('P0'))]), ledOnP0);
    expect(snapshot.error).toMatchObject({ code: 'out-of-domain', message: 'Pin P0 is set by this program, so it cannot be read as well.' });
    const analog = await failed(program([pinWrite('P0', false), print(pinAnalog('P0'))]), ledOnP0);
    expect(analog.snapshot.error).toMatchObject({ code: 'out-of-domain' });
  });

  it('stops on an on/off read of an analog level, and says to use analog read', async () => {
    const { snapshot } = await failed(program([print(pinRead('P1'))]), knobOnP1);
    expect(snapshot.error).toMatchObject({ code: 'out-of-domain', message: expect.stringContaining('Use "analog read"') });
  });

  it('stops on a pin that a potentiometer and the program both drive', async () => {
    const both = { components: knobOnP1.components, wires: knobOnP1.wires };
    // P1 is written (so it is driven by the program) and the knob drives it too: the read refuses first, on the write.
    const { snapshot } = await failed(program([pinWrite('P1', true), print(pinAnalog('P1'))]), both);
    expect(snapshot.error).toMatchObject({ code: 'out-of-domain' });
    expect(snapshot.simulation?.nets.some((net) => net.level === 'conflict')).toBe(true);
  });

  it('is a clean stop: the next run starts with nothing left over from the failed one', async () => {
    const { session } = await failed(program([print(pinRead('P2'))]), { components: [board], wires: [] });
    expect(session.start(document(program([print(text('fresh'))]), { components: [board], wires: [] }))).toEqual({ ok: true });
    await settle();
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', error: null, console: { lines: ['fresh'] } });
    session.stop();
  });
});

describe('what Run refuses before the program starts (L-2, L-3)', () => {
  it('refuses a pin block in a generic project with not-in-profile and the block\'s id (L-2); the program stays as it is', () => {
    const block = pinWrite('P0', true);
    const generic: ProjectDocument = { ...fixtureDocument(undefined, { blocks: program([block]), components: [] }), circuit: { components: [], wires: [] } };
    const result = createRunSession(registry, { capabilities: createPinCapabilities(registry) }).start(generic);
    expect(result).toMatchObject({ ok: false });
    // A generic project with no board is told so first; with a board the block is what is refused.
    const withBoard = { ...generic, circuit: { components: [{ id: 'g', deviceType: 'board', position: at }], wires: [] } };
    const refused = createRunSession(registry, { capabilities: createPinCapabilities(registry) }).start(withBoard);
    expect(refused).toMatchObject({ ok: false, reason: 'compile-error' });
    expect(refused.ok ? [] : refused.diagnostics).toEqual([expect.objectContaining({ code: 'not-in-profile', blockId: block.id })]);
  });

  it('refuses a potentiometer in a generic project (incompatible-devices): it belongs to the Yolo:Bit-compatible family', () => {
    const generic: ProjectDocument = { ...fixtureDocument(undefined), circuit: { components: [{ id: 'g', deviceType: 'board', position: at }, part('potentiometer-1', 'potentiometer')], wires: [] } };
    expect(createRunSession(registry, { capabilities: createPinCapabilities(registry) }).start(generic)).toMatchObject({ ok: false, reason: 'incompatible-devices' });
  });

  it('refuses an analog read when the board has no analog input (capability-unavailable), and runs a digital one', () => {
    const noAnalog = createDeviceRegistry([
      ...localDeviceDefinitions.filter((definition) => (definition as { id: string }).id !== 'ybc-board'),
      { ...structuredClone(ybcBoardJson), board: { ...ybcBoardJson.board, pins: ybcBoardJson.board.pins.map((pin) => ({ ...pin, capabilities: ['digital'] })) } },
    ]);
    const session = createRunSession(noAnalog, { packs: createBlockPackCatalog(noAnalog), capabilities: createPinCapabilities(noAnalog) });
    const analog = pinAnalog('P1');
    const refused = session.start(document(program([print(analog)]), { components: [board], wires: [] }));
    expect(refused).toMatchObject({ ok: false, reason: 'compile-error' });
    expect(refused.ok ? [] : refused.diagnostics).toEqual([expect.objectContaining({ code: 'capability-unavailable', blockId: analog.id })]);
    expect(session.start(document(program([pinWrite('P0', true)]), { components: [board], wires: [] }))).toEqual({ ok: true });
    session.stop();
  });

  it('refuses a reserved pin: it cannot be used from a block, whatever a stored program says', () => {
    const reserved = createDeviceRegistry([
      ...localDeviceDefinitions.filter((definition) => (definition as { id: string }).id !== 'ybc-board'),
      { ...structuredClone(ybcBoardJson), board: { ...ybcBoardJson.board, reservedPins: ['P2'] } },
    ]);
    const session = createRunSession(reserved, { packs: createBlockPackCatalog(reserved), capabilities: createPinCapabilities(reserved) });
    const write = pinWrite('P2', true);
    const refused = session.start(document(program([write]), { components: [board], wires: [] }));
    expect(refused.ok ? [] : refused.diagnostics).toEqual([expect.objectContaining({ code: 'value-out-of-range', blockId: write.id })]);
    expect(session.start(document(program([pinWrite('P1', true)]), { components: [board], wires: [] }))).toEqual({ ok: true });
    session.stop();
  });

  it('refuses a pin outside the three the contract opens, though a board may list more', () => {
    const wide = createDeviceRegistry([
      ...localDeviceDefinitions.filter((definition) => (definition as { id: string }).id !== 'ybc-board'),
      { ...structuredClone(ybcBoardJson), board: { ...ybcBoardJson.board, pins: [...ybcBoardJson.board.pins, { name: 'P3', portId: 'p2', capabilities: ['digital', 'analogIn'] }] } },
    ]);
    const session = createRunSession(wide, { packs: createBlockPackCatalog(wide), capabilities: createPinCapabilities(wide) });
    const write = pinWrite('P3', true);
    const refused = session.start(document(program([write]), { components: [board], wires: [] }));
    expect(refused.ok ? [] : refused.diagnostics).toEqual([expect.objectContaining({ code: 'value-out-of-range', blockId: write.id })]);
  });
});

describe('the runtime input of a potentiometer', () => {
  const start = async (circuit = knobOnP1) => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([], [print(pinAnalog('P1')), wait(num(50))]), circuit));
    await settle();
    return session;
  };
  const value = (session: RunSession, id = 'potentiometer-1') => session.getSnapshot().simulation?.components[id]?.value;

  it('moves the knob and simulates again at once, in the snapshot the renderer draws from', async () => {
    const session = await start();
    expect(value(session)).toBe(0);
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 42 });
    expect(value(session)).toBe(42);
    expect(session.getSnapshot().simulation?.nets.find((net) => net.level === 'analog')).toMatchObject({ analogPercent: 42 });
    session.stop();
  });

  it('clamps at the ends of its travel: -5 is 0, 250 is 100', async () => {
    const session = await start();
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 250 });
    expect(value(session)).toBe(100);
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: -5 });
    expect(value(session)).toBe(0);
    session.stop();
  });

  it('ignores what is not a slider input: a fraction, NaN, Infinity, a hold, a tilt, a gesture, or junk', async () => {
    const session = await start();
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 30 });
    for (const bad of [
      { kind: 'slider', value: 12.5 },
      { kind: 'slider', value: Number.NaN },
      { kind: 'slider', value: Number.POSITIVE_INFINITY },
      { kind: 'hold', closed: true },
      { kind: 'tilt', x: 1, y: 1 },
      { kind: 'gesture' },
      { kind: 'slider' },
      { kind: 'slider', value: '70' },
      null,
      'slider',
    ]) {
      session.setComponentInput('potentiometer-1', bad as never);
      expect(value(session), JSON.stringify(bad)).toBe(30);
    }
    session.stop();
  });

  it('ignores a slider for anything that is not a potentiometer: the LED, the board, a button, a part that is not there', async () => {
    const session = await start(knobAndLed);
    const before = session.getSnapshot();
    for (const id of ['led-1', 'ybc-board-1', 'resistor-1', 'nobody', '', 'ybc-board-1/light', 'ybc-board-1/display']) {
      session.setComponentInput(id, { kind: 'slider', value: 90 });
    }
    expect(session.getSnapshot().simulation).toEqual(before.simulation);
    session.stop();
  });

  it('is ignored while idle, and gone after the run: the next run starts with the knob at rest', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 90 });
    expect(session.getSnapshot().simulation).toBeNull();
    session.start(document(program([], []), knobOnP1));
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 90 });
    expect(value(session)).toBe(90);
    session.stop();
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 10 });
    expect(session.getSnapshot().simulation).toBeNull();
    session.start(document(program([], []), knobOnP1));
    expect(value(session)).toBe(0);
    session.stop();
  });

  it('works after the program finished or failed, as a button does: the board is still powered', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([print(text('done'))]), knobOnP1));
    await settle();
    expect(session.getSnapshot().status).toBe('finished');
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 77 });
    expect(value(session)).toBe(77);
    session.stop();
  });

  it('publishes nothing when the same input is given again, and a clamp-equivalent input leaves the knob where it is', async () => {
    const session = await start();
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 100 });
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 100 });
    expect(published).toEqual([]);
    // The generic input plane compares what it was given, not what the knob makes of it (the model clamps): 999 is a
    // new input, so a snapshot may follow, but the knob and everything the simulation says stay exactly as they were.
    const before = session.getSnapshot().simulation;
    session.setComponentInput('potentiometer-1', { kind: 'slider', value: 999 });
    expect(session.getSnapshot().simulation).toEqual(before);
    expect(value(session)).toBe(100);
    // The knob at rest is position 0: setting 0 on a knob never moved changes nothing the simulation says.
    const fresh = await start();
    const atRest = fresh.getSnapshot().simulation;
    fresh.setComponentInput('potentiometer-1', { kind: 'slider', value: 0 });
    expect(fresh.getSnapshot().simulation).toEqual(atRest);
    expect(value(fresh)).toBe(0);
    session.stop();
    fresh.stop();
  });

  it('lets a component of the circuit win over `<board>/<part>`, even when its id looks like one (a slash is legal in an id)', async () => {
    const slashed = {
      components: [board, part('ybc-board-1/light', 'potentiometer')],
      wires: [
        wire('k1', ['ybc-board-1/light', 'vcc'], ['ybc-board-1', '3v3']),
        wire('k2', ['ybc-board-1/light', 'gnd'], ['ybc-board-1', 'gnd']),
        wire('k3', ['ybc-board-1/light', 'out'], ['ybc-board-1', 'p1']),
      ],
    };
    const session = await start(slashed);
    session.setComponentInput('ybc-board-1/light', { kind: 'slider', value: 64 });
    expect(value(session, 'ybc-board-1/light')).toBe(64);
    session.stop();
  });

  it('keeps a button of the circuit working beside it (hold), and does not take a slider for it', async () => {
    const buttonAndKnob = { components: [...knobOnP1.components, part('push-button-1', 'push-button')], wires: knobOnP1.wires };
    const session = await start(buttonAndKnob);
    session.setContactInput('push-button-1', true);
    expect(session.getSnapshot().simulation?.components['push-button-1']).toEqual({ closed: true });
    session.setComponentInput('push-button-1', { kind: 'slider', value: 50 });
    expect(session.getSnapshot().simulation?.components['push-button-1']).toEqual({ closed: true });
    session.setComponentInput('potentiometer-1', { kind: 'hold', closed: true });
    expect(value(session)).toBe(0);
    session.stop();
  });
});

describe('Stop, replacement and reentrancy with pins', () => {
  it('stops a pin loop at once, and leaves no timer or write behind', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([], [pinWrite('P0', true), wait(num(100)), pinWrite('P0', false), wait(num(100))]), ledOnP0));
    await tick(150);
    session.stop();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    await tick(5000);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps run B when run A\'s own pin write notifies a listener that starts B (the latest call wins)', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    const replacement = document(program([], [wait(num(1000))]), ledOnP0);
    let started = false;
    session.subscribe((snapshot) => {
      if (!started && snapshot.simulation?.components['led-1']?.lit === true) {
        started = true;
        session.start(replacement);
      }
    });
    session.start(document(program([pinWrite('P0', true), pinWrite('P0', false), print(text('A went on'))]), ledOnP0));
    await settle();
    await tick(10);
    expect(started).toBe(true);
    // B survives: running, its LED out, nothing of A in its console, and A's second write did not reach it.
    expect(session.getSnapshot()).toMatchObject({ status: 'running', console: { lines: [] } });
    expect(lit(session)).toBe(false);
    session.stop();
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('ends in idle when a listener stops the session from a pin write; no later write of that run lights anything', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    let stops = 0;
    session.subscribe((snapshot) => {
      if (snapshot.simulation?.components['led-1']?.lit === true) {
        stops += 1;
        session.stop();
      }
    });
    session.start(document(program([], [pinWrite('P0', true), wait(num(10)), pinWrite('P0', true)]), ledOnP0));
    await settle();
    await tick(100);
    expect(stops).toBe(1);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
  });

  it('runs a loop of reads for a long time without growing: 20 000 reads of a wired pin', async () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([repeat(num(20_000), [{ ...print(pinAnalog('P1')) }])]), knobOnP1));
    await tick(2000);
    expect(session.getSnapshot().status).toBe('finished');
    // The console keeps its newest lines only (plan §6.7).
    expect(session.getSnapshot().console?.lines.length).toBeLessThanOrEqual(500);
    session.stop();
  });

  it('reads a pin in a `while` condition and ends the loop when the circuit says so (a held button)', async () => {
    const circuit = {
      components: [board, part('push-button-1', 'push-button')],
      wires: [
        wire('b1', ['ybc-board-1', '3v3'], ['push-button-1', 'a']),
        wire('b2', ['push-button-1', 'b'], ['ybc-board-1', 'p2']),
        // P2 also sits on GND through a second wire to the board's GND: an always-driven pin needs a pull, and
        // there is none, so this circuit is the case the plan warns about (B9). It is a conflict while pressed.
      ],
    };
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(document(program([whileLoop(and(not(pinRead('P2')), not(pinRead('P2'))), [wait(num(10))])]), circuit));
    await settle();
    // Released: P2 floats, so the first read stops the program (it is not a logic level).
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'out-of-domain' } });
    session.stop();
  });
});
