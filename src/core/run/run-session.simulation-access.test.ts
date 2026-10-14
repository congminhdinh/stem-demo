import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import buttonDirectSample from '../../samples/button-direct.project.json';
import { projectDocumentSchema } from '../circuit/document';
import type { Capabilities } from '../capabilities/io';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import * as interpreter from '../program/ybc-interpreter';
import * as simulation from '../simulation/simulate-circuit';
import type { ComponentInput } from '../simulation/simulate-circuit';
import { at, boardId, seamDocument, seamPinDocument, seamProfiles, seamRegistry, seamRegistryWithSimulatedBoard, ybcBoard } from './__fixtures__/seam-fixtures';
import { createRunSession, type RunEnvironment, type RunSnapshot } from './run-session';

// YB-CP amendment 1: what a capability may use of the simulation of its run (`environment.simulation`, `drivePin`), and
// how the runtime input of a circuit component reaches the simulation (`SimulationInputs.inputs`). Both are
// transport. The pin capability below is a test double that does what the generic board's `digitalWrite` and
// `digitalRead` do, built ONLY on the environment: that is the proof that RunSession needs no pin code of its own.
// The simulation and the interpreter are spied on (they still run), as in run-session.boundary.test.ts.

vi.mock('../simulation/simulate-circuit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../simulation/simulate-circuit')>();
  return { ...original, simulateCircuit: vi.fn(original.simulateCircuit) };
});
vi.mock('../program/ybc-interpreter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../program/ybc-interpreter')>();
  return { ...original, runYbcProgram: vi.fn(original.runYbcProgram) };
});

const simulateSpy = vi.mocked(simulation.simulateCircuit);
const interpreterSpy = vi.mocked(interpreter.runYbcProgram);
const lastInputs = () => simulateSpy.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.useFakeTimers();
  simulateSpy.mockClear();
  interpreterSpy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const hold = (closed: boolean): ComponentInput => ({ kind: 'hold', closed });
const slider = (value: number): ComponentInput => ({ kind: 'slider', value });
const pinCircuit = seamPinDocument;

/** A factory whose capability is built on the environment alone. */
function pinSession() {
  const environments: RunEnvironment[] = [];
  const provided: Capabilities[] = [];
  const session = createRunSession(seamRegistryWithSimulatedBoard, {
    profiles: seamProfiles,
    capabilities: (environment) => {
      environments.push(environment);
      const capabilities: Capabilities = {
        digital: {
          digitalWrite: (pin, level) => environment.drivePin(pin, level),
          digitalRead: (pin) => environment.simulation()?.pinReads[pin] ?? 0,
        },
      };
      provided.push(capabilities);
      return capabilities;
    },
  });
  const published: RunSnapshot[] = [];
  session.subscribe((snapshot) => published.push(snapshot));
  const digital = (index = 0) => (provided[index] as Capabilities).digital as NonNullable<Capabilities['digital']>;
  return { session, environments, published, digital, env: (index = 0) => environments[index] as RunEnvironment };
}

