import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as simulation from '../simulation/simulate-circuit';
import type { ComponentInput } from '../simulation/simulate-circuit';
import { at, seamDocument, seamProfiles, seamRegistry } from './__fixtures__/seam-fixtures';
import { createRunSession, type RunEnvironment, type RunSession, type RunSnapshot } from './run-session';

// YB-CP amendment 1, review finding CP-A2: a component id is free text, and so are the names of its members. An id
// such as "constructor" or "__proto__" is a valid circuit component (a document may hold one), so every lookup and
// store the amendment keeps by id must answer only for what was put there: an unset id is `undefined` and not an
// `Object.prototype` member, a set one reads back what was set, one run never sees another's, and nothing is
// ever written to the prototype. `board/part` ids are covered with the board itself called like a member.

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

const prototypeIds = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'prototype', 'valueOf'];
const hold = (closed: boolean): ComponentInput => ({ kind: 'hold', closed });
const slider = (value: number): ComponentInput => ({ kind: 'slider', value });

/** Nothing the amendment did may have written to the prototype that every object shares. */
function expectPrototypeUntouched() {
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  expect(Object.keys(Object.prototype)).toEqual([]);
  const probe: Record<string, unknown> = {};
  for (const key of ['kind', 'closed', 'value', 'x', 'y', 'hz', 'frame', 'lit', 'level']) {
    expect(probe[key], key).toBeUndefined();
  }
}

