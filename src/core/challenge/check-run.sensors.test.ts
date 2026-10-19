import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import { productionProfiles } from '../profiles';
import { createBlockPackCatalog } from '../program/block-packs';
import { clearDisplay, cmp, gestureIs, ifElif, ifThen, images, num, program, showImage, temperature, type Json } from '../program/__fixtures__/ybc-blocks';
import { createRunSession } from '../run/run-session';
import { createPinCapabilities } from '../run/ybc-pin-io';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import type { Challenge, CheckOutcome, InputStep } from './index';
import { runCheck } from './index';

// N17 B2: a check drives the new sensors the way it drives the light (N6a S2): scripted inputs to the board's parts at their time.
// `temperature` is a slider of the temperature part, `tilt` a tilt of the accelerometer (the pad) and `shake` a gesture of the
// accelerometer (the "Lắc" button): true for 1 s from the moment it is given. Real runs: the production session and the
// composition root's capabilities, with fake timers.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const pinCapabilities = createPinCapabilities(registry);
const boardId = 'ybc-board-1';
const full = images.FULL.join(':');
const cross = images.CROSS.join(':');
const blank = '00000:00000:00000:00000:00000';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const document = (blocks: Json): ProjectDocument => fixtureDocument('ybc-advanced', { blocks });

async function check(blocks: Json, challenge: Challenge): Promise<CheckOutcome> {
  const session = createRunSession(registry, {
    profiles: productionProfiles,
    packs,
    capabilities: (environment) => ({ ...createOnboardCapabilities(environment), ...pinCapabilities(environment) }),
  });
  const run = runCheck({ session, document: document(blocks), challenge, boardId });
  await vi.advanceTimersByTimeAsync(challenge.durationMs + 50);
  const outcome = await run.done;
  expect(session.getSnapshot().status).toBe('idle');
  return outcome;
}

const passed = (outcome: CheckOutcome) => (outcome.status === 'checked' ? outcome.result.goals.map((goal) => [goal.id, goal.passed]) : null);

const shakeAt = (atMs: number): InputStep => ({ atMs, part: 'accelerometer', input: { kind: 'gesture' } });
/** Shows the full picture while the board is shaken, and nothing otherwise. */
const shakeShowsFull = program([], [ifThen(gestureIs('shake'), [showImage(images.FULL)], [clearDisplay()])]);

describe('a scripted shake', () => {
  const challenge: Challenge = {
    durationMs: 1500,
    inputScript: [shakeAt(300)],
    goals: [
      { id: 'shaken-shows-full', kind: 'display-shows', frame: full, fromMs: 300, label: 'Shaken: full' },
      { id: 'still-again-clears', kind: 'display-shows', frame: blank, fromMs: 1400, label: 'Still again: clear' },
    ],
  };

  it('at 300 ms makes the goal pass: the board is shaken from 300 ms, and still again 1 s later', async () => {
    expect(passed(await check(shakeShowsFull, challenge))).toEqual([['shaken-shows-full', true], ['still-again-clears', true]]);
  });

  it('is what makes it pass: without it the program never shows the picture', async () => {
    expect(passed(await check(shakeShowsFull, { ...challenge, inputScript: [] }))).toEqual([['shaken-shows-full', false], ['still-again-clears', true]]);
  });

  it('comes at its time and not before: a check that ends at 290 ms has not seen it', async () => {
    const early: Challenge = { ...challenge, durationMs: 290, goals: [{ id: 'full', kind: 'display-shows', frame: full, label: 'Full' }] };
    expect(passed(await check(shakeShowsFull, early))).toEqual([['full', false]]);
  });

  it('fails a program that does not look at the shake', async () => {
    expect(passed(await check(program([], [clearDisplay()]), challenge))).toEqual([['shaken-shows-full', false], ['still-again-clears', true]]);
  });
});

describe('a scripted temperature and tilt', () => {
  it('gives the temperature part a reading: 30 °C at 200 ms passes "above 28 shows the full picture"', async () => {
    const hot = program([], [ifThen(cmp('GT', temperature(), num(28)), [showImage(images.FULL)], [clearDisplay()])]);
    const challenge: Challenge = {
      durationMs: 1000,
      inputScript: [
        { atMs: 200, part: 'temperature', input: { kind: 'slider', value: 30 } },
        { atMs: 600, part: 'temperature', input: { kind: 'slider', value: 20 } },
      ],
      goals: [
        { id: 'hot', kind: 'display-shows', frame: full, fromMs: 200, label: 'Hot' },
        { id: 'cool-again', kind: 'display-shows', frame: blank, fromMs: 650, label: 'Cool again' },
      ],
    };
    expect(passed(await check(hot, challenge))).toEqual([['hot', true], ['cool-again', true]]);
    // At the 25 °C a run starts with, the program shows nothing.
    expect(passed(await check(hot, { ...challenge, inputScript: [] }))).toEqual([['hot', false], ['cool-again', true]]);
  });

  it('gives the accelerometer a tilt: tilted left at 300 ms shows the cross; a shake on top does not undo the tilt', async () => {
    const tilted = program([], [ifElif([[gestureIs('shake'), [showImage(images.FULL)]], [gestureIs('tilt_left'), [showImage(images.CROSS)]]], [clearDisplay()])]);
    const challenge: Challenge = {
      durationMs: 2000,
      inputScript: [{ atMs: 300, part: 'accelerometer', input: { kind: 'tilt', x: -800, y: 0 } }, shakeAt(500)],
      goals: [
        { id: 'tilted', kind: 'display-shows', frame: cross, fromMs: 300, label: 'Tilted' },
        { id: 'shaken', kind: 'display-shows', frame: full, fromMs: 500, label: 'Shaken' },
        { id: 'tilted-after-the-shake', kind: 'display-shows', frame: cross, fromMs: 1550, label: 'Tilted again' },
      ],
    };
    expect(passed(await check(tilted, challenge))).toEqual([['tilted', true], ['shaken', true], ['tilted-after-the-shake', true]]);
  });
});
