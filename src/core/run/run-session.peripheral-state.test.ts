import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ledOnSample from '../../samples/led-on.project.json';
import { projectDocumentSchema } from '../circuit/document';
import { blankFrame, type Frame } from '../capabilities/frame';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { num, print, program } from '../program/__fixtures__/ybc-blocks';
import { simulateCircuit, type ComponentState } from '../simulation/simulate-circuit';
import { boardId, seamDocument, seamProfiles, seamRegistry, ybcBoard } from './__fixtures__/seam-fixtures';
import { createRunSession, type RunEnvironment, type RunSession, type RunSnapshot } from './run-session';

// YB-CP amendment 1: the path by which an onboard part of a Yolo:Bit-compatible board puts its state into the snapshot
// (`RunEnvironment.report`). Only the transport is tested: the states below are made up, there is no display, buzzer or
// light model. The path is per run, synchronous, and honours R4: a listener may start or stop while it publishes.

const display = `${boardId}/display`;
const buzzer = `${boardId}/buzzer`;
const light = `${boardId}/light`;
const lit = (index: number): Frame => ({ pixels: blankFrame().pixels.map((_, at) => (at === index ? '#FF0000' : null)) });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** `cleanup` runs when a run's signal aborts, as a peripheral turning itself off would. */
function setup(cleanup?: (environment: RunEnvironment) => void) {
  const environments: RunEnvironment[] = [];
  const session = createRunSession(seamRegistry, {
    profiles: seamProfiles,
    capabilities: (environment) => {
      environments.push(environment);
      if (cleanup) {
        environment.services.signal.addEventListener('abort', () => cleanup(environment));
      }
      return {};
    },
  });
  const published: RunSnapshot[] = [];
  session.subscribe((snapshot) => published.push(snapshot));
  const env = (index: number) => environments[index] as RunEnvironment;
  return { session, environments, env, published };
}

const stateOf = (session: RunSession, id: string): ComponentState | undefined => session.getSnapshot().simulation?.components[id];