function setup() {
  const environments: RunEnvironment[] = [];
  const session = createRunSession(seamRegistry, {
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

const componentsOf = (session: RunSession) => session.getSnapshot().simulation?.components ?? {};

describe.each(prototypeIds)('a circuit component called "%s"', (id) => {
  const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: at };
  const sliderPart = { id, deviceType: 'test-ybc-slider', position: at };
  const contact = { id, deviceType: 'test-ybc-button', position: at };

  describe('that takes a slider', () => {
    it('has no input before one is given: undefined and not a member of Object.prototype, in the run and in what the simulation gets', () => {
      const { session, env } = setup();
      session.start(seamDocument([board, sliderPart]));
      expect(env().input(id)).toBeUndefined();
      expect(env().takePresses(id)).toBe(0);
      const inputs = lastInputs()?.inputs;
      expect(inputs?.[id]).toBeUndefined();
      expect(Object.hasOwn(inputs ?? {}, id)).toBe(false);
      expectPrototypeUntouched();
      session.stop();
    });

    it('reads back what was set, in the run and in what the simulation gets, as its own property', () => {
      const { session, published, env } = setup();
      session.start(seamDocument([board, sliderPart]));
      const notices = published.length;
      session.setComponentInput(id, slider(40));
      expect(env().input(id)).toEqual(slider(40));
      const inputs = lastInputs()?.inputs;
      expect(Object.hasOwn(inputs ?? {}, id)).toBe(true);
      expect(inputs?.[id]).toEqual(slider(40));
      expect(Object.keys(inputs ?? {})).toEqual([id]);
      // Setting the same again changes nothing; a different value is a change.
      session.setComponentInput(id, slider(40));
      expect(published).toHaveLength(notices + 1);
      session.setComponentInput(id, slider(41));
      expect(env().input(id)).toEqual(slider(41));
      expect(published).toHaveLength(notices + 2);
      expectPrototypeUntouched();
      session.stop();
    });

    it('is not carried into a replacing run, and the replaced run’s environment can neither read nor write the new one', () => {
      const { session, env } = setup();
      session.start(seamDocument([board, sliderPart]));
      session.setComponentInput(id, slider(40));

      session.start(seamDocument([board, sliderPart]));
      expect(env(1).input(id)).toBeUndefined();
      expect(Object.hasOwn(lastInputs()?.inputs ?? {}, id)).toBe(false);

      session.setComponentInput(id, slider(7));
      expect(env(1).input(id)).toEqual(slider(7));
      // The stale environment still reads nothing, not the new run's value and not a prototype member.
      expect(env(0).input(id)).toBeUndefined();
      expect(env(0).takePresses(id)).toBe(0);
      expectPrototypeUntouched();
      session.stop();
      expect(env(1).input(id)).toBeUndefined();
    });
  });

  describe('that is a contact', () => {
    it('is open before it is held, closes when held, and is a property of the snapshot of its own', () => {
      const { session } = setup();
      session.start(seamDocument([board, contact]));
      expect(Object.hasOwn(componentsOf(session), id)).toBe(true);
      expect(componentsOf(session)[id]).toEqual({ closed: false });

      session.setComponentInput(id, hold(true));
      expect(componentsOf(session)[id]).toEqual({ closed: true });
      expect(Object.hasOwn(componentsOf(session), id)).toBe(true);
      expect(Object.keys(componentsOf(session))).toEqual([id]);

      session.setContactInput(id, false);
      expect(componentsOf(session)[id]).toEqual({ closed: false });
      expectPrototypeUntouched();
      session.stop();
    });

    it('does not count presses, is not an onboard part, and reports nothing', () => {
      const { session, published, env } = setup();
      session.start(seamDocument([board, contact]));
      session.setComponentInput(id, hold(true));
      expect(env().takePresses(id)).toBe(0);
      const notices = published.length;
      env().report(id, { value: 1 });
      expect(published).toHaveLength(notices);
      expect(componentsOf(session)[id]).toEqual({ closed: true });
      session.stop();
    });
  });
});

describe.each(prototypeIds)('an id "%s" that names nothing in the circuit', (id) => {
  it('is ignored by every path, and creates nothing', () => {
    const { session, published, env } = setup();
    session.start(seamDocument());
    const notices = published.length;
    const calls = simulateSpy.mock.calls.length;

    session.setComponentInput(id, hold(true));
    session.setComponentInput(id, slider(3));
    session.setContactInput(id, true);
    env().report(id, { value: 1 });
    env().report(id, null);
    env().drivePin(id, 1);

    expect(env().input(id)).toBeUndefined();
    expect(env().takePresses(id)).toBe(0);
    expect(published).toHaveLength(notices);
    expect(simulateSpy.mock.calls.length).toBe(calls);
    expect(componentsOf(session)).toEqual({});
    expectPrototypeUntouched();
    session.stop();
  });
});

describe.each(prototypeIds)('a board called "%s"', (boardName) => {
  const board = { id: boardName, deviceType: 'ybc-board', position: at };
  const button = `${boardName}/button-a`;
  const light = `${boardName}/light`;
  const display = `${boardName}/display`;

  it('keeps its onboard parts apart from the prototype: inputs, presses and reported state all work by their own ids', () => {
    const { session, env } = setup();
    session.start(seamDocument([board]));
    expect(env().input(button)).toBeUndefined();
    expect(env().takePresses(button)).toBe(0);

    session.setComponentInput(button, hold(true));
    session.setComponentInput(button, hold(false));
    session.setComponentInput(button, hold(true));
    session.setComponentInput(light, slider(60));
    expect(env().input(button)).toEqual(hold(true));
    expect(env().input(light)).toEqual(slider(60));
    expect(env().takePresses(button)).toBe(2);
    expect(env().takePresses(button)).toBe(0);

    env().report(display, { value: 5 });
    expect(componentsOf(session)[display]).toEqual({ value: 5 });
    expect(Object.keys(componentsOf(session))).toEqual([display]);
    env().report(display, null);
    expect(componentsOf(session)).toEqual({});
    expectPrototypeUntouched();
    session.stop();
  });

  it('is not shared with the next run, and the old environment can neither read nor consume it', () => {
    const { session, env } = setup();
    session.start(seamDocument([board]));
    session.setComponentInput(button, hold(true));
    session.setComponentInput(light, slider(60));
    env().report(display, { value: 5 });

    session.start(seamDocument([board]));
    expect(env(1).input(button)).toBeUndefined();
    expect(env(1).input(light)).toBeUndefined();
    expect(env(1).takePresses(button)).toBe(0);
    expect(componentsOf(session)).toEqual({});

    session.setComponentInput(button, hold(true));
    session.setComponentInput(light, slider(9));
    env(1).report(display, { value: 6 });
    expect(env(0).input(button)).toBeUndefined();
    expect(env(0).input(light)).toBeUndefined();
    expect(env(0).takePresses(button)).toBe(0);
    env(0).report(display, { value: 7 });
    expect(componentsOf(session)[display]).toEqual({ value: 6 });
    expect(env(1).takePresses(button)).toBe(1);
    expect(env(1).input(light)).toEqual(slider(9));
    expectPrototypeUntouched();
    session.stop();
  });
});

describe('a device whose simulation MODEL is called like a prototype member', () => {
  it.each(prototypeIds)('"%s" takes no input: a lookup of the model is not a lookup of a member', (model) => {
    // Models are data like ids. The fixture device is called `constructor`; the others are checked as plain strings.
    const { session, published } = setup();
    session.start(seamDocument([{ id: 'ybc-board-1', deviceType: 'ybc-board', position: at }, { id: 'odd', deviceType: 'test-ybc-proto-model', position: at }]));
    const notices = published.length;
    for (const input of [hold(true), slider(5), { kind: 'tilt', x: 1, y: 1 }, { kind: 'gesture' }] as ComponentInput[]) {
      session.setComponentInput('odd', input);
    }
    expect(published).toHaveLength(notices);
    expect(Object.hasOwn(lastInputs()?.inputs ?? {}, 'odd')).toBe(false);
    expect(model.length).toBeGreaterThan(0);
    session.stop();
  });
});
