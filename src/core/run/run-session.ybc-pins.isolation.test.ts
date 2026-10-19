import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import type { ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { program } from '../program/__fixtures__/ybc-blocks';
import { RuntimeFault } from '../program/values';
import * as interpreter from '../program/ybc-interpreter';
import { createRunSession, type RunSnapshot } from './run-session';
import { createPinCapabilities } from './ybc-pin-io';

// Cross-run isolation of the pin capabilities (YB-4, plan §10): the capabilities of a run are its own. A run that
// was stopped or replaced is aborted, but whatever still holds its capabilities (a callback in flight) must not
// drive the circuit of the run that replaced it, nor read it. The interpreter is spied on (it still runs), as in
// run-session.boundary.test.ts, to get the very capabilities the session composed for each run.

vi.mock('../program/ybc-interpreter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../program/ybc-interpreter')>();
  return { ...original, runYbcProgram: vi.fn(original.runYbcProgram) };
});

const registry = createDeviceRegistry(localDeviceDefinitions);
const spy = vi.mocked(interpreter.runYbcProgram);
const capabilitiesOfLastRun = () => (spy.mock.calls.at(-1) as Parameters<typeof interpreter.runYbcProgram>)[1];
const at = { x: 0, y: 0 };
const wire = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});
const circuit = {
  components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: at }, { id: 'led-1', deviceType: 'led', position: at }],
  wires: [wire('w1', ['ybc-board-1', 'p0'], ['led-1', 'anode']), wire('w2', ['led-1', 'cathode'], ['ybc-board-1', 'gnd']), wire('w3', ['ybc-board-1', 'p1'], ['ybc-board-1', '3v3'])],
};
const running = (): ProjectDocument => ({ ...fixtureDocument('ybc-basic', { blocks: program([], []) }), circuit });

beforeEach(() => {
  vi.useFakeTimers();
  spy.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

const lit = (snapshot: RunSnapshot) => snapshot.simulation?.components['led-1']?.lit;

describe('a run that lost the session', () => {
  it('writes nothing into the run that replaced it, and reads 0, never what the new run\'s circuit says', () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(running());
    const stale = capabilitiesOfLastRun() as Required<Pick<Capabilities, 'digital' | 'analogIn'>>;
    session.start(running());
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    expect(lit(session.getSnapshot())).toBe(false);

    stale.digital.digitalWrite('P0', 1);
    expect(lit(session.getSnapshot())).toBe(false);
    expect(published).toEqual([]);
    // P1 is wired to 3V3 in the new run: a live read would say on / 4095. The stale run is told 0.
    expect(stale.digital.digitalRead('P1')).toBe(0);
    expect(stale.analogIn.analogRead('P1')).toBe(0);

    // And the new run's own pins work, so the silence above is the stale run's, not a broken circuit.
    const live = capabilitiesOfLastRun() as Required<Pick<Capabilities, 'digital' | 'analogIn'>>;
    expect(live).not.toBe(stale);
    live.digital.digitalWrite('P0', 1);
    expect(lit(session.getSnapshot())).toBe(true);
    expect(live.digital.digitalRead('P1')).toBe(1);
    expect(live.analogIn.analogRead('P1')).toBe(4095);
    session.stop();
  });

  it('writes and reads nothing after Stop either, and Stop publishes idle once, not again', () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(running());
    const stale = capabilitiesOfLastRun() as Required<Pick<Capabilities, 'digital' | 'analogIn'>>;
    session.stop();
    const published: RunSnapshot[] = [];
    session.subscribe((snapshot) => published.push(snapshot));
    stale.digital.digitalWrite('P0', 1);
    expect(stale.digital.digitalRead('P1')).toBe(0);
    expect(stale.analogIn.analogRead('P1')).toBe(0);
    expect(published).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', simulation: null });
  });

  it('gives each run capabilities of its own: never the same object, never the same pins', () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(running());
    const first = capabilitiesOfLastRun();
    session.start(running());
    const second = capabilitiesOfLastRun();
    expect(second.digital).not.toBe(first.digital);
    expect(second.analogIn).not.toBe(first.analogIn);
    session.stop();
  });
});

describe('what a run is given', () => {
  it('is the four capabilities of the header pins (N17 B5: PWM and servo), with their methods and nothing else: no event, no listener, no onboard part', () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(running());
    const caps = capabilitiesOfLastRun();
    expect(Object.keys(caps).sort()).toEqual(['analogIn', 'digital', 'pwm', 'servo']);
    expect(Object.keys(caps.digital ?? {}).sort()).toEqual(['digitalRead', 'digitalWrite']);
    expect(Object.keys(caps.analogIn ?? {}).sort()).toEqual(['analogRead']);
    expect(Object.keys(caps.pwm ?? {}).sort()).toEqual(['pwmWrite']);
    expect(Object.keys(caps.servo ?? {}).sort()).toEqual(['servoWrite']);
    session.stop();
  });
});

describe('the capability of the current run refuses what is not a pin it may use', () => {
  const live = () => {
    const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
    session.start(running());
    return { session, caps: capabilitiesOfLastRun() as Required<Pick<Capabilities, 'digital' | 'analogIn'>> };
  };
  const fault = (call: () => unknown) => {
    try {
      call();
    } catch (error) {
      return error instanceof RuntimeFault ? error.code : `not a fault: ${String(error)}`;
    }
    return 'no fault';
  };

  it.each(['P3', 'P20', 'p0', '', 'constructor', '__proto__', 'toString', 'P0 '])('refuses the name %j: out-of-domain, on every call', (name) => {
    const { session, caps } = live();
    expect(fault(() => caps.digital.digitalWrite(name, 1))).toBe('out-of-domain');
    expect(fault(() => caps.digital.digitalRead(name))).toBe('out-of-domain');
    expect(fault(() => caps.analogIn.analogRead(name))).toBe('out-of-domain');
    // Nothing was driven by the refused writes.
    expect(lit(session.getSnapshot())).toBe(false);
    session.stop();
  });

  it.each([2, -1, 0.5, Number.NaN])('refuses the level %s: a pin is set to 0 or 1 (the capability does not trust its caller)', (level) => {
    const { session, caps } = live();
    expect(fault(() => caps.digital.digitalWrite('P0', level as 0))).toBe('out-of-domain');
    expect(lit(session.getSnapshot())).toBe(false);
    session.stop();
  });

  it('still drives and reads a pin it may use (the control for the refusals above)', () => {
    const { session, caps } = live();
    expect(fault(() => caps.digital.digitalWrite('P0', 1))).toBe('no fault');
    expect(lit(session.getSnapshot())).toBe(true);
    session.stop();
  });
});
