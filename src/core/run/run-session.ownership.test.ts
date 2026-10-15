import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankFrame, type Frame } from '../capabilities/frame';
import * as simulation from '../simulation/simulate-circuit';
import type { ComponentInput, ComponentState } from '../simulation/simulate-circuit';
import { at, boardId, seamDocument, seamPinDocument, seamProfiles, seamRegistry, seamRegistryWithSimulatedBoard, ybcBoard } from './__fixtures__/seam-fixtures';
import { createRunSession, type RunEnvironment, type RunSnapshot } from './run-session';

// YB-CP amendment 1, review findings CP-A1, CP-A3 and CP-A4: who OWNS an object after it crosses a boundary.
// The rule: an object that a caller can still reach never stays an alias of the state of a run.
//   caller → run         setComponentInput copies the input it accepts (the caller may go on editing its object)
//   capability → run     report copies the state it is given
//   run → capability     input() and simulation() hand out copies (what the capability changes is its own)
//   run → snapshot       a published simulation shares nothing with the states the run keeps
// Each test below is an attack: it mutates the object it holds and then asks the run what it believes.

vi.mock('../simulation/simulate-circuit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../simulation/simulate-circuit')>();
  return { ...original, simulateCircuit: vi.fn(original.simulateCircuit) };
});
const simulateSpy = vi.mocked(simulation.simulateCircuit);
const lastInputs = () => simulateSpy.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.useFakeTimers();
  simulateSpy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

type DeepMutable<T> = { -readonly [K in keyof T]: DeepMutable<T[K]> };
/** The types say read-only; a careless consumer ignores them. This is that consumer. */
const mutable = <T>(value: T) => value as DeepMutable<T>;

const display = `${boardId}/display`;
const buttonA = `${boardId}/button-a`;
const lit = (index: number): Frame => ({ pixels: blankFrame().pixels.map((_, pixel) => (pixel === index ? '#FF0000' : null)) });
const slider = (value: number): ComponentInput => ({ kind: 'slider', value });

function setup(registry = seamRegistry) {
  const environments: RunEnvironment[] = [];
  const session = createRunSession(registry, {
    profiles: seamProfiles,
    capabilities: (environment) => {
      environments.push(environment);
      return {};
    },
  });
  const published: RunSnapshot[] = [];
  session.subscribe((snapshot) => published.push(snapshot));
  return { session, published, env: (index = 0) => environments[index] as RunEnvironment };
}

const shown = (snapshot: RunSnapshot) => JSON.stringify(snapshot.simulation);