describe('a pin capability built on the environment', () => {
  it('drives a pin of its board, the circuit follows, and the snapshot is published once', () => {
    const { session, published, digital } = pinSession();
    expect(session.start(pinCircuit())).toEqual({ ok: true });
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: false });
    const before = published.length;

    digital().digitalWrite('P0', 1);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: true });
    expect(published).toHaveLength(before + 1);
    expect(lastInputs()).toMatchObject({ powered: true, pinOutputs: { P0: 1 } });

    digital().digitalWrite('P0', 0);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: false });
    session.stop();
  });

  it('writes a level only when it changes, and only on a pin of the board', () => {
    const { session, published, digital } = pinSession();
    session.start(pinCircuit());
    digital().digitalWrite('P0', 1);
    const before = published.length;
    const calls = simulateSpy.mock.calls.length;

    digital().digitalWrite('P0', 1);
    for (const pin of ['P9', 'p0', 'D13', '', 'constructor', '__proto__']) {
      digital().digitalWrite(pin, 1);
    }
    expect(published).toHaveLength(before);
    expect(simulateSpy.mock.calls.length).toBe(calls);
    session.stop();
  });

  it('reads the pins as last simulated: a program write and a pressed button are both seen', () => {
    const { session, digital } = pinSession();
    session.start(pinCircuit());
    expect(digital().digitalRead('P0')).toBe(0);
    expect(digital().digitalRead('P1')).toBe(0);

    digital().digitalWrite('P0', 1);
    expect(digital().digitalRead('P0')).toBe(1);

    session.setComponentInput('btn-1', hold(true));
    expect(digital().digitalRead('P1')).toBe(1);
    session.setComponentInput('btn-1', hold(false));
    expect(digital().digitalRead('P1')).toBe(0);
    session.stop();
  });

  it('is one simulation, not two: what a capability reads says what the snapshot shows, as a copy of its own (CP-A1)', () => {
    const { session, env } = pinSession();
    session.start(pinCircuit());
    env().drivePin('P0', 1);
    expect(env().simulation()).toEqual(session.getSnapshot().simulation);
    expect(env().simulation()).not.toBe(session.getSnapshot().simulation);
    session.stop();
  });

  it('does nothing while the factory runs, because the run does not exist yet', () => {
    const seen: (RunSnapshot['simulation'] | 'untouched')[] = [];
    const session = createRunSession(seamRegistryWithSimulatedBoard, {
      profiles: seamProfiles,
      capabilities: (environment) => {
        seen.push(environment.simulation());
        environment.drivePin('P0', 1);
        return {};
      },
    });
    session.start(pinCircuit());
    expect(seen).toEqual([null]);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: false });
    session.stop();
  });
});

describe('the simulation access belongs to its run', () => {
  it('is dead once the run was replaced: it cannot drive the new run, and reads nothing', () => {
    const { session, published, env, digital } = pinSession();
    session.start(pinCircuit());
    digital(0).digitalWrite('P0', 1);
    session.start(pinCircuit());
    const before = published.length;

    digital(0).digitalWrite('P0', 1);
    env(0).drivePin('P0', 1);
    expect(env(0).simulation()).toBeNull();
    expect(digital(0).digitalRead('P0')).toBe(0);
    expect(published).toHaveLength(before);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: false });
    expect(lastInputs()).toMatchObject({ pinOutputs: {} });

    // The new run's own capability drives it, and does not see the old run's level.
    expect(digital(1).digitalRead('P0')).toBe(0);
    digital(1).digitalWrite('P0', 1);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: true });
    session.stop();
  });

  it('is dead after Stop: no write, no snapshot, no simulation', () => {
    const { session, published, env, digital } = pinSession();
    session.start(pinCircuit());
    session.stop();
    const before = published.length;
    digital().digitalWrite('P0', 1);
    expect(env().simulation()).toBeNull();
    expect(published).toHaveLength(before);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
  });

  it('is dead for a run whose factory threw', () => {
    const seen: RunEnvironment[] = [];
    const session = createRunSession(seamRegistryWithSimulatedBoard, {
      profiles: seamProfiles,
      capabilities: (environment) => {
        seen.push(environment);
        throw new Error('boom');
      },
    });
    expect(session.start(pinCircuit())).toMatchObject({ ok: false });
    (seen[0] as RunEnvironment).drivePin('P0', 1);
    expect((seen[0] as RunEnvironment).simulation()).toBeNull();
    expect(session.getSnapshot().simulation).toBeNull();
  });

  it('survives the end of the program like the board does (E6): the pins still answer until Stop', async () => {
    const { session, digital } = pinSession();
    session.start({ ...pinCircuit(), program: seamDocument().program });
    await vi.advanceTimersByTimeAsync(0);
    digital().digitalWrite('P0', 1);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: true });
    session.stop();
  });

  it('a subscriber that stops from inside a pin notice leaves the session idle, and the capability is dead', () => {
    const { session, published, digital } = pinSession();
    session.start(pinCircuit());
    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        session.stop();
      }
    });
    const before = published.length;
    digital().digitalWrite('P0', 1);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    expect(published.slice(before).filter((snapshot) => snapshot.status === 'idle')).toHaveLength(1);
    digital().digitalWrite('P0', 0);
    expect(session.getSnapshot().simulation).toBeNull();
  });

  it('a subscriber that starts from inside a pin notice keeps the new run, which does not inherit the level', () => {
    const { session, environments, digital } = pinSession();
    session.start(pinCircuit());
    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(pinCircuit())).toEqual({ ok: true });
      }
    });
    digital(0).digitalWrite('P0', 1);
    expect(environments).toHaveLength(2);
    expect(session.getSnapshot()).toMatchObject({ status: 'running' });
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: false });
    digital(0).digitalWrite('P0', 0);
    digital(0).digitalWrite('P0', 1);
    expect(session.getSnapshot().simulation?.components['led-1']).toEqual({ lit: false });
    session.stop();
  });
});

