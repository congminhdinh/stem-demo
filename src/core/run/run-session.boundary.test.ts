import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ledOnSample from '../../samples/led-on.project.json';
import { projectDocumentSchema } from '../circuit/document';
import type { Capabilities, DigitalIO } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { num, print, program } from '../program/__fixtures__/ybc-blocks';
import * as interpreter from '../program/ybc-interpreter';
import { createRunSession, type RunEnvironment } from './run-session';

// YBCP-R3: ONE canonical runtime boundary (plan §9.0, §10). RunSession creates the services of a run once, hands the
// same RuntimeServices (budget included) to the capability factory and to `runYbcProgram(ir, capabilities, services)`,
// and the Capabilities it gives the interpreter are the ones it composed. The production path is exercised: the
// interpreter is spied on (it still runs), not replaced.

vi.mock('../program/ybc-interpreter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../program/ybc-interpreter')>();
  return { ...original, runYbcProgram: vi.fn(original.runYbcProgram) };
});

type Call = Parameters<typeof interpreter.runYbcProgram>;

const registry = createDeviceRegistry(localDeviceDefinitions);
const ybc = () => fixtureDocument('ybc-basic', { blocks: program([print(num(1))]) });
const digital: DigitalIO = { digitalWrite: () => {}, digitalRead: () => 0 };
const spy = vi.mocked(interpreter.runYbcProgram);
const lastCall = () => spy.mock.calls.at(-1) as Call;

beforeEach(() => {
  vi.useFakeTimers();
  spy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

function recordingSession(provided: Capabilities = { digital }) {
  const environments: RunEnvironment[] = [];
  const session = createRunSession(registry, {
    capabilities: (environment) => {
      environments.push(environment);
      return provided;
    },
  });
  return { session, environments };
}

describe('the interpreter boundary: runYbcProgram(ir, capabilities, services)', () => {
  it('receives the very RuntimeServices the capability factory got, budget included, and the capabilities the session composed', () => {
    const { session, environments } = recordingSession();
    expect(session.start(ybc())).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const [ir, capabilities, services] = lastCall();

    expect(ir.onStart).toHaveLength(1);
    expect(services).toBe((environments[0] as RunEnvironment).services);
    expect(typeof services.budget.step).toBe('function');
    // The board has `digital`, so the implementation is kept: the interpreter gets the composed capabilities.
    expect(capabilities).toEqual({ digital });
    expect(capabilities.digital).toBe(digital);
    session.stop();
  });

  it('gives the interpreter no capability the board does not have', () => {
    const { session } = recordingSession({ digital, servo: { servoWrite: () => {} } });
    session.start(ybc());
    expect(Object.keys(lastCall()[1])).toEqual(['digital']);
    session.stop();
  });

  it('runs without a factory exactly as YB-2 did: empty capabilities, the same services shape', async () => {
    const session = createRunSession(registry);
    session.start(ybc());
    const [, capabilities, services] = lastCall();
    expect(capabilities).toEqual({});
    expect(Object.keys(services).sort()).toEqual(['budget', 'clock', 'console', 'scheduler', 'signal', 'sleep']);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', console: { lines: ['1'] } });
  });

  it('is never used for a generic run: it keeps the legacy interpreter and its single DigitalIO', () => {
    const { session, environments } = recordingSession();
    expect(session.start(projectDocumentSchema.parse(ledOnSample))).toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
    expect(environments).toEqual([]);
  });
});

describe('one run, one set of services', () => {
  const servicesOf = () => lastCall()[2] as RuntimeServices;

  it('gives every run a fresh budget, scheduler and cancellation: nothing leaks from run A into run B', () => {
    const { session } = recordingSession();
    session.start(ybc());
    const a = servicesOf();
    session.start(ybc());
    const b = servicesOf();
    expect(b).not.toBe(a);
    expect(b.budget).not.toBe(a.budget);
    expect(b.scheduler).not.toBe(a.scheduler);
    expect(b.signal).not.toBe(a.signal);
    // Replacing a run ends it: its cancellation, its scheduler.
    expect(a.signal.aborted).toBe(true);
    expect(a.scheduler.disposed).toBe(true);
    expect(() => a.budget.step()).toThrow();
    // The new run is alive.
    expect(b.signal.aborted).toBe(false);
    expect(b.scheduler.disposed).toBe(false);
    expect(b.budget.step()).toBeUndefined();
    session.stop();
  });

  it('ends the budget, the scheduler and the signal together on Stop: one cancellation owner', () => {
    const { session } = recordingSession();
    session.start(ybc());
    const services = servicesOf();
    expect(services.signal.aborted).toBe(false);
    session.stop();
    expect(services.signal.aborted).toBe(true);
    expect(services.scheduler.disposed).toBe(true);
    expect(() => services.budget.step()).toThrow();
  });

  it('shares the console between the program and the capabilities, with one notice per burst', async () => {
    const { session, environments } = recordingSession();
    const seen: number[] = [];
    session.subscribe((snapshot) => seen.push(snapshot.console?.lines.length ?? -1));
    session.start(ybc());
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().console?.lines).toEqual(['1']);
    const before = seen.length;
    const sink = (environments[0] as RunEnvironment).services.console;
    sink.write('a');
    sink.write('b');
    // Two writes before anybody reads: one notice; the read brings the console up to date.
    expect(seen.length).toBe(before + 1);
    expect(session.getSnapshot().console?.lines).toEqual(['1', 'a', 'b']);
    session.stop();
  });
});

describe('a capability factory that fails', () => {
  it('leaves nothing behind: services cancelled, a sanitized diagnostic, an idle session, and the next run works', async () => {
    const seen: RunEnvironment[] = [];
    let fail = true;
    const session = createRunSession(registry, {
      capabilities: (environment) => {
        seen.push(environment);
        if (fail) {
          throw new Error('secret internal detail');
        }
        return {};
      },
    });

    const result = session.start(ybc());
    expect(result).toEqual({ ok: false, reason: 'compile-error', diagnostics: [{ severity: 'error', code: 'internal-error', message: 'The board could not be set up.' }] });
    expect(JSON.stringify(result)).not.toContain('secret');
    const services = (seen[0] as RunEnvironment).services;
    expect(services.signal.aborted).toBe(true);
    expect(services.scheduler.disposed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });

    fail = false;
    expect(session.start(ybc())).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', console: { lines: ['1'] } });
    expect(spy).toHaveBeenCalledTimes(1);
    session.stop();
  });
});