describe('CP-A1: what simulation() returns is the consumer’s own copy', () => {
  /** A run with a lit LED, a driven pin and a reported display, so every kind of nested member exists. */
  function litRun() {
    const run = setup(seamRegistryWithSimulatedBoard);
    run.session.start(seamPinDocument());
    run.env().drivePin('P0', 1);
    run.env().report(display, { frame: lit(12), value: 3, hz: 440 });
    return run;
  }

  it('lets a consumer wreck what it got without touching the run, a published snapshot or the next simulation, and notifies nobody', () => {
    const { session, published, env } = litRun();
    const before = shown(session.getSnapshot());
    const keptSnapshot = session.getSnapshot();
    const notices = published.length;

    const got = mutable(env().simulation()!);
    got.pinReads.P0 = 0;
    got.pinReads.P9 = 1;
    delete got.pinReads.P1;
    const state = got.components[display]!;
    state.value = 99;
    state.hz = 1;
    state.frame!.pixels[12] = '#00FF00';
    state.frame!.pixels[0] = '#0000FF';
    state.frame!.pixels.length = 3;
    got.components['led-1']!.lit = false;
    got.components['ghost'] = { lit: true };
    got.nets[0]!.level = 'conflict';
    got.nets[0]!.ports.length = 0;
    got.nets.length = 0;

    // Nothing was published, and nothing the run holds or showed has changed.
    expect(published).toHaveLength(notices);
    expect(shown(session.getSnapshot())).toBe(before);
    expect(shown(keptSnapshot)).toBe(before);
    expect(JSON.stringify(env().simulation())).toBe(before);

    // The next simulation is made from the true state, not from what the consumer left behind.
    env().drivePin('P2', 1);
    const next = session.getSnapshot().simulation!;
    expect(next.components[display]).toEqual({ frame: lit(12), value: 3, hz: 440 });
    expect(next.components['led-1']).toEqual({ lit: true });
    expect(next.components['ghost']).toBeUndefined();
    expect(next.pinReads).toMatchObject({ P0: 1, P1: 0, P2: 1 });
    expect(next.pinReads).not.toHaveProperty('P9');
    expect(next.nets.length).toBeGreaterThan(0);
    session.stop();
  });

  it('gives every read a copy of its own: what one consumer changes the next never sees', () => {
    const { session, env } = litRun();
    const first = mutable(env().simulation()!);
    first.components[display]!.frame!.pixels[12] = '#00FF00';
    first.pinReads.P0 = 0;
    const second = env().simulation()!;
    expect(second).not.toBe(first);
    expect(second.components[display]?.frame?.pixels[12]).toBe('#FF0000');
    expect(second.pinReads.P0).toBe(1);
    session.stop();
  });

  it('does not let a published snapshot that a subscriber edited corrupt the state the run keeps, now or in the next simulation', () => {
    const { session, env } = litRun();
    const truth = JSON.stringify(env().simulation());
    // A misbehaving subscriber edits every kind of member of the snapshot it was given.
    const snapshot = mutable(session.getSnapshot().simulation!);
    snapshot.components[display]!.frame!.pixels[12] = '#00FF00';
    snapshot.components[display]!.value = 99;
    snapshot.pinReads.P0 = 0;
    snapshot.components['led-1']!.lit = false;
    snapshot.nets.length = 0;

    // What a capability reads straight away is the run's own simulation, not the edited snapshot...
    expect(JSON.stringify(env().simulation())).toBe(truth);
    // ...and so is the next one.
    env().drivePin('P2', 1);
    expect(session.getSnapshot().simulation!.components[display]).toEqual({ frame: lit(12), value: 3, hz: 440 });
    expect(session.getSnapshot().simulation!.pinReads.P0).toBe(1);
    session.stop();
  });

  it('gives each published snapshot its own simulation: an older snapshot is never the newer one', () => {
    const { session, env } = litRun();
    const older = session.getSnapshot();
    env().drivePin('P2', 1);
    const newer = session.getSnapshot();
    expect(newer.simulation).not.toBe(older.simulation);
    expect(newer.simulation?.components).not.toBe(older.simulation?.components);
    expect(newer.simulation?.components[display]).not.toBe(older.simulation?.components[display]);
    expect(older.simulation?.pinReads.P2).toBe(0);
    session.stop();
  });

  it('copies an id that is a prototype member as faithfully as any other: it stays an own property of every snapshot', () => {
    const { session, env } = setup();
    session.start(seamDocument([ybcBoard, { id: '__proto__', deviceType: 'test-ybc-button', position: at }]));
    session.setComponentInput('__proto__', { kind: 'hold', closed: true });
    env().report(display, { value: 1 });
    for (const components of [session.getSnapshot().simulation!.components, env().simulation()!.components]) {
      expect(Object.hasOwn(components, '__proto__')).toBe(true);
      expect(Object.keys(components).sort()).toEqual(['__proto__', display].sort());
      expect(Object.getOwnPropertyDescriptor(components, '__proto__')?.value).toEqual({ closed: true });
      expect(Object.getPrototypeOf(components)).toBe(Object.prototype);
    }
    session.stop();
  });

  it('keeps a reference retained from a replaced run harmless: the new run is untouched and the old environment reads nothing', () => {
    const { session, env } = litRun();
    const retained = mutable(env(0).simulation()!);

    session.start(seamPinDocument());
    env(1).drivePin('P0', 1);
    env(1).report(display, { frame: lit(4) });
    const before = shown(session.getSnapshot());

    retained.pinReads.P0 = 0;
    retained.components[display]!.frame!.pixels[4] = '#00FF00';
    retained.components['led-1']!.lit = false;

    expect(env(0).simulation()).toBeNull();
    expect(shown(session.getSnapshot())).toBe(before);
    expect(JSON.stringify(env(1).simulation())).toBe(before);
    session.stop();
  });
});

