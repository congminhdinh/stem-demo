import type { RobotRunEnd, RobotRunError } from '../../core/run/robot-run-session';
import type { GoalContact } from '../../core/scenario/goals/frame';
import type { RobotCheckResult } from '../../core/scenario/check-result';
import { goalReasons, type GoalResult } from '../../core/scenario/goals';
import { placedZoneFor } from '../../core/scenario/goals/object-placed';
import type { RobotGoalSpec, Scenario } from '../../core/scenario/scenario';
import { variantObjectColors } from '../../core/scenario/variants';
import { bodyColorName } from '../../core/world/arena/body-colors';
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
//   - N19 D3: a pick-and-place reason names its objects and zones as the learner sees them in that round: an object by its noun, its colour
//     in that round (variants.ts `variantObjectColors`) and, when two objects share both, its number among them in arena order ("khối đỏ",
//     "kiện hàng 2", "bệ vàng"); a zone by its name ("vùng xanh dương"). "Xe làm rơi kiện hàng 2 lúc 8,2 s ở lượt 2", "Khối đỏ nằm ở vùng
//     xanh dương ở lượt 3". A clause may start with a name, so its first letter is made upper case, in the learner's language.
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

/** N19 D3: the text with its first letter in upper case, as the learner's language writes it ("khối đỏ…" is "Khối đỏ…"). */
export function capitalise(text: string, locale: Locale): string {
  const first = text.codePointAt(0);
  if (first === undefined) return text;
  const letter = String.fromCodePoint(first);
  return letter.toLocaleUpperCase(locale) + text.slice(letter.length);
}

/** A clause with its time and round, its first letter in upper case. */
const when = (t: Text, locale: Locale, what: string, index: number, atS: number | undefined): string =>
  atS === undefined
    ? t('robot.check.explain.round', { what: capitalise(what, locale), round: index + 1 })
    : t('robot.check.explain.at', { what: capitalise(what, locale), time: formatNumber(atS, locale, 1), round: index + 1 });

/** What a report needs of the scenario to name its objects and zones (a `Scenario` is one). */
export type NamingScenario = Pick<Scenario, 'arena' | 'variants'>;

/** The colour of each object in round `index`: the variant's, or the arena's for a round the scenario does not have. */
function roundColors(scenario: NamingScenario, index: number): Readonly<Record<string, string>> {
  if (Number.isInteger(index) && index >= 0 && index < scenario.variants.count) return variantObjectColors(scenario, index);
  return Object.fromEntries(scenario.arena.objects.flatMap((object) => (object.color === undefined ? [] : [[object.id, object.color] as const])));
}

/**
 * N19 D3: what the learner calls the object `id` in round `index`: its noun ("khối"; "vật" without one), its colour in that round when the
 * palette has a word for it, and its number among the objects with the same noun and colour when there are more than one. An object the
 * arena does not have, or no scenario, is "the object".
 */
export function objectName(t: Text, scenario: NamingScenario | undefined, id: string | undefined, index: number): string {
  const object = id === undefined ? undefined : scenario?.arena.objects.find((candidate) => candidate.id === id);
  if (scenario === undefined || object === undefined) return t('robot.object.name', { noun: t('robot.object.noun.other') });
  const colors = roundColors(scenario, index);
  const colorOf = (candidate: { id: string }) => bodyColorName(Object.hasOwn(colors, candidate.id) ? colors[candidate.id] : undefined);
  const color = colorOf(object);
  const twins = scenario.arena.objects.filter((candidate) => candidate.noun === object.noun && colorOf(candidate) === color);
  const noun = t(`robot.object.noun.${object.noun ?? 'other'}`);
  const number = twins.length > 1 ? twins.indexOf(object) + 1 : undefined;
  if (color === undefined) return number === undefined ? t('robot.object.name', { noun }) : t('robot.object.name.index', { noun, index: number });
  const colorWord = t(`robot.color.${color}`);
  return number === undefined ? t('robot.object.name.color', { noun, color: colorWord }) : t('robot.object.name.color.index', { noun, color: colorWord, index: number });
}

/** N19 D3: what the learner calls the zone `id`: its name ("vùng xanh dương"), or `fallback` for a zone without one (or none). */
function zoneName(t: Text, scenario: NamingScenario | undefined, id: string | undefined, fallback: 'robot.zone.name.other' | 'robot.zone.name.target'): string {
  const name = id === undefined ? undefined : scenario?.arena.paint.zones.find((zone) => zone.id === id)?.name;
  return t(name === undefined ? fallback : `robot.zone.name.${name}`);
}

/** The zone an `object-placed` goal sends its object to in round `index`: its `zone`, or the zone of the object's colour in that round. */
function targetZoneOf(spec: RobotGoalSpec, scenario: NamingScenario | undefined, index: number): string | undefined {
  if (spec.kind !== 'object-placed') return undefined;
  if (scenario === undefined) return spec.zone;
  const colors = roundColors(scenario, index);
  return placedZoneFor(spec, Object.hasOwn(colors, spec.object) ? colors[spec.object] : undefined);
}

/** The objects a goal is about: the one it moves, or the top and the bottom of a stack. */
function goalObjects(spec: RobotGoalSpec): { object?: string; base?: string } {
  switch (spec.kind) {
    case 'object-held':
    case 'object-placed':
    case 'object-unmoved':
    case 'object-in-zone':
      return { object: spec.object };
    case 'object-on-object':
      return { object: spec.top, base: spec.bottom };
    default:
      return {};
  }
}

/**
 * Why `result`, the goal `spec`'s in the round `variant`, did not pass, or null when it passed or when the round ended in an error (that is
 * the round's to say, `variantFailureText`). `scenario` names the objects and zones of a pick-and-place reason (N19 D3); without it they are
 * "the object" and "another zone".
 */
export function goalFailureText(t: Text, locale: Locale, spec: RobotGoalSpec, result: GoalResult, variant: VariantOutcome, scenario?: NamingScenario): string | null {
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
  const { object, base } = goalObjects(spec);
  const names = {
    object: objectName(t, scenario, object, variant.index),
    base: objectName(t, scenario, base, variant.index),
    zone: zoneName(t, scenario, result.detail?.zoneId, 'robot.zone.name.other'),
    target: zoneName(t, scenario, targetZoneOf(spec, scenario, variant.index), 'robot.zone.name.target'),
  };
  return when(t, locale, t(key, { thing, ...names }), variant.index, result.atS);
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
      const text = outcome === undefined ? null : goalFailureText(t, locale, spec, outcome, variant, scenario);
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
