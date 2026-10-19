import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { buttonPressed, num, print, program, randomInt, runningTime, wait, type Json } from '../program/__fixtures__/ybc-blocks';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import { createRunSession, type CapabilityFactory, type RunEnvironment, type RunSession } from './run-session';

// N17 B4 through the production RunSession: the running time counts from the start of each run, a random number comes from
// Math.random in a normal run and from the seed a run is started with (a lab's check), and a capability can add a warning of the
// run (a floating pin) to the snapshot, once, while its run is the session's.

const registry = createDeviceRegistry(localDeviceDefinitions);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const document = (blocks: Json, profile = 'ybc-basic'): ProjectDocument => fixtureDocument(profile, { blocks });
const linesOf = (session: RunSession) => session.getSnapshot().console?.lines ?? [];

function setup() {
  const environments: RunEnvironment[] = [];
  const factory: CapabilityFactory = (environment) => {
    environments.push(environment);
    return createOnboardCapabilities(environment);
  };
  return { session: createRunSession(registry, { capabilities: factory }), environments };
}

/** Ten dice, one every 10 ms of the forever loop. */
const dice = program([], [print(randomInt(num(1), num(6)))]);

describe('the running time', () => {
  it('counts from the start of each run, in whole ms', async () => {
    const { session } = setup();
    session.start(document(program([print(runningTime()), wait(num(300)), print(runningTime())])));
    await vi.advanceTimersByTimeAsync(400);
    expect(linesOf(session)).toEqual(['0', '300']);
    await vi.advanceTimersByTimeAsync(5000);
    session.start(document(program([print(runningTime())])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['0']);
    session.stop();
  });
});

describe('random numbers', () => {
  const tenDice = async (session: RunSession, seed?: number) => {
    session.start(document(dice), seed === undefined ? undefined : { seed });
    await vi.advanceTimersByTimeAsync(95);
    const lines = linesOf(session);
    session.stop();
    return lines;
  };

  it('come from Math.random in a normal run', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { session } = setup();
    const lines = await tenDice(session);
    expect(lines).toHaveLength(10);
    expect(new Set(lines)).toEqual(new Set(['6']));
    expect(random).toHaveBeenCalled();
  });

  it('are the same in every run started with the same seed, and are not Math.random’s', async () => {
    const random = vi.spyOn(Math, 'random');
    const { session } = setup();
    const first = await tenDice(session, 2026);
    const second = await tenDice(session, 2026);
    expect(first).toHaveLength(10);
    expect(second).toEqual(first);
    expect(first.every((line) => ['1', '2', '3', '4', '5', '6'].includes(line))).toBe(true);
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(await tenDice(session, 7)).not.toEqual(first);
    expect(random).not.toHaveBeenCalled();
  });
});

describe('a warning of the run (environment.warn)', () => {
  const warning = { code: 'floating-pin', message: 'Pin P1 is floating, so it reads 0. Connect the button to 3V3 or GND.' };

  it('is added to the snapshot once, after the compile warnings, and published', async () => {
    const { session, environments } = setup();
    session.start(document(program([], [print(buttonPressed('A')), wait(num(100))])));
    await vi.advanceTimersByTimeAsync(0);
    const listener = vi.fn();
    session.subscribe(listener);
    environments[0]?.warn(warning);
    expect(session.getSnapshot().diagnostics).toEqual([{ severity: 'warning', ...warning }]);
    expect(listener).toHaveBeenCalledTimes(1);
    environments[0]?.warn(warning);
    expect(session.getSnapshot().diagnostics).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    environments[0]?.warn({ code: 'floating-pin', message: 'Pin P2 is floating, so it reads 0. Connect the button to 3V3 or GND.' });
    expect(session.getSnapshot().diagnostics).toHaveLength(2);
    session.stop();
    expect(session.getSnapshot().diagnostics).toEqual([]);
  });

  it('is kept when the program finishes', async () => {
    const { session, environments } = setup();
    session.start(document(program([wait(num(50))])));
    environments[0]?.warn(warning);
    await vi.advanceTimersByTimeAsync(100);
    expect(session.getSnapshot()).toMatchObject({ status: 'finished', diagnostics: [{ severity: 'warning', ...warning }] });
    session.stop();
  });

  it('does nothing for a run that is over or replaced', async () => {
    const { session, environments } = setup();
    session.start(document(program([], [wait(num(100))])));
    session.start(document(program([], [wait(num(100))])));
    environments[0]?.warn(warning);
    expect(session.getSnapshot().diagnostics).toEqual([]);
    session.stop();
    environments[1]?.warn(warning);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', diagnostics: [] });
  });
});