describe('CP-A3: an accepted input is the run’s own', () => {
  it('counts every click of ONE object that the caller keeps editing and submitting (C-13)', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    const input = { kind: 'hold' as const, closed: false };
    for (let click = 0; click < 3; click += 1) {
      input.closed = true;
      session.setComponentInput(buttonA, input);
      input.closed = false;
      session.setComponentInput(buttonA, input);
    }
    expect(env().takePresses(buttonA)).toBe(3);
    expect(env().takePresses(buttonA)).toBe(0);
    session.stop();
  });

  it('sees the real earlier state when the caller edits the stored object and submits it again (the reviewed reproduction)', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    const input = { kind: 'hold' as const, closed: false };
    session.setComponentInput(buttonA, input);
    input.closed = true;
    session.setComponentInput(buttonA, input);
    expect(env().takePresses(buttonA)).toBe(1);
    expect(env().input(buttonA)).toEqual({ kind: 'hold', closed: true });
    session.stop();
  });

  it('keeps a slider at the value that was submitted until it is submitted again, then simulates and publishes normally', () => {
    const { session, published, env } = setup();
    session.start(seamDocument([ybcBoard, { id: 'slider-1', deviceType: 'test-ybc-slider', position: at }]));
    const input = { kind: 'slider' as const, value: 10 };
    session.setComponentInput('slider-1', input);
    expect(env().input('slider-1')).toEqual(slider(10));
    expect(lastInputs()?.inputs?.['slider-1']).toEqual(slider(10));
    const notices = published.length;

    input.value = 77;
    // Editing the caller's object is not a submission.
    expect(env().input('slider-1')).toEqual(slider(10));
    expect(published).toHaveLength(notices);

    session.setComponentInput('slider-1', input);
    expect(published).toHaveLength(notices + 1);
    expect(env().input('slider-1')).toEqual(slider(77));
    expect(lastInputs()?.inputs?.['slider-1']).toEqual(slider(77));
    session.stop();
  });

  it('keeps two parts apart when one object is submitted to both and then edited', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    const buttonB = `${boardId}/button-b`;
    const shared = { kind: 'hold' as const, closed: true };
    session.setComponentInput(buttonA, shared);
    session.setComponentInput(buttonB, shared);
    shared.closed = false;
    expect(env().input(buttonA)).toEqual({ kind: 'hold', closed: true });
    expect(env().input(buttonB)).toEqual({ kind: 'hold', closed: true });
    // Releasing one part does not release the other.
    session.setComponentInput(buttonA, shared);
    expect(env().input(buttonA)).toEqual({ kind: 'hold', closed: false });
    expect(env().input(buttonB)).toEqual({ kind: 'hold', closed: true });
    expect(env().takePresses(buttonA)).toBe(1);
    expect(env().takePresses(buttonB)).toBe(1);
    session.stop();
  });

  it('hands out copies: what a capability changes in the input it read is not the input the run holds', () => {
    const { session, env } = setup();
    session.start(seamDocument([ybcBoard, { id: 'slider-1', deviceType: 'test-ybc-slider', position: at }]));
    session.setComponentInput(buttonA, { kind: 'hold', closed: true });
    session.setComponentInput('slider-1', slider(10));

    const held = mutable(env().input(buttonA)!) as { kind: string; closed: boolean };
    held.closed = false;
    const level = mutable(env().input('slider-1')!) as { kind: string; value: number };
    level.value = 99;

    expect(env().input(buttonA)).toEqual({ kind: 'hold', closed: true });
    expect(env().input('slider-1')).toEqual(slider(10));
    // A part that is still held is not pressed again by submitting the same state, whatever was done to the copy.
    session.setComponentInput(buttonA, { kind: 'hold', closed: true });
    expect(env().takePresses(buttonA)).toBe(1);
    expect(env().takePresses(buttonA)).toBe(0);
    expect(env().input('slider-1')).toEqual(slider(10));
    session.stop();
  });

  it('gives the simulation copies as well: what a model does to the inputs it was given is not the run’s state', () => {
    const { session, env } = setup();
    session.start(seamDocument([ybcBoard, { id: 'slider-1', deviceType: 'test-ybc-slider', position: at }]));
    session.setComponentInput('slider-1', slider(10));
    // A model that edits the input object it was given, and the record it was given it in.
    (mutable(lastInputs()!.inputs!)['slider-1'] as { value: number }).value = 500;
    mutable(lastInputs()!.inputs!)['injected'] = slider(1) as never;
    expect(env().input('slider-1')).toEqual(slider(10));
    expect(env().input('injected')).toBeUndefined();
    // The next simulation is made from what the run holds.
    session.setComponentInput('slider-1', slider(11));
    expect(lastInputs()?.inputs).toEqual({ 'slider-1': slider(11) });
    session.stop();
  });

  it('keeps the circuit’s own contact path out of it: a held contact is a boolean the run keeps, not an object', () => {
    const { session } = setup();
    session.start(seamDocument([ybcBoard, { id: 'btn-1', deviceType: 'test-ybc-button', position: at }]));
    const input = { kind: 'hold' as const, closed: true };
    session.setComponentInput('btn-1', input);
    input.closed = false;
    expect(session.getSnapshot().simulation?.components['btn-1']).toEqual({ closed: true });
    session.setComponentInput('btn-1', input);
    expect(session.getSnapshot().simulation?.components['btn-1']).toEqual({ closed: false });
    session.stop();
  });
});