describe('report puts the state of an onboard part in the snapshot', () => {
  it('shows it under <board>/<peripheral> and publishes once', () => {
    const { session, env, published } = setup();
    session.start(seamDocument());
    const before = published.length;
    env(0).report(display, { frame: lit(12) });
    expect(stateOf(session, display)).toEqual({ frame: lit(12) });
    expect(published).toHaveLength(before + 1);
    expect(published.at(-1)?.simulation?.components[display]).toEqual({ frame: lit(12) });
    session.stop();
  });

  it('keeps the status of the run it reports into, also after the program finished', async () => {
    const { session, env } = setup();
    session.start(fixtureDocument('test-seams', { components: [ybcBoard], blocks: program([print(num(1))]) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().status).toBe('finished');
    env(0).report(buzzer, { hz: 440 });
    expect(session.getSnapshot()).toMatchObject({ status: 'finished' });
    expect(stateOf(session, buzzer)).toEqual({ hz: 440 });
    session.stop();
  });

  it('replaces the whole state of the part with the next one, and keeps parts apart', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    env(0).report(display, { frame: lit(0), brightness: 0.5 });
    env(0).report(buzzer, { hz: 262 });
    env(0).report(display, { frame: lit(24) });
    expect(stateOf(session, display)).toEqual({ frame: lit(24) });
    expect(stateOf(session, buzzer)).toEqual({ hz: 262 });
    env(0).report(light, { value: 40 });
    expect(Object.keys(session.getSnapshot().simulation?.components ?? {}).sort()).toEqual([buzzer, display, light].sort());
    session.stop();
  });

  it('removes a state with null, and says so only when there was one', () => {
    const { session, env, published } = setup();
    session.start(seamDocument());
    env(0).report(buzzer, { hz: 440 });
    const before = published.length;
    env(0).report(buzzer, null);
    expect(stateOf(session, buzzer)).toBeUndefined();
    expect(published).toHaveLength(before + 1);
    env(0).report(buzzer, null);
    env(0).report(display, null);
    expect(published).toHaveLength(before + 1);
    session.stop();
  });

  it('does not publish a state that did not change, however the object was made', () => {
    const { session, env, published } = setup();
    session.start(seamDocument());
    env(0).report(display, { frame: lit(3) });
    const before = published.length;
    env(0).report(display, { frame: lit(3) });
    expect(published).toHaveLength(before);
    env(0).report(display, { frame: lit(4) });
    expect(published).toHaveLength(before + 1);
    session.stop();
  });

  it('copies what it is given: a reported object that is changed afterwards changes no snapshot', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    const pixels: (`#${string}` | null)[] = blankFrame().pixels.map(() => null);
    env(0).report(display, { frame: { pixels } });
    const first = session.getSnapshot();
    pixels[0] = '#FF0000';
    expect((stateOf(session, display)?.frame?.pixels ?? [])[0]).toBeNull();
    // The same object, reported again, is a change of the display.
    env(0).report(display, { frame: { pixels } });
    expect((stateOf(session, display)?.frame?.pixels ?? [])[0]).toBe('#FF0000');
    // And a snapshot that was published is never edited afterwards.
    expect((first.simulation?.components[display]?.frame?.pixels ?? [])[0]).toBeNull();
    session.stop();
  });

  it('makes the same snapshot for the same calls (deterministic)', () => {
    const run = () => {
      const { session, env } = setup();
      session.start(seamDocument());
      env(0).report(display, { frame: lit(7) });
      env(0).report(buzzer, { hz: 330 });
      env(0).report(display, null);
      env(0).report(light, { value: 12 });
      const snapshot = JSON.stringify(session.getSnapshot());
      session.stop();
      return snapshot;
    };
    expect(run()).toBe(run());
  });

  it('is dropped with the run: Stop leaves no state, and the next run starts without any', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    env(0).report(display, { frame: lit(1) });
    session.stop();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });

    session.start(seamDocument());
    expect(session.getSnapshot().simulation?.components).toEqual({});
    session.stop();
  });

  it('is dropped with the run it belonged to when another run replaces it', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    env(0).report(display, { frame: lit(1) });
    session.start(seamDocument());
    expect(session.getSnapshot().simulation?.components).toEqual({});
    env(1).report(buzzer, { hz: 100 });
    expect(session.getSnapshot().simulation?.components).toEqual({ [buzzer]: { hz: 100 } });
    session.stop();
  });
});

describe('report joins the states of the circuit, and the circuit wins', () => {
  const circuit = [
    ybcBoard,
    { id: 'led-1', deviceType: 'test-ybc-led', position: { x: 100, y: 100 } },
    { id: 'saved/button', deviceType: 'test-ybc-button', position: { x: 200, y: 100 } },
  ];

  it('puts the onboard states beside the states of the circuit components, which are as the simulation gives them', () => {
    const { session, env } = setup();
    session.start(seamDocument(circuit));
    const alone = session.getSnapshot().simulation?.components;
    expect(alone).toEqual({ 'led-1': { lit: false }, 'saved/button': { closed: false } });

    env(0).report(display, { frame: lit(2) });
    expect(session.getSnapshot().simulation?.components).toEqual({
      'led-1': { lit: false },
      'saved/button': { closed: false },
      [display]: { frame: lit(2) },
    });
    // The circuit keeps working next to it.
    session.setComponentInput('saved/button', { kind: 'hold', closed: true });
    expect(session.getSnapshot().simulation?.components).toMatchObject({ 'saved/button': { closed: true }, [display]: { frame: lit(2) } });
    session.stop();
  });

  it('keeps the circuit component when it has the id of an onboard part: the report is ignored and nothing is published', () => {
    const { session, env, published } = setup();
    session.start(
      seamDocument([ybcBoard, { id: display, deviceType: 'test-ybc-led', position: { x: 100, y: 100 } }]),
    );
    const before = published.length;
    env(0).report(display, { frame: lit(5) });
    env(0).report(display, null);
    expect(stateOf(session, display)).toEqual({ lit: false });
    expect(published).toHaveLength(before);
    // The board's other parts still report.
    env(0).report(buzzer, { hz: 523 });
    expect(session.getSnapshot().simulation?.components).toEqual({ [display]: { lit: false }, [buzzer]: { hz: 523 } });
    session.stop();
  });

  it('ignores an id that is not an onboard part of this board, publishing nothing', () => {
    const { session, env, published } = setup();
    session.start(seamDocument(circuit));
    const before = published.length;
    for (const id of ['display', 'led-1', 'saved/button', 'another-board/display', `${boardId}/nothing`, `${boardId}/`, '/display', '', '__proto__', 'constructor']) {
      env(0).report(id, { value: 1 });
    }
    expect(published).toHaveLength(before);
    expect(session.getSnapshot().simulation?.components).toEqual({ 'led-1': { lit: false }, 'saved/button': { closed: false } });
    session.stop();
  });

  it('cannot be used before the run exists: a report made while the factory runs is not honoured', () => {
    const reported: string[] = [];
    const session = createRunSession(seamRegistry, {
      profiles: seamProfiles,
      capabilities: (environment) => {
        environment.report(display, { frame: lit(9) });
        reported.push('factory');
        return {};
      },
    });
    session.start(seamDocument());
    expect(reported).toEqual(['factory']);
    expect(session.getSnapshot().simulation?.components).toEqual({});
    session.stop();
  });
});

