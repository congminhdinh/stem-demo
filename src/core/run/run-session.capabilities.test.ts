import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import buttonDirectSample from '../../samples/button-direct.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { projectDocumentSchema } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { add, getVar, num, print, program, setVar, text } from '../program/__fixtures__/ybc-blocks';
import { createRunSession, type CapabilityFactory, type RunEnvironment } from './run-session';

// YB-CP deliverables 2 and 6: the extension points of RunSession (capability composition, the run's
// scheduler, the general runtime input). No peripheral exists: the factories here are test doubles.

const registry = createDeviceRegistry(localDeviceDefinitions);
const ybc = (blocks: unknown = program([print(num(1))], [])) => fixtureDocument('ybc-basic', { blocks });
const boardId = 'ybc-board-1';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A session whose factory records what it was given. */
function sessionWithSpy() {
  const environments: RunEnvironment[] = [];
  const capabilities: CapabilityFactory = (environment) => {
    environments.push(environment);
    return {};
  };
  return { session: createRunSession(registry, { capabilities }), environments };
}

describe('the capability factory', () => {
  it('is called once for a Yolo:Bit-compatible run, with its board, the board capabilities and the runtime services', () => {
    const { session, environments } = sessionWithSpy();
    expect(session.start(ybc())).toEqual({ ok: true });
    expect(environments).toHaveLength(1);
    const [environment] = environments as [RunEnvironment];
    expect(environment.board.id).toBe(boardId);
    expect(environment.capabilitySet).toEqual(['digital', 'analogIn', 'pwm', 'servo', 'display', 'buttons', 'light', 'sound', 'temperature', 'motion']);
    expect(Object.keys(environment.services).sort()).toEqual(['budget', 'clock', 'console', 'randomInt', 'scheduler', 'signal', 'sleep', 'warn']);
    expect(typeof environment.services.clock.now()).toBe('number');
    expect(environment.services.scheduler.disposed).toBe(false);
    session.stop();
  });

  it('is never called for a generic run, a run that does not compile, or a document with no board', () => {
    const { session, environments } = sessionWithSpy();
    expect(session.start(projectDocumentSchema.parse(ledOnSample))).toEqual({ ok: true });
    session.stop();
    expect(session.start(ybc(program([setVar('x', text('hi'))])))).toMatchObject({ ok: false, reason: 'compile-error' });
    expect(session.start(fixtureDocument('ybc-basic', { components: [] }))).toMatchObject({ ok: false, reason: 'no-board' });
    expect(environments).toEqual([]);
  });

  it('gives the program the same console the snapshot shows: a service of the run, not a copy', async () => {
    const { session, environments } = sessionWithSpy();
    session.start(ybc(program([print(text('from the program'))])));
    await vi.advanceTimersByTimeAsync(0);
    (environments[0] as RunEnvironment).services.console.write('from a capability');
    expect(session.getSnapshot().console?.lines).toEqual(['from the program', 'from a capability']);
  });

  it('does not start a run whose factory throws, and says so as a structured diagnostic', () => {
    const session = createRunSession(registry, {
      capabilities: () => {
        throw new Error('boom');
      },
    });
    const result = session.start(ybc());
    expect(result).toEqual({ ok: false, reason: 'compile-error', diagnostics: [{ severity: 'error', code: 'internal-error', message: 'The board could not be set up.' }] });
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
  });

  it('runs exactly as before without a factory (the YB-2 behaviour)', async () => {
    const session = createRunSession(registry);
    expect(session.start(ybc(program([setVar('x', num(1)), print(add(getVar('x'), num(2)))])))).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', console: { lines: ['3'] } });
  });
});