describe('the input of a circuit component other than a contact (SimulationInputs.inputs)', () => {
  const sliderPart = (id: string) => ({ id, deviceType: 'test-ybc-slider', position: at });
  const environments = () => {
    const seen: RunEnvironment[] = [];
    const session = createRunSession(seamRegistry, {
      profiles: seamProfiles,
      capabilities: (environment) => {
        seen.push(environment);
        return {};
      },
    });
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    return { session, seen, published };
  };

  it('is kept for a component whose model takes it, reaches the simulation and republishes, once per change', () => {
    const { session, seen, published } = environments();
    session.start(seamDocument([ybcBoard, sliderPart('slider-1')]));
    expect(lastInputs()).toMatchObject({ inputs: {} });
    const before = published.length;

    session.setComponentInput('slider-1', slider(40));
    expect(lastInputs()).toMatchObject({ inputs: { 'slider-1': slider(40) }, contacts: {} });
    expect(published).toHaveLength(before + 1);
    expect((seen[0] as RunEnvironment).input('slider-1')).toEqual(slider(40));

    session.setComponentInput('slider-1', slider(40));
    expect(published).toHaveLength(before + 1);
    session.setComponentInput('slider-1', slider(41));
    expect(lastInputs()).toMatchObject({ inputs: { 'slider-1': slider(41) } });
    expect(published).toHaveLength(before + 2);
    session.stop();
  });

  it('ignores the kinds the model does not take, a component that takes none, and malformed input', () => {
    const { session, published } = environments();
    session.start(
      seamDocument([ybcBoard, sliderPart('slider-1'), { id: 'led-1', deviceType: 'test-ybc-led', position: at }, { id: 'btn-1', deviceType: 'test-ybc-button', position: at }]),
    );
    const before = published.length;
    const attempts: [string, unknown][] = [
      ['slider-1', hold(true)],
      ['slider-1', { kind: 'tilt', x: 1, y: 1 }],
      ['slider-1', { kind: 'gesture' }],
      ['slider-1', { kind: 'slider', value: 1.5 }],
      ['slider-1', null],
      ['led-1', slider(3)],
      ['led-1', hold(true)],
      // A contact takes a hold and nothing else.
      ['btn-1', slider(3)],
    ];
    for (const [id, input] of attempts) {
      session.setComponentInput(id, input as never);
    }
    expect(published).toHaveLength(before);
    expect(lastInputs()).toMatchObject({ inputs: {}, contacts: {} });
    session.stop();
  });

  it('leaves a contact to `contacts` exactly as before: the hold is not copied into `inputs`', () => {
    const { session } = environments();
    session.start(seamDocument([ybcBoard, { id: 'btn-1', deviceType: 'test-ybc-button', position: at }]));
    session.setComponentInput('btn-1', hold(true));
    expect(lastInputs()).toMatchObject({ contacts: { 'btn-1': true }, inputs: {} });
    expect(session.getSnapshot().simulation?.components['btn-1']).toEqual({ closed: true });
    session.stop();
  });

  it('keeps the inputs of a run with the run: a replacing run starts with none, and the old environment reads none', () => {
    const { session, seen } = environments();
    session.start(seamDocument([ybcBoard, sliderPart('slider-1')]));
    session.setComponentInput('slider-1', slider(70));

    session.start(seamDocument([ybcBoard, sliderPart('slider-1')]));
    expect(lastInputs()).toMatchObject({ inputs: {} });
    expect((seen[1] as RunEnvironment).input('slider-1')).toBeUndefined();
    expect((seen[0] as RunEnvironment).input('slider-1')).toBeUndefined();

    session.stop();
    session.setComponentInput('slider-1', slider(5));
    expect(session.getSnapshot().simulation).toBeNull();
  });

  it('does not simulate again for an onboard part, whose input the circuit does not see', () => {
    const { session, published } = environments();
    session.start(seamDocument([ybcBoard, sliderPart('slider-1')]));
    session.setComponentInput('slider-1', slider(10));
    const calls = simulateSpy.mock.calls.length;
    const before = published.length;
    session.setComponentInput(`${boardId}/light`, slider(55));
    expect(simulateSpy.mock.calls.length).toBe(calls);
    expect(published).toHaveLength(before);
    session.stop();
  });

  // The circuit wins an id (YBCP-R1): a component id is free text, a slash does not make it `<board>/<part>`.
  describe.each(['slider-1', 'saved/slider', 'foo/bar/baz', 'board/light', 'ybc-board-1/button-a', 'ybc-board-1/display'])('a slider part called "%s"', (id) => {
    it('takes the slider of the circuit component, never as an onboard part', () => {
      const { session, seen } = environments();
      session.start(seamDocument([ybcBoard, sliderPart(id)]));
      session.setComponentInput(id, slider(33));
      expect(lastInputs()).toMatchObject({ inputs: { [id]: slider(33) } });
      expect((seen[0] as RunEnvironment).input(id)).toEqual(slider(33));
      session.stop();
    });

    it('does not take what the onboard part of that name would take, and counts no press', () => {
      const { session, seen } = environments();
      session.start(seamDocument([ybcBoard, sliderPart(id)]));
      session.setComponentInput(id, hold(true));
      expect(lastInputs()).toMatchObject({ inputs: {} });
      expect((seen[0] as RunEnvironment).input(id)).toBeUndefined();
      expect((seen[0] as RunEnvironment).takePresses(id)).toBe(0);
      session.stop();
    });
  });
});

