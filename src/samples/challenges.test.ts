import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFrame, runCheck, type CheckOutcome } from '../core/challenge';
import type { ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { productionProfiles } from '../core/profiles';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { createDefaultProgram } from '../core/program/blocks';
import { createRunSession } from '../core/run/run-session';
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

async function check(key: TemplateKey, document: ProjectDocument): Promise<CheckOutcome> {
  const challenge = templateChallenge(key, 'en');
  if (!challenge) {
    throw new Error(`${key} has no challenge`);
  }
  const session = newSession();
  const run = runCheck({ session, document, challenge, boardId: document.profile ? ybcTemplateBoardId : null });
  await vi.advanceTimersByTimeAsync(challenge.durationMs + 50);
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

  it('fails a Yolo:Bit check whose board was removed: the run does not start', async () => {
    const document = ybcSolutionDocument('ybc-heart');
    expect(await check('ybc-heart', { ...document, circuit: { components: [], wires: [] } })).toMatchObject({
      status: 'checked',
      started: false,
      result: { passed: false },
    });
  });
});