describe('the scheduler of a run', () => {
  it('fires its tasks while the run lasts, and not after Stop', async () => {
    const { session, environments } = sessionWithSpy();
    session.start(ybc());
    const { scheduler } = (environments[0] as RunEnvironment).services;
    const fired: string[] = [];
    scheduler.schedule(() => fired.push('early'), 100);
    scheduler.schedule(() => fired.push('late'), 500);
    await vi.advanceTimersByTimeAsync(200);
    expect(fired).toEqual(['early']);

    session.stop();
    expect(scheduler.disposed).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fired).toEqual(['early']);
    scheduler.schedule(() => fired.push('after stop'), 1)();
    await vi.advanceTimersByTimeAsync(10);
    expect(fired).toEqual(['early']);
  });

  it('is replaced with the run: starting again cancels the old run\'s timers and gives the new run its own scheduler', async () => {
    const { session, environments } = sessionWithSpy();
    session.start(ybc());
    const first = (environments[0] as RunEnvironment).services.scheduler;
    const task = vi.fn();
    first.schedule(task, 300);
    session.start(ybc());
    const second = (environments[1] as RunEnvironment).services.scheduler;
    expect(first.disposed).toBe(true);
    expect(second).not.toBe(first);
    expect(second.disposed).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).not.toHaveBeenCalled();
    session.stop();
  });

  it('survives the end of the program: the board stays powered until Stop (E6), so its timers do too', async () => {
    const { session, environments } = sessionWithSpy();
    session.start(ybc(program([print(num(1))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().status).toBe('finished');
    const { scheduler } = (environments[0] as RunEnvironment).services;
    expect(scheduler.disposed).toBe(false);
    const task = vi.fn();
    scheduler.schedule(task, 50);
    await vi.advanceTimersByTimeAsync(60);
    expect(task).toHaveBeenCalledTimes(1);
    session.stop();
  });
});

describe('setComponentInput', () => {
  it('is what setContactInput was: a hold on a contact of the circuit closes it, and the wrapper is the same call', () => {
    const buttonDirect = projectDocumentSchema.parse(buttonDirectSample);
    const session = createRunSession(registry);
    session.start(buttonDirect);
    const closedOf = () => session.getSnapshot().simulation?.components.button?.closed;
    expect(closedOf()).toBe(false);
    session.setComponentInput('button', { kind: 'hold', closed: true });
    expect(closedOf()).toBe(true);
    session.setContactInput('button', false);
    expect(closedOf()).toBe(false);
    // A contact takes a hold and nothing else.
    session.setComponentInput('button', { kind: 'slider', value: 1 });
    session.setComponentInput('button', { kind: 'gesture' });
    expect(closedOf()).toBe(false);
  });

  it('keeps the input of an onboard part for the capabilities of the run, and gives a new run none', () => {
    const { session, environments } = sessionWithSpy();
    session.start(ybc());
    const environment = environments[0] as RunEnvironment;
    expect(environment.input(`${boardId}/button-a`)).toBeUndefined();

    session.setComponentInput(`${boardId}/button-a`, { kind: 'hold', closed: true });
    session.setComponentInput(`${boardId}/light`, { kind: 'slider', value: 40 });
    expect(environment.input(`${boardId}/button-a`)).toEqual({ kind: 'hold', closed: true });
    expect(environment.input(`${boardId}/light`)).toEqual({ kind: 'slider', value: 40 });
    expect(environment.input(`${boardId}/button-b`)).toBeUndefined();

    session.setComponentInput(`${boardId}/button-a`, { kind: 'hold', closed: false });
    expect(environment.input(`${boardId}/button-a`)).toEqual({ kind: 'hold', closed: false });

    session.stop();
    expect(environment.input(`${boardId}/button-a`)).toBeUndefined();
    session.start(ybc());
    expect((environments[1] as RunEnvironment).input(`${boardId}/light`)).toBeUndefined();
    session.stop();
  });

  it('ignores what does not fit: the wrong kind for the part, a part that is not there, another board, a part with no control, a malformed input', () => {
    const { session, environments } = sessionWithSpy();
    session.start(ybc());
    const environment = environments[0] as RunEnvironment;
    const attempts: [string, unknown][] = [
      [`${boardId}/button-a`, { kind: 'slider', value: 3 }],
      [`${boardId}/light`, { kind: 'hold', closed: true }],
      [`${boardId}/display`, { kind: 'hold', closed: true }],
      [`${boardId}/buzzer`, { kind: 'slider', value: 3 }],
      [`${boardId}/temperature`, { kind: 'tilt', x: 1, y: 1 }],
      [`${boardId}/accelerometer`, { kind: 'slider', value: 3 }],
      // N17 B2: a shake is an event of the accelerometer, never its input.
      [`${boardId}/accelerometer`, { kind: 'gesture' }],
      [`${boardId}/accelerometer`, { kind: 'tilt', x: Number.NaN, y: 0 }],
      [`${boardId}/nothing`, { kind: 'hold', closed: true }],
      ['another-board/button-a', { kind: 'hold', closed: true }],
      [`${boardId}/light`, { kind: 'slider', value: 1.5 }],
      [`${boardId}/light`, { kind: 'slider', value: NaN }],
      [`${boardId}/light`, { kind: 'weird' }],
      [`${boardId}/light`, null],
      ['led', { kind: 'hold', closed: true }],
    ];
    for (const [id, input] of attempts) {
      session.setComponentInput(id, input as never);
      expect(environment.input(id), id).toBeUndefined();
    }
    session.stop();
  });

  it('is ignored while idle, and makes no snapshot of its own for an onboard part (no peripheral model yet)', () => {
    const { session, environments } = sessionWithSpy();
    const seen: unknown[] = [];
    session.subscribe((snapshot) => seen.push(snapshot));
    session.setComponentInput(`${boardId}/button-a`, { kind: 'hold', closed: true });
    expect(seen).toEqual([]);

    session.start(ybc());
    const before = seen.length;
    session.setComponentInput(`${boardId}/button-a`, { kind: 'hold', closed: true });
    expect(seen).toHaveLength(before);
    expect((environments[0] as RunEnvironment).input(`${boardId}/button-a`)).toBeDefined();
    session.stop();
  });
});

describe('the boundary of YB-CP: no learner-visible hardware yet', () => {
  it('shows no onboard part in the snapshot of a Yolo:Bit-compatible run', async () => {
    const { session } = sessionWithSpy();
    session.start(ybc());
    await vi.advanceTimersByTimeAsync(0);
    const components = session.getSnapshot().simulation?.components ?? {};
    expect(Object.keys(components).filter((id) => id.includes('/'))).toEqual([]);
    session.stop();
  });
});