describe('CP-A4: the same state is the same state, whatever order its properties were written in', () => {
  it('does not publish a report that only reorders properties, also with a nested frame', () => {
    const { session, published, env } = setup();
    session.start(seamDocument());
    env().report(display, { frame: lit(2), value: 1, hz: 440 });
    const notices = published.length;

    env().report(display, { hz: 440, value: 1, frame: { pixels: [...lit(2).pixels] } });
    env().report(display, { value: 1, frame: lit(2), hz: 440 });
    expect(published).toHaveLength(notices);

    // A real change still publishes, however it is written.
    env().report(display, { hz: 440, value: 1, frame: lit(3) });
    expect(published).toHaveLength(notices + 1);
    env().report(display, { hz: 441, value: 1, frame: lit(3) });
    expect(published).toHaveLength(notices + 2);
    session.stop();
  });

  it('treats a property that is undefined as a property that is absent', () => {
    const { session, published, env } = setup();
    session.start(seamDocument());
    env().report(display, { value: 1 });
    const notices = published.length;
    env().report(display, { value: 1, hz: undefined, frame: undefined } as ComponentState);
    expect(published).toHaveLength(notices);
    session.stop();
  });

  it('does not simulate again for an input that only reorders properties', () => {
    const { session, published } = setup();
    session.start(seamDocument([ybcBoard, { id: 'slider-1', deviceType: 'test-ybc-slider', position: at }]));
    session.setComponentInput('slider-1', { kind: 'slider', value: 10 });
    const notices = published.length;
    const calls = simulateSpy.mock.calls.length;
    session.setComponentInput('slider-1', { value: 10, kind: 'slider' } as ComponentInput);
    expect(published).toHaveLength(notices);
    expect(simulateSpy.mock.calls.length).toBe(calls);
    session.stop();
  });

  it('counts no press when a part that is held is set closed again with its properties reordered', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    session.setComponentInput(buttonA, { kind: 'hold', closed: true });
    session.setComponentInput(buttonA, { closed: true, kind: 'hold' } as ComponentInput);
    expect(env().takePresses(buttonA)).toBe(1);
    session.stop();
  });
});
