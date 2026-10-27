import { describe, expect, it } from 'vitest';
import pickPlace from '../../core/scenario/__fixtures__/pick-place.scenario.json';
import { ROBOT_ENGINE, type RobotCheckResult } from '../../core/scenario/check-result';
import { goalReasons, type GoalResult } from '../../core/scenario/goals';
import { loadScenario, type Scenario } from '../../core/scenario/scenario';
import { bodyColorName, bodyPalette } from '../../core/world/arena/body-colors';
import { translate, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { capitalise, checkReport, goalFailureText, objectName, type VariantOutcome } from './check-report';

// N19 D3 (plan §4.5): a pick-and-place reason in the learner's words, with the objects and zones named as that round has them: the noun, the
// round's colour, a number when two objects share both ("khối đỏ", "kiện hàng 2", "bệ vàng"), the zone's name ("vùng xanh dương").
// The fixture (pick-place.scenario.json): a red cube (green in round 2, blue in round 3), a yellow base, three parcels with no colour, a can
// with neither noun nor colour; zones pickup, drop, red, green, blue by name, and `bare` with none.

const textIn = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const viText = textIn('vi');
const enText = textIn('en');
const scenario = loadScenario(pickPlace);
/** The fixture with the cube red again in round 3, as the plan's example card has it. */
const redInRound3: Scenario = loadScenario({ ...pickPlace, variants: { ...pickPlace.variants, objectColors: { cube: ['#d32f2f', '#388e3c', '#d32f2f'] } } });
const goal = (id: string) => scenario.goals.find((candidate) => candidate.id === id)!;
const failed = (id: string, reasonKey: GoalResult['reasonKey'], more: Partial<GoalResult> = {}): GoalResult => ({ id, passed: false, points: 0, progress: 0, reasonKey, ...more });
const round = (index: number, goals: GoalResult[] = []): VariantOutcome => ({ index, passed: false, score: 0, timeBonus: 0, goals, end: null, error: null });
const why = (text: Text, locale: Locale, id: string, result: GoalResult, index: number, of: Scenario = scenario) =>
  goalFailureText(text, locale, of.goals.find((candidate) => candidate.id === id)!, result, round(index, [result]), of);

describe('the names of objects and zones in a check’s report (N19 D3)', () => {
  it('gives the plan’s example cards word for word', () => {
    expect(why(viText, 'vi', 'deliver-2', failed('deliver-2', goalReasons.objectDropped, { atS: 8.2 }), 1)).toBe('Xe làm rơi kiện hàng 2 lúc 8,2 s ở lượt 2');
    expect(why(viText, 'vi', 'sort-cube', failed('sort-cube', goalReasons.objectWrongZone, { detail: { zoneId: 'blue-zone' } }), 2, redInRound3)).toBe(
      'Khối đỏ nằm ở vùng xanh dương ở lượt 3',
    );
    expect(why(viText, 'vi', 'place-cube', failed('place-cube', goalReasons.objectStillHeld), 0)).toBe('Xe vẫn còn giữ khối đỏ khi lượt chạy kết thúc ở lượt 1');
    expect(why(viText, 'vi', 'place-cube', failed('place-cube', goalReasons.objectPushed, { atS: 0.5 }), 0)).toBe('Khối đỏ bị đẩy chứ không được gắp lúc 0,5 s ở lượt 1');
  });

  it('says them in English too, a name at the start of a sentence in upper case', () => {
    expect(why(enText, 'en', 'deliver-2', failed('deliver-2', goalReasons.objectDropped, { atS: 8.2 }), 1)).toBe('The robot dropped parcel 2 at 8.2 s in round 2');
    expect(why(enText, 'en', 'sort-cube', failed('sort-cube', goalReasons.objectWrongZone, { detail: { zoneId: 'blue-zone' } }), 2, redInRound3)).toBe(
      'The red cube ended in the blue zone in round 3',
    );
  });

  it('uses the colour the object has in that round', () => {
    const wrong = failed('sort-cube', goalReasons.objectWrongZone, { detail: { zoneId: 'red-zone' } });
    expect([0, 1, 2].map((index) => why(viText, 'vi', 'sort-cube', wrong, index))).toEqual([
      'Khối đỏ nằm ở vùng đỏ ở lượt 1',
      'Khối xanh lá nằm ở vùng đỏ ở lượt 2',
      'Khối xanh dương nằm ở vùng đỏ ở lượt 3',
    ]);
    // The zone it was to go to is the one of that round's colour.
    const out = failed('sort-cube', goalReasons.objectMovedOut);
    expect([0, 1, 2].map((index) => why(viText, 'vi', 'sort-cube', out, index))).toEqual([
      'Khối đỏ bị xê dịch ra khỏi vùng đỏ ở lượt 1',
      'Khối xanh lá bị xê dịch ra khỏi vùng xanh lá ở lượt 2',
      'Khối xanh dương bị xê dịch ra khỏi vùng xanh dương ở lượt 3',
    ]);
  });

  it('names the base of a stack and an object that must not move', () => {
    expect(why(viText, 'vi', 'stack-cube', failed('stack-cube', goalReasons.stackOffCentre), 0)).toBe('Khối đỏ nằm lệch khỏi giữa bệ vàng ở lượt 1');
    expect(why(enText, 'en', 'stack-cube', failed('stack-cube', goalReasons.objectNotStacked), 1)).toBe('The green cube was not on top of the yellow base in round 2');
    expect(why(viText, 'vi', 'base-still', failed('base-still', goalReasons.objectMoved, { atS: 12 }), 0)).toBe('Bệ vàng bị xê dịch lúc 12,0 s ở lượt 1');
    expect(why(viText, 'vi', 'base-still', failed('base-still', goalReasons.objectTipped, { atS: 3.04 }), 0)).toBe('Bệ vàng bị đổ lúc 3,0 s ở lượt 1');
  });

  it('says every other pick-and-place reason with the object’s name', () => {
    const lines = (
      [
        ['grab-cube', goalReasons.objectNotReached],
        ['grab-cube', goalReasons.objectNotGrasped],
        ['grab-cube', goalReasons.objectNotLifted],
        ['place-cube', goalReasons.objectNeverHeld],
        ['place-cube', goalReasons.objectPartlyInZone],
        ['place-cube', goalReasons.objectTipped],
        ['place-cube', goalReasons.objectNotAtRest],
      ] as const
    ).map(([id, reasonKey]) => why(viText, 'vi', id, failed(id, reasonKey), 0));
    expect(lines).toEqual([
      'Xe chưa tới được chỗ khối đỏ ở lượt 1',
      'Xe chưa gắp giữ được khối đỏ ở lượt 1',
      'Xe chưa nâng khối đỏ lên đủ cao ở lượt 1',
      'Xe chưa hề gắp khối đỏ lên ở lượt 1',
      'Khối đỏ chỉ nằm một phần trong vùng thả ở lượt 1',
      'Khối đỏ bị đổ ở lượt 1',
      'Khối đỏ chưa nằm yên khi hết giờ ở lượt 1',
    ]);
  });

  it('numbers objects that share a noun and a colour, and only those', () => {
    const names = (of: Scenario, index: number) => of.arena.objects.map((object) => objectName(viText, of, object.id, index));
    expect(names(scenario, 0)).toEqual(['khối đỏ', 'bệ vàng', 'kiện hàng 1', 'kiện hàng 2', 'kiện hàng 3', 'vật']);
    const twoRed = loadScenario({
      ...pickPlace,
      variants: { ...pickPlace.variants, objectColors: undefined },
      arena: { ...pickPlace.arena, objects: [...pickPlace.arena.objects, { id: 'cube-2', shape: 'box', centerCm: [85, 100], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#d32f2f' }] },
    });
    expect(names(twoRed, 0)).toEqual(['khối đỏ 1', 'bệ vàng', 'kiện hàng 1', 'kiện hàng 2', 'kiện hàng 3', 'vật', 'khối đỏ 2']);
    // In round 2 of the fixture the cube is green, so the second red cube is the only red one.
    const twoCubes = loadScenario({
      ...pickPlace,
      arena: { ...pickPlace.arena, objects: [...pickPlace.arena.objects, { id: 'cube-2', shape: 'box', centerCm: [85, 100], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#d32f2f' }] },
    });
    expect([objectName(viText, twoCubes, 'cube', 0), objectName(viText, twoCubes, 'cube', 1), objectName(viText, twoCubes, 'cube-2', 1)]).toEqual(['khối đỏ 1', 'khối xanh lá', 'khối đỏ']);
    expect(objectName(enText, twoRed, 'cube-2', 0)).toBe('red cube 2');
    expect(objectName(enText, scenario, 'parcel-3', 0)).toBe('parcel 3');
    expect(objectName(enText, scenario, 'base', 0)).toBe('the yellow base');
    expect(objectName(enText, scenario, 'can', 0)).toBe('the object');
  });

  it('says "another zone" for a zone with no name, and "the object" without a scenario to name it from', () => {
    expect(why(viText, 'vi', 'place-cube', failed('place-cube', goalReasons.objectWrongZone, { detail: { zoneId: 'bare' } }), 0)).toBe('Khối đỏ nằm ở vùng khác ở lượt 1');
    const bare = goalFailureText(viText, 'vi', goal('place-cube'), failed('place-cube', goalReasons.objectTipped), round(0));
    expect(bare).toBe('Vật bị đổ ở lượt 1');
  });

  it('puts the first letter in upper case as the language writes it, and leaves the rest', () => {
    expect(capitalise('khối đỏ', 'vi')).toBe('Khối đỏ');
    expect(capitalise('đèn', 'vi')).toBe('Đèn');
    expect(capitalise('ống hút', 'vi')).toBe('Ống hút');
    expect(capitalise('the red cube', 'en')).toBe('The red cube');
    expect(capitalise('Xe chạm tường', 'vi')).toBe('Xe chạm tường');
    expect(capitalise('', 'vi')).toBe('');
  });

  it('knows the four colours of the palette by name, whatever the case of their digits, and no other', () => {
    expect(bodyPalette).toEqual({ red: '#d32f2f', green: '#388e3c', blue: '#1976d2', yellow: '#fbc02d' });
    expect([bodyColorName('#D32F2F'), bodyColorName('#fbc02d'), bodyColorName('#123456'), bodyColorName(undefined)]).toEqual(['red', 'yellow', undefined, undefined]);
  });

  it('gives each goal of the report its reasons with the names of each round', () => {
    const result: RobotCheckResult = {
      passed: false,
      goals: scenario.goals.map((spec) => ({ id: spec.id, label: spec.label.vi, passed: spec.id !== 'deliver-2' })),
      score: 90,
      maxScore: 100,
      simTimeMs: 60000,
      variants: [0, 1, 2].map((index) => ({ seed: 7 + index, passed: index !== 1, score: index === 1 ? 90 : 100, simTimeMs: 60000 })),
      engine: ROBOT_ENGINE,
      scenarioVersion: 1,
      programHash: 'ab',
    };
    const report = checkReport(scenario, result, [round(0), round(1, [failed('deliver-2', goalReasons.objectDropped, { atS: 8.2 })]), round(2)], viText, 'vi');
    expect(report.goals.find((line) => line.id === 'deliver-2')).toEqual({ id: 'deliver-2', label: 'Giao kiện hàng 2', points: 10, passed: false, why: ['Xe làm rơi kiện hàng 2 lúc 8,2 s ở lượt 2'] });
  });
});
