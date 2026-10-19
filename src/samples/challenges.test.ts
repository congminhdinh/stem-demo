import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFrame, runCheck, type CheckOutcome, type CheckSession, type CheckTimers } from '../core/challenge';
import type { ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { productionProfiles } from '../core/profiles';
import { buttonPressed, colour, ifThen, program, setAll } from '../core/program/__fixtures__/ybc-blocks';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { createDefaultProgram } from '../core/program/blocks';
import { createRunSession, type RunSession } from '../core/run/run-session';
import { createPinCapabilities } from '../core/run/ybc-pin-io';
import { createOnboardCapabilities } from '../core/simulation/peripherals/onboard-capabilities';
import { templateChallenge } from './challenges';
import { createTemplateProject, templateKeys, type TemplateKey } from './templates';
import { ybcSolutionDocument, type YbcLessonKey } from './ybc-solutions';
import { ybcTemplateBoardId } from './ybc-templates';

// Every template's challenge (N6a S2) against real runs: the production session, with the capabilities the
// composition root gives it, and fake timers for the time. The generic templates are finished programs and
// pass; the Yolo:Bit starters fail until their loose block is attached (ybc-solutions.ts), and then pass.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const pinCapabilities = createPinCapabilities(registry);
const newSession = () =>
  createRunSession(registry, {
    profiles: productionProfiles,
    packs,
    capabilities: (environment) => ({ ...createOnboardCapabilities(environment), ...pinCapabilities(environment) }),
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function check(key: TemplateKey, document: ProjectDocument, options: { session?: RunSession | CheckSession; timers?: CheckTimers } = {}): Promise<CheckOutcome> {
  const challenge = templateChallenge(key, 'en');
  if (!challenge) {
    throw new Error(`${key} has no challenge`);
  }
  const session = options.session ?? newSession();
  const run = runCheck({ session, document, challenge, boardId: document.profile ? ybcTemplateBoardId : null, ...(options.timers ? { timers: options.timers } : {}) });
  await vi.advanceTimersByTimeAsync(challenge.durationMs + 2000);
  const outcome = await run.done;
  expect(session.getSnapshot().status).toBe('idle');
  return outcome;
}

const passedIds = (outcome: CheckOutcome) => (outcome.status === 'checked' ? outcome.result.goals.filter((goal) => goal.passed).map((goal) => goal.id) : null);

describe('template challenges (N6a S2)', () => {
  it('exist for every template but the empty ones', () => {
    expect(templateKeys.filter((key) => templateChallenge(key, 'vi') === null)).toEqual(['empty', 'ybc-empty']);
  });

  it.each(templateKeys.filter((key) => templateChallenge(key, 'en') !== null))('%s has goals the host can show: unique ids, labels of 1–200 characters in both languages, valid frames', (key) => {
    for (const language of ['en', 'vi'] as const) {
      const challenge = templateChallenge(key, language);
      const goals = challenge?.goals ?? [];
      expect(goals.length).toBeGreaterThan(0);
      expect(new Set(goals.map((goal) => goal.id)).size).toBe(goals.length);
      for (const goal of goals) {
        expect(goal.label.length).toBeGreaterThan(0);
        expect(goal.label.length).toBeLessThanOrEqual(200);
        if (goal.kind === 'display-shows') {
          expect(parseFrame(goal.frame)).not.toBeNull();
        }
      }
      expect(challenge?.durationMs).toBeLessThanOrEqual(5000);
    }
  });

  it('gives the labels in the language asked, the rest unchanged', () => {
    const vi = templateChallenge('ybc-heart', 'vi');
    const en = templateChallenge('ybc-heart', 'en');
    expect(vi?.goals.map((goal) => goal.label)).toEqual(['Màn hình hiện hình trái tim']);
    expect(en?.goals.map((goal) => goal.label)).toEqual(['The display shows a heart']);
    expect({ ...vi, goals: vi?.goals.map((goal) => ({ ...goal, label: '' })) }).toEqual({ ...en, goals: en?.goals.map((goal) => ({ ...goal, label: '' })) });
  });

  describe.each(['led-on', 'blink', 'button-direct', 'button-led'] as const)('%s (a finished generic program)', (key) => {
    it('passes as the template opens', async () => {
      expect(await check(key, createTemplateProject(key))).toMatchObject({ status: 'checked', started: true, result: { passed: true } });
    });
  });

  it.each([
    ['led-on', 'an empty program', (document: ProjectDocument) => ({ ...document, program: { blocks: createDefaultProgram() } })],
    ['blink', 'an empty program', (document: ProjectDocument) => ({ ...document, program: { blocks: createDefaultProgram() } })],
    ['button-led', 'an empty program', (document: ProjectDocument) => ({ ...document, program: { blocks: createDefaultProgram() } })],
    ['button-direct', 'no wires', (document: ProjectDocument) => ({ ...document, circuit: { ...document.circuit, wires: [] } })],
  ] as const)('%s fails with %s', async (key, _, broken) => {
    expect(await check(key, broken(createTemplateProject(key)))).toMatchObject({ status: 'checked', result: { passed: false } });
  });

  const ybcCases: [YbcLessonKey, string[]][] = [
    ['ybc-heart', []],
    ['ybc-button-ab', ['a-shows-check']],
    ['ybc-night-light', ['bright-goes-off']],
    ['ybc-melody', []],
    // N17 B6: the four labs of the full board.
    ['ybc-rainbow', []],
    ['ybc-thermometer', []],
    ['ybc-dice', []],
    ['ybc-servo-gate', ['bright-opens']],
  ];

  describe.each(ybcCases)('%s (a Yolo:Bit starter)', (key, passedByStarter) => {
    it('fails as the template opens: only the goals the starter already meets pass', async () => {
      const outcome = await check(key, createTemplateProject(key));
      expect(outcome).toMatchObject({ status: 'checked', started: true, result: { passed: false } });
      expect(passedIds(outcome)).toEqual(passedByStarter);
    });

    it('passes once the loose block is attached', async () => {
      expect(await check(key, ybcSolutionDocument(key))).toMatchObject({ status: 'checked', started: true, result: { passed: true } });
    });

    it('passes with the Advanced profile too', async () => {
      expect(await check(key, { ...ybcSolutionDocument(key), profile: 'ybc-advanced' })).toMatchObject({ result: { passed: true } });
    });
  });

  // N17 B6: a lab that uses what only the Advanced board has (the temperature, a shake, the servo) cannot pass on the Basic one.
  it.each<YbcLessonKey>(['ybc-thermometer', 'ybc-dice', 'ybc-servo-gate'])('%s does not pass on the Basic board: the run does not start', async (key) => {
    expect(await check(key, { ...ybcSolutionDocument(key), profile: 'ybc-basic' })).toMatchObject({ status: 'checked', started: false, result: { passed: false } });
  });

  it('the goals of the four new labs, in both languages', () => {
    const goalsOf = (key: TemplateKey) => templateChallenge(key, 'vi')?.goals.map(({ id, kind, label }) => ({ id, kind, label }));
    expect(goalsOf('ybc-rainbow')).toEqual([{ id: 'a-changes-colour', kind: 'display-colours-differ', label: 'Bấm A hai lần thì cả màn hình sáng hai màu khác nhau' }]);
    expect(goalsOf('ybc-thermometer')).toEqual([
      { id: 'b-scrolls-30', kind: 'display-scrolls', label: 'Ở 30 °C, bấm B thì màn hình chạy chữ 30' },
      { id: 'uses-temperature', kind: 'uses-block', label: 'Dùng khối nhiệt độ' },
    ]);
    expect(goalsOf('ybc-dice')).toEqual([
      { id: 'shake-shows-number', kind: 'display-lit', label: 'Lắc mạch thì màn hình hiện số' },
      { id: 'uses-random', kind: 'uses-block', label: 'Dùng khối số ngẫu nhiên' },
    ]);
    expect(goalsOf('ybc-servo-gate')).toEqual([
      { id: 'dark-closes', kind: 'servo-angle', label: 'Trời tối (ánh sáng dưới 30) thì servo quay về 0°' },
      { id: 'bright-opens', kind: 'servo-angle', label: 'Trời sáng thì servo quay tới 90°' },
    ]);
    expect(templateChallenge('ybc-dice', 'en')?.goals.map((goal) => goal.label)).toEqual(['Shaking the board shows a number', 'Uses the random number block']);
  });

  // N17 B4/B6: a check draws the same numbers every time (a fixed seed). The dice's goals ask for a number shown after the shake and
  // the random block, never for one number, so the solution passes whatever the seed, and the numbers it shows do differ.
  it('ybc-dice passes whatever numbers the dice draws: its goals do not depend on the seed', async () => {
    const shown = new Set<string>();
    for (const seed of [1, 2, 3, 7, 42, 2026, 20261019, 987654321]) {
      const session = newSession();
      let last = '';
      const seeded: CheckSession = {
        start: (document) => session.start(document, { seed }),
        stop: () => {
          last = JSON.stringify(session.getSnapshot().simulation?.components[`${ybcTemplateBoardId}/display`]);
          session.stop();
        },
        subscribe: (listener) => session.subscribe(listener),
        getSnapshot: () => session.getSnapshot(),
        setComponentInput: (componentId, input) => session.setComponentInput(componentId, input),
      };
      expect(await check('ybc-dice', ybcSolutionDocument('ybc-dice'), { session: seeded }), `seed ${seed}`).toMatchObject({ result: { passed: true } });
      shown.add(last);
    }
    expect(shown.size).toBeGreaterThan(1);
  });

  // Review Focus 4 of N17 (task B6): in a hidden tab the browser runs timers about once a second, so a check gives its presses late
  // and judges the wrong moments. Such a check is interrupted (not passed, check again); it never passes falsely.
  describe('a hidden tab never passes a check falsely (Review Focus 4)', () => {
    const hiddenTabTimers = (): CheckTimers => {
      const start = Date.now();
      return {
        setTimeout: (task, ms) => setTimeout(task, Math.ceil((Date.now() + ms - start) / 1000) * 1000 + start - Date.now()),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        now: () => Date.now(),
      };
    };
    /** A wrong rainbow: green only while A is held, red otherwise, so the colour after each press is the same. */
    const holdColour = (): ProjectDocument => ({
      ...createTemplateProject('ybc-rainbow'),
      program: { blocks: program([], [ifThen(buttonPressed('A'), [setAll(colour('#00ff00'))], [setAll(colour('#ff0000'))])]) },
    });

    it('a wrong rainbow fails in a visible tab', async () => {
      expect(await check('ybc-rainbow', holdColour())).toMatchObject({ status: 'checked', result: { passed: false } });
    });

    it('a wrong rainbow in a hidden tab is interrupted, not passed', async () => {
      expect(await check('ybc-rainbow', holdColour(), { timers: hiddenTabTimers() })).toEqual({ status: 'interrupted', reason: 'late' });
    });

    it.each(['ybc-rainbow', 'ybc-button-ab', 'ybc-night-light', 'ybc-servo-gate'] as const)('the solution of %s in a hidden tab is interrupted: not passed, check again', async (key) => {
      expect(await check(key, ybcSolutionDocument(key), { timers: hiddenTabTimers() })).toEqual({ status: 'interrupted', reason: 'late' });
    });
  });

  it('fails a Yolo:Bit check whose board was removed: the run does not start', async () => {
    const document = ybcSolutionDocument('ybc-heart');
    expect(await check('ybc-heart', { ...document, circuit: { components: [], wires: [] } })).toMatchObject({
      status: 'checked',
      started: false,
      result: { passed: false },
    });
  });
});