describe('a generic run is exactly what it was (GB4)', () => {
  it('shows exactly the states the simulation gives, byte for byte, and no environment exists', () => {
    const registry = createDeviceRegistry(localDeviceDefinitions);
    const sample = projectDocumentSchema.parse(ledOnSample);
    const session = createRunSession(registry, {
      capabilities: () => {
        throw new Error('a generic run has no capability factory call');
      },
    });
    expect(session.start(sample)).toEqual({ ok: true });
    const direct = simulateCircuit(sample.circuit, registry, { powered: true, pinOutputs: {}, contacts: {} });
    expect(JSON.stringify(session.getSnapshot().simulation)).toBe(JSON.stringify(direct));
    expect(Object.keys(session.getSnapshot()).sort()).toEqual(['diagnostics', 'error', 'simulation', 'status']);
    session.stop();
  });
});

describe('a report from a run that is over does nothing', () => {
  it('is ignored once the run was replaced: the new run and its listeners do not see it', () => {
    const { session, env, published } = setup();
    session.start(seamDocument());
    env(0).report(display, { frame: lit(1) });
    session.start(seamDocument());
    const before = published.length;
    env(0).report(display, { frame: lit(2) });
    env(0).report(buzzer, { hz: 1 });
    env(0).report(display, null);
    expect(session.getSnapshot().simulation?.components).toEqual({});
    expect(published).toHaveLength(before);
    // The new run's own environment is the live one.
    env(1).report(buzzer, { hz: 2 });
    expect(session.getSnapshot().simulation?.components).toEqual({ [buzzer]: { hz: 2 } });
    session.stop();
  });

  it('is ignored after Stop: the session stays idle and nothing is published', () => {
    const { session, env, published } = setup();
    session.start(seamDocument());
    session.stop();
    const before = published.length;
    env(0).report(display, { frame: lit(1) });
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    expect(published).toHaveLength(before);
  });

  it('is ignored for a run whose start failed, even when its factory had the environment', () => {
    const seen: RunEnvironment[] = [];
    const session = createRunSession(seamRegistry, {
      profiles: seamProfiles,
      capabilities: (environment) => {
        seen.push(environment);
        throw new Error('boom');
      },
    });
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    expect(session.start(seamDocument())).toMatchObject({ ok: false, reason: 'compile-error' });
    const before = published.length;
    (seen[0] as RunEnvironment).report(display, { frame: lit(1) });
    expect(published).toHaveLength(before);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
  });
});

