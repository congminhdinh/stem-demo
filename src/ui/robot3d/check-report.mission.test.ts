import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { checkRobot, type CheckProgress } from '../../core/scenario/check-robot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robotSolutions } from '../../samples/robot-solutions';
import { robotStarterDocument } from '../../samples/robot-templates';
import { translate, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { checkReport } from './check-report';

// N18 bt-lab-fix (c3), on the real check: the mission's "follower without distance" program runs into the dock wall, which is an
// `obstacle` by its tag and a wall by its kind. The report says "tường" (and "a wall"), not "vật cản" (an obstacle).

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const textIn = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const mission = scenarioCatalog.get('rb-mini-mission')!;

describe('the report of a real check of the mission (N18 bt-lab-fix, c3)', () => {
  it('names the dock wall a wall, in Vietnamese and in English, and leaves the score and the end of the round as they were', async () => {
    const exploit = robotSolutions['rb-mini-mission'].exploits!.find((candidate) => candidate.name === 'follower-without-distance')!;
    const project: ProjectDocument = { ...robotStarterDocument('rb-mini-mission'), program: { blocks: exploit.program } };
    const ended: Extract<CheckProgress, { kind: 'variant-ended' }>[] = [];
    const result = await checkRobot(project, mission, {
      mode: 'headless',
      kit,
      board: unoR3Board,
      registry: createDeviceRegistry(localDeviceDefinitions),
      onProgress: (progress) => progress.kind === 'variant-ended' && ended.push(progress),
    }).result;
    expect(result).not.toBeNull();
    const crashes = ended.filter((progress) => progress.end?.reason === 'contact');
    expect(crashes.length).toBeGreaterThan(0);
    for (const progress of crashes) {
      // The scenario's tag stays what the end says; the collider says what it is.
      expect(progress.end?.tag).toBe('obstacle');
      expect(progress.snapshot.endContact?.tags).toContain('obstacle');
    }
    const outcomes = ended.map((progress) => ({
      index: progress.index,
      passed: progress.variant.passed,
      score: progress.variant.score,
      timeBonus: progress.timeBonus,
      goals: progress.goals,
      end: progress.end,
      ...(progress.snapshot.endContact === undefined ? {} : { endContact: progress.snapshot.endContact }),
      error: progress.error,
    }));
    const viWhy = checkReport(mission, result!, outcomes, textIn('vi'), 'vi').goals.find((goal) => goal.id === 'no-bump')!.why;
    const enWhy = checkReport(mission, result!, outcomes, textIn('en'), 'en').goals.find((goal) => goal.id === 'no-bump')!.why;
    const hitWall = crashes.filter((progress) => progress.snapshot.endContact?.tags.includes('wall'));
    // All three rounds end on the dock wall, at the times the check measured them (determinism: the same on every run).
    expect(hitWall).toHaveLength(3);
    expect(viWhy).toEqual(['Xe chạm tường lúc 14,4 s ở lượt 1', 'Xe chạm tường lúc 15,5 s ở lượt 2', 'Xe chạm tường lúc 13,3 s ở lượt 3']);
    expect(enWhy).toEqual(['The robot touched a wall at 14.4 s in round 1', 'The robot touched a wall at 15.5 s in round 2', 'The robot touched a wall at 13.3 s in round 3']);
    // Only the words changed: the score of this program stays what the check gave it before (45, below the pass mark).
    expect(result!.score).toBe(45);
  }, 120_000);
});