describe('a generic run is untouched by the input plane (GB4, GB6)', () => {
  it('passes the contacts and no other input, and gives the snapshot the circuit gives', () => {
    const registry = createDeviceRegistry(localDeviceDefinitions);
    const sample = projectDocumentSchema.parse(buttonDirectSample);
    const session = createRunSession(registry);
    session.start(sample);
    session.setContactInput('button', true);
    expect(lastInputs()).toEqual({ powered: true, pinOutputs: {}, contacts: { button: true }, inputs: {} });
    expect(session.getSnapshot().simulation?.components.button).toEqual({ closed: true });
    // Nothing an onboard-looking id could do to a generic run.
    session.setComponentInput('ybc-board-1/light', slider(5));
    session.setComponentInput('led', slider(5));
    expect(lastInputs()).toMatchObject({ inputs: {} });
    session.stop();
  });
});

describe('the capabilities and services of a run are the ones the environment names', () => {
  it('hands the interpreter the very capability objects the factory built on the environment, with the very services', () => {
    const { session, env, digital } = pinSession();
    session.start(pinCircuit());
    const [, capabilities, services] = interpreterSpy.mock.calls.at(-1) ?? [];
    expect(capabilities?.digital).toBe(digital());
    expect(services).toBe(env().services);
    session.stop();
  });

  it('still drops an implementation of a capability the board does not have, and keeps one the factory provides for one it has', () => {
    const session = createRunSession(seamRegistry, {
      profiles: seamProfiles,
      capabilities: () => ({ digital: { digitalWrite: () => {}, digitalRead: () => 0 }, servo: { servoWrite: () => {} } }),
    });
    session.start(seamDocument());
    const [, capabilities] = interpreterSpy.mock.calls.at(-1) ?? [];
    expect(Object.keys(capabilities ?? {})).toEqual(['digital']);
    session.stop();
  });

  it('gives a run with no factory the same environment-free behaviour as before', () => {
    const session = createRunSession(seamRegistry, { profiles: seamProfiles });
    expect(session.start(seamDocument())).toEqual({ ok: true });
    const [, capabilities] = interpreterSpy.mock.calls.at(-1) ?? [];
    expect(capabilities).toEqual({});
    session.stop();
  });
});