describe('reentrancy (R4): a listener may start or stop while a report is published', () => {
  it('Stop(A) → A turns itself off and reports → a subscriber starts B: B stands, A cleanup touches nothing of B', () => {
    const { session, environments, env, published } = setup((environment) => environment.report(display, null));
    session.start(seamDocument());
    env(0).report(display, { frame: lit(1) });

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(seamDocument())).toEqual({ ok: true });
      }
    });
    const before = published.length;

    expect(() => session.stop()).not.toThrow();

    // B was started by the subscriber, from A's cleanup notice.
    expect(environments).toHaveLength(2);
    const b = env(1).services;
    expect(env(0).services.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(b.scheduler.disposed).toBe(false);
    // The outer stop did not clear B or publish idle over it; B has none of A's state.
    expect(published.slice(before).some((snapshot) => snapshot.status === 'idle')).toBe(false);
    expect(session.getSnapshot().status).toBe('running');
    expect(session.getSnapshot().simulation?.components).toEqual({});
    // B is a normal run: it reports, A cannot.
    env(1).report(buzzer, { hz: 440 });
    env(0).report(buzzer, { hz: 1 });
    expect(session.getSnapshot().simulation?.components).toEqual({ [buzzer]: { hz: 440 } });
    session.stop();
    expect(b.signal.aborted).toBe(true);
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('start(B) replacing A → A reports while it is retired → a subscriber starts C: C wins, the prepared B is discarded and inert', () => {
    const { session, environments, env } = setup((environment) => environment.report(display, null));
    session.start(seamDocument());
    env(0).report(display, { frame: lit(1) });

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(seamDocument())).toEqual({ ok: true });
      }
    });

    expect(session.start(seamDocument())).toEqual({ ok: true });

    // Factories ran for A, B (prepared by the outer start) and C (the reentrant start).
    expect(environments).toHaveLength(3);
    const [b, c] = [env(1), env(2)];
    expect(b.services.signal.aborted).toBe(true);
    expect(c.services.signal.aborted).toBe(false);
    // B never became the run: whatever it reports, and whatever its own cleanup reports, reaches nobody.
    b.report(buzzer, { hz: 9 });
    expect(session.getSnapshot().simulation?.components).toEqual({});
    c.report(buzzer, { hz: 3 });
    expect(session.getSnapshot().simulation?.components).toEqual({ [buzzer]: { hz: 3 } });
    session.stop();
    expect(c.services.signal.aborted).toBe(true);
  });

  it('a subscriber that reports from inside a report notice: both states stand, nothing loops', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    let armed = true;
    let notices = 0;
    session.subscribe(() => {
      notices += 1;
      if (armed) {
        armed = false;
        env(0).report(buzzer, { hz: 440 });
      }
    });
    env(0).report(display, { frame: lit(6) });
    expect(session.getSnapshot().simulation?.components).toEqual({ [display]: { frame: lit(6) }, [buzzer]: { hz: 440 } });
    expect(notices).toBe(2);
    session.stop();
  });

  it('a subscriber that stops from inside a report notice leaves the session idle, once, and the environment dead', () => {
    const { session, env, published } = setup();
    session.start(seamDocument());
    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        session.stop();
      }
    });
    const before = published.length;
    env(0).report(display, { frame: lit(1) });
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
    expect(published.slice(before).filter((snapshot) => snapshot.status === 'idle')).toHaveLength(1);
    env(0).report(buzzer, { hz: 1 });
    expect(session.getSnapshot().simulation).toBeNull();
  });

  it('a subscriber that starts from inside a report notice: the new run stands without the old state, the old environment is dead', () => {
    const { session, env } = setup();
    session.start(seamDocument());
    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(seamDocument())).toEqual({ ok: true });
      }
    });
    env(0).report(display, { frame: lit(1) });
    expect(session.getSnapshot()).toMatchObject({ status: 'running' });
    expect(session.getSnapshot().simulation?.components).toEqual({});
    env(0).report(buzzer, { hz: 1 });
    expect(session.getSnapshot().simulation?.components).toEqual({});
    session.stop();
  });
});
