import { describe, expect, it } from 'vitest';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import { goalReasonKeys, goalReasons, type GoalResult } from '../../core/scenario/goals';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { en, isMessageKey, translate, vi, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { checkReport, goalFailureText, variantFailureText, type VariantOutcome } from './check-report';

// N18 R6.3: the check's result in the learner's words. A goal that failed says why, when and in which round, from its reasonKey, its atS and
// the variant: "Xe chạm tường lúc 12,4 s ở lượt 2" (a Vietnamese decimal comma). The panel reads the check's own numbers: a variant that
// ended in an error scores 0 there, whatever its live score was.

const textIn = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const viText = textIn('vi');
const enText = textIn('en');

const stopAtWall = scenarioCatalog.get('rb-stop-at-wall')!;
const miniMission = scenarioCatalog.get('rb-mini-mission')!;
const [stopNearWall, noCrash] = stopAtWall.goals;

const passed = (id: string, points: number, atS?: number): GoalResult => ({ id, passed: true, points, progress: 1, ...(atS === undefined ? {} : { atS }) });
const failed = (id: string, reasonKey: GoalResult['reasonKey'], atS?: number): GoalResult => ({ id, passed: false, points: 0, progress: 0, reasonKey, ...(atS === undefined ? {} : { atS }) });

const variant = (index: number, changes: Partial<VariantOutcome> = {}): VariantOutcome => ({
  index,
  passed: false,
  score: 0,
  timeBonus: 0,
  goals: [],
  end: null,
  error: null,
  ...changes,
});

describe('why a goal of a check was not met (N18 R6.3)', () => {
  it('says what happened, at what time and in which round, with a Vietnamese decimal comma', () => {
    const crashed = variant(1, { goals: [failed('stop-near-wall', goalReasons.notStoppedInZone), failed('no-crash', goalReasons.contact, 12.391)] });
    expect(goalFailureText(viText, 'vi', noCrash!, crashed.goals[1]!, crashed)).toBe('Xe chạm tường lúc 12,4 s ở lượt 2');
    expect(goalFailureText(enText, 'en', noCrash!, crashed.goals[1]!, crashed)).toBe('The robot touched a wall at 12.4 s in round 2');
    // No event settled it: no time.
    expect(goalFailureText(viText, 'vi', stopNearWall!, crashed.goals[0]!, crashed)).toBe('Xe chưa đứng yên đủ lâu trong vùng ở lượt 2');
  });

  it('names what the run ended on for a stop cut short by a crash, and says "something it had to avoid" for a tag it has no word for', () => {
    const ended = variant(2, { end: { reason: 'contact', atS: 14.392, tag: 'obstacle' }, goals: [failed('stop-near-wall', goalReasons.runEndedContact, 14.392)] });
    expect(goalFailureText(viText, 'vi', stopNearWall!, ended.goals[0]!, ended)).toBe('Lượt chạy dừng vì xe đâm vào vật cản lúc 14,4 s ở lượt 3');
    expect(goalFailureText(enText, 'en', stopNearWall!, ended.goals[0]!, ended)).toBe('The run ended when the robot crashed into an obstacle at 14.4 s in round 3');
    const odd = { ...noCrash!, tag: 'lamp-post' } as typeof noCrash & { tag: string };
    const touched = variant(0, { goals: [failed('no-crash', goalReasons.contact, 3)] });
    expect(goalFailureText(viText, 'vi', odd, touched.goals[0]!, touched)).toBe('Xe chạm vật cần tránh lúc 3,0 s ở lượt 1');
  });

  describe('names what was hit by the collider itself (N18 bt-lab-fix, c3)', () => {
    const noBump = miniMission.goals.find((goal) => goal.id === 'no-bump')!;
    const dockWall = { otherId: 'dock-wall', tags: ['wall', 'obstacle'] } as const;
    const cone = { otherId: 'cone-2', tags: ['box', 'obstacle'] } as const;
    const crash = (endContact: VariantOutcome['endContact']) =>
      variant(2, {
        end: { reason: 'contact', atS: 14.392, tag: 'obstacle' },
        ...(endContact === undefined ? {} : { endContact }),
        goals: [failed('no-bump', goalReasons.contact, 14.392), failed('park', goalReasons.runEndedContact, 14.392)],
      });

    it('says the wall when the dock wall (an obstacle by its tag, a wall by its kind) was hit, and the obstacle when a cone was', () => {
      const wall = crash(dockWall);
      expect(goalFailureText(viText, 'vi', noBump, wall.goals[0]!, wall)).toBe('Xe chạm tường lúc 14,4 s ở lượt 3');
      expect(goalFailureText(enText, 'en', noBump, wall.goals[0]!, wall)).toBe('The robot touched a wall at 14.4 s in round 3');
      const cones = crash(cone);
      expect(goalFailureText(viText, 'vi', noBump, cones.goals[0]!, cones)).toBe('Xe chạm vật cản lúc 14,4 s ở lượt 3');
      expect(goalFailureText(enText, 'en', noBump, cones.goals[0]!, cones)).toBe('The robot touched an obstacle at 14.4 s in round 3');
    });

    it('says the same of a stop the crash cut short', () => {
      const park = miniMission.goals.find((goal) => goal.id === 'park')!;
      const wall = crash(dockWall);
      expect(goalFailureText(viText, 'vi', park, wall.goals[1]!, wall)).toBe('Lượt chạy dừng vì xe đâm vào tường lúc 14,4 s ở lượt 3');
      expect(goalFailureText(enText, 'en', park, wall.goals[1]!, wall)).toBe('The run ended when the robot crashed into a wall at 14.4 s in round 3');
      const cones = crash(cone);
      expect(goalFailureText(viText, 'vi', park, cones.goals[1]!, cones)).toBe('Lượt chạy dừng vì xe đâm vào vật cản lúc 14,4 s ở lượt 3');
    });

    it('keeps the tag’s word when the report does not know the collider, or when it was not the one the goal is about', () => {
      const unknown = crash(undefined);
      expect(goalFailureText(viText, 'vi', noBump, unknown.goals[0]!, unknown)).toBe('Xe chạm vật cản lúc 14,4 s ở lượt 3');
      // A wall without the goal's tag is not what this goal was failed by.
      const other = crash({ otherId: 'front-wall', tags: ['wall'] });
      expect(goalFailureText(viText, 'vi', noBump, other.goals[0]!, other)).toBe('Xe chạm vật cản lúc 14,4 s ở lượt 3');
    });
  });

  it('says nothing for a goal that passed, and leaves a program error to its round', () => {
    const fine = variant(0, { goals: [passed('no-crash', 30, 1)] });
    expect(goalFailureText(viText, 'vi', noCrash!, fine.goals[0]!, fine)).toBeNull();
    const faulted = variant(0, { error: { message: 'x', code: 'out-of-domain' }, goals: [failed('no-crash', goalReasons.programError, 0.8)] });
    expect(goalFailureText(viText, 'vi', noCrash!, faulted.goals[0]!, faulted)).toBeNull();
    expect(variantFailureText(viText, 'vi', faulted)).toBe('Chương trình dừng vì lỗi lúc 0,8 s ở lượt 1');
    expect(variantFailureText(enText, 'en', faulted)).toBe('The program stopped with an error at 0.8 s in round 1');
    // A failure of the simulation itself is not the program's.
    const internal = variant(1, { error: { message: 'boom', code: 'internal-error' }, goals: [failed('no-crash', goalReasons.programError, 2.25)] });
    expect(variantFailureText(viText, 'vi', internal)).toBe('Mô phỏng dừng vì lỗi nội bộ lúc 2,3 s ở lượt 2');
    expect(variantFailureText(viText, 'vi', fine)).toBeNull();
  });

  it.each(goalReasonKeys)('words %s for an explanation, in English and in Vietnamese', (reasonKey) => {
    const key = `robot.check.why.${reasonKey.slice('robot.goal.reason.'.length)}`;
    expect(isMessageKey(key)).toBe(true);
    if (!isMessageKey(key)) return;
    expect(en[key].trim()).not.toBe('');
    expect(vi[key].trim()).not.toBe('');
    expect(vi[key]).not.toBe(en[key]);
    // Every reason reads as a sentence with its time and its round.
    const spec = miniMission.goals.find((goal) => goal.kind === 'avoid-contact')!;
    const outcome = variant(0, { end: { reason: 'contact', atS: 1, tag: 'wall' }, goals: [failed(spec.id, reasonKey, 1)] });
    const text = goalFailureText(viText, 'vi', spec, outcome.goals[0]!, outcome);
    expect(text === null ? reasonKey : text).toMatch(reasonKey === goalReasons.programError ? reasonKey : / lúc 1,0 s ở lượt 1$/);
    expect(text ?? '').not.toMatch(/[{}]/);
  });
});

describe('the report of a check (N18 R6.3)', () => {
  const result = (changes: Partial<RobotCheckResult>): RobotCheckResult => ({
    passed: false,
    goals: stopAtWall.goals.map((goal) => ({ id: goal.id, label: goal.label.vi, passed: false })),
    score: 0,
    maxScore: 100,
    simTimeMs: 20000,
    variants: [],
    engine: ROBOT_ENGINE,
    scenarioVersion: 1,
    programHash: 'ab',
    ...changes,
  });

  it('gives each round its own score from the result (0 for a round that ended in an error), each goal its verdict and its reasons', () => {
    const outcomes = [
      variant(0, { passed: true, score: 100, goals: [passed('stop-near-wall', 70, 6), passed('no-crash', 30, 1)] }),
      variant(1, { score: 0, end: { reason: 'contact', atS: 6.6, tag: 'wall' }, goals: [failed('stop-near-wall', goalReasons.runEndedContact, 6.6), failed('no-crash', goalReasons.contact, 6.6)] }),
      // Its live score was 30 when the program faulted: the check gives it 0.
      variant(2, { score: 0, error: { message: 'x', code: 'out-of-domain' }, goals: [failed('stop-near-wall', goalReasons.programError, 4), failed('no-crash', goalReasons.programError, 4)] }),
    ];
    const report = checkReport(
      stopAtWall,
      result({
        score: 0,
        variants: [
          { seed: 1, passed: true, score: 100, simTimeMs: 20000 },
          { seed: 2, passed: false, score: 0, simTimeMs: 6600 },
          { seed: 3, passed: false, score: 0, simTimeMs: 4000 },
        ],
      }),
      outcomes,
      viText,
      'vi',
    );
    expect(report).toEqual({
      passed: false,
      score: 0,
      maxScore: 100,
      count: 3,
      variants: [
        { index: 0, round: 1, passed: true, score: 100, note: null },
        { index: 1, round: 2, passed: false, score: 0, note: null },
        { index: 2, round: 3, passed: false, score: 0, note: 'Chương trình dừng vì lỗi lúc 4,0 s ở lượt 3' },
      ],
      goals: [
        { id: 'stop-near-wall', label: 'Xe dừng hẳn trong vùng trước tường', points: 70, passed: false, why: ['Lượt chạy dừng vì xe đâm vào tường lúc 6,6 s ở lượt 2'] },
        { id: 'no-crash', label: 'Xe không chạm tường', points: 30, passed: false, why: ['Xe chạm tường lúc 6,6 s ở lượt 2'] },
      ],
      bonus: null,
    });
  });

  it('says the time bonus in the score for a scenario that has one: earned by a check that passed, none otherwise', () => {
    const ids = miniMission.goals.map((goal) => goal.id);
    const all = (index: number, bonus: number): VariantOutcome =>
      variant(index, { passed: true, score: 90 + bonus, timeBonus: bonus, goals: miniMission.goals.map((goal) => passed(goal.id, goal.points, 13)) });
    const goals = (ok: boolean) => ids.map((id, index) => ({ id, label: miniMission.goals[index]!.label.vi, passed: ok }));
    const passedCheck = { passed: true, goals: goals(true), score: 96, variants: [0, 1, 2].map((seed) => ({ seed, passed: true, score: [97, 96, 97][seed]!, simTimeMs: 45000 })) };
    const report = checkReport(miniMission, result(passedCheck), [all(0, 7), all(1, 6), all(2, 7)], viText, 'vi');
    expect(report.bonus).toBe('Thưởng thời gian: +6/10 điểm');
    expect(checkReport(miniMission, result(passedCheck), [all(0, 7), all(1, 6), all(2, 7)], enText, 'en').bonus).toBe('Time bonus: +6/10 points');
    const missed = variant(1, { score: 45, goals: miniMission.goals.map((goal) => (goal.id === 'park' ? failed('park', goalReasons.notStoppedInZone) : passed(goal.id, goal.points))) });
    const failedCheck = { goals: goals(false), score: 45, variants: [0, 1, 2].map((seed) => ({ seed, passed: seed !== 1, score: seed === 1 ? 45 : 97, simTimeMs: 45000 })) };
    expect(checkReport(miniMission, result(failedCheck), [all(0, 7), missed, all(2, 7)], viText, 'vi').bonus).toBe('Thưởng thời gian: 0/10 điểm (chỉ có khi đạt mọi mục tiêu)');
  });
});
