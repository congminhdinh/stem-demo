import type { RobotRunEnd, RobotRunError } from '../../core/run/robot-run-session';
import type { GoalContact } from '../../core/scenario/goals/frame';
import type { RobotCheckResult } from '../../core/scenario/check-result';
import { goalReasons, type GoalResult } from '../../core/scenario/goals';
import type { RobotGoalSpec, Scenario } from '../../core/scenario/scenario';
import { isMessageKey, type Locale, type MessageKey } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { formatNumber } from './format';

// The robot lab's check in the learner's words (N18 R6.3): the result panel's rounds, goals, time bonus and why a goal was not met.
//
//   - Why: each goal that failed in a round says what happened, from its `reasonKey` (`robot.check.why.<reason>`, a clause), and when and in
//     which round: "Xe chạm tường lúc 12,4 s ở lượt 2" with its `atS` (one decimal, the learner's decimal mark), "Xe chưa tới được vùng cần
//     đến ở lượt 1" without one. A contact names what was touched: the goal's tag, or for a stop the crash cut short the tag the run ended on;
//     N18 bt-lab-fix (c3): a wall that carries that tag (the dock wall is an `obstacle` by its tag and a wall by its kind) is named a wall,
//     from the collider the run ended on (`endContact`), when the report has it.
//   - A round whose program ended in an error fails every goal with `program-error` (R6.2): that is said once, on the round, not on each goal.
//   - The numbers are the check's (RobotCheckResult and each round's end), never a live score: a round that ended in an error scores 0 here.

/** One round of a check as it ended (the check's `variant-ended` progress). */
export type VariantOutcome = {
  readonly index: number;
  readonly passed: boolean;
  readonly score: number;
  readonly timeBonus: number;
  readonly goals: readonly GoalResult[];
  readonly end: RobotRunEnd | null;
  /** N18 bt-lab-fix (c3): the collider a contact end touched (the run's `endContact`); left out when the round did not end on a contact. */
  readonly endContact?: GoalContact;
  readonly error: RobotRunError | null;
};

export type CheckReport = {
  passed: boolean;
  score: number;
  maxScore: number;
  /** How many rounds the check ran. */
  count: number;
  /** Each round: its number for the learner (`round`, from 1), its verdict and score, and why it failed as a whole (an error) if it did. */
  variants: { index: number; round: number; passed: boolean; score: number; note: string | null }[];
  /** Each goal: passed in every round, and why not in each round it failed. */
  goals: { id: string; label: string; points: number; passed: boolean; why: string[] }[];
  /** The time bonus line, for a scenario that has a time bonus. */
  bonus: string | null;
};

const reasonPrefix = 'robot.goal.reason.';

/** The clause of a reason key: `robot.check.why.<reason>`. */
const whyKey = (reasonKey: string): MessageKey | null => {
  const key = `robot.check.why.${reasonKey.startsWith(reasonPrefix) ? reasonKey.slice(reasonPrefix.length) : reasonKey}`;
  return isMessageKey(key) ? key : null;
};

/** What a tag names, in the learner's words: a wall, an obstacle, the gate…; anything else is "something it had to avoid". */
const thingOf = (t: Text, tag: string | undefined): string => {
  const key = `robot.check.thing.${tag ?? ''}`;
  return t(isMessageKey(key) ? key : 'robot.check.thing.other');
};

/**
 * What a contact touched, in the learner's words: a wall when the collider the round ended on is one (its kind `wall` is among its tags) and
 * has the `tag` asked about, since the tag may be one a wall shares with other things (`obstacle`); otherwise what the tag names.
 */
const hitOf = (t: Text, tag: string | undefined, variant: VariantOutcome): string => {
  const hit = variant.endContact;
  return thingOf(t, tag !== undefined && hit !== undefined && hit.tags.includes(tag) && hit.tags.includes('wall') ? 'wall' : tag);
};

/** A clause with its time and round. */
const when = (t: Text, locale: Locale, what: string, index: number, atS: number | undefined): string =>
  atS === undefined
    ? t('robot.check.explain.round', { what, round: index + 1 })
    : t('robot.check.explain.at', { what, time: formatNumber(atS, locale, 1), round: index + 1 });

/**
 * Why `result`, the goal `spec`'s in the round `variant`, did not pass, or null when it passed or when the round ended in an error (that is
 * the round's to say, `variantFailureText`).
 */
export function goalFailureText(t: Text, locale: Locale, spec: RobotGoalSpec, result: GoalResult, variant: VariantOutcome): string | null {
  if (result.passed || result.reasonKey === undefined || result.reasonKey === goalReasons.programError) {
    return null;
  }
  const key = whyKey(result.reasonKey);
  if (key === null) {
    return null;
  }
  const thing =
    result.reasonKey === goalReasons.contact
      ? hitOf(t, spec.kind === 'avoid-contact' ? spec.tag : undefined, variant)
      : result.reasonKey === goalReasons.runEndedContact
        ? hitOf(t, variant.end?.tag, variant)
        : '';
  return when(t, locale, t(key, { thing }), variant.index, result.atS);
}

/** Why the round `variant` failed as a whole: its program (or the simulation) stopped with an error, at that time. Null otherwise. */
export function variantFailureText(t: Text, locale: Locale, variant: VariantOutcome): string | null {
  if (variant.error === null) {
    return null;
  }
  const atS = variant.goals.find((goal) => goal.atS !== undefined)?.atS;
  const what = t(variant.error.code === 'internal-error' ? 'robot.check.why.internal-error' : 'robot.check.why.program-error');
  return when(t, locale, what, variant.index, atS);
}

/** The result panel of a check of `scenario`: `result` is what the host is sent, `variants` each round's end, in order. */
export function checkReport(scenario: Scenario, result: RobotCheckResult, variants: readonly VariantOutcome[], t: Text, locale: Locale): CheckReport {
  const goals = scenario.goals.map((spec, index) => ({
    id: spec.id,
    label: spec.label[locale],
    points: spec.points,
    passed: result.goals[index]?.passed === true,
    why: variants.flatMap((variant) => {
      const outcome = variant.goals.find((goal) => goal.id === spec.id);
      const text = outcome === undefined ? null : goalFailureText(t, locale, spec, outcome, variant);
      return text === null ? [] : [text];
    }),
  }));
  const bonusMax = scenario.scoring.timeBonusMax ?? 0;
  // The score is the lowest round's (R6.2): its bonus is the one in the score.
  const scored = variants.find((variant) => variant.score === result.score);
  const bonus =
    bonusMax <= 0
      ? null
      : result.passed && scored !== undefined
        ? t('robot.check.bonus', { bonus: scored.timeBonus, max: bonusMax })
        : t('robot.check.bonus.none', { max: bonusMax });
  return {
    passed: result.passed,
    score: result.score,
    maxScore: result.maxScore,
    count: result.variants.length,
    variants: result.variants.map((line, index) => {
      const outcome = variants[index];
      return { index, round: index + 1, passed: line.passed, score: line.score, note: outcome === undefined ? null : variantFailureText(t, locale, outcome) };
    }),
    goals,
    bonus,
  };
}
