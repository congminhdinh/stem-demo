import { describe, expect, it } from 'vitest';
import allGoals from './__fixtures__/all-goals.scenario.json';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { productionKits } from '../hardware/catalog';
import { fnv1a32 } from '../world/snapshot';
import { buildArenaMat, buildTiledSheet } from './arena-mat';
import { loadScenario, scenarioKitRef, type Scenario } from './scenario';
import { applyVariant, kitFootprintRadiusCm, variantOffsets } from './variants';

// N19 D1–D3 guard (plan D-G10, common rules "the rover never changes"): what N19 adds to the scenario schema, the variants and the printed
// mat is optional and unused by every N18 scenario, so each of them loads, varies and prints exactly as it did. The numbers are FNV-1a of
// the JSON text, measured on master 675cff6 before D1: the parse output (its key order included), every variant's offsets and the start and
// arena they give, the seeds, the mat's SVG and the A4 sheets' HTML. A change of any byte of them is a change of an N18 lesson.

const pinned: Readonly<Record<string, { parse: string; offsets: string; applied: string; seeds: number[]; svg: string; sheet: string }>> = {
  'rb-drive-to-zone': { parse: '708a17aa', offsets: 'f9108445', applied: '66d12fbe', seeds: [1], svg: 'ce3b0e29', sheet: '71de8dde' },
  'rb-square-route': { parse: '8e6492fc', offsets: 'bc66dd94', applied: '7f54edcd', seeds: [2], svg: '20e909c5', sheet: '6ad4a874' },
  'rb-stop-at-wall': { parse: '6d5fe49a', offsets: 'd8c1e44d', applied: '2c0855f8', seeds: [3004, 3005, 3006], svg: '801d63d3', sheet: '587848db' },
  'rb-line-follow': { parse: '6c441f46', offsets: '42fddd38', applied: 'ef2d361c', seeds: [485, 486, 487], svg: '98d69834', sheet: '404fcb11' },
  'rb-servo-gate': { parse: '93e9fc1b', offsets: 'a5cf1a85', applied: 'b4ca78c6', seeds: [1409, 1410, 1411], svg: 'a408f717', sheet: '88e7458f' },
  'rb-mini-mission': { parse: '93e5c61d', offsets: '3c39f023', applied: '92ea3a56', seeds: [3225, 3226, 3227], svg: 'c7617a4c', sheet: 'c6b0557c' },
  'rb-sandbox': { parse: 'fbf9f5a7', offsets: 'e016b0ec', applied: 'f75dccb3', seeds: [0], svg: 'aecc63fa', sheet: '6ba313c0' },
  'all-goals': { parse: '137cc75d', offsets: '1a5aedcc', applied: 'a2a00311', seeds: [2026, 2027, 2028], svg: 'b7fec9d4', sheet: '0c0b879b' },
};

const radiusOf = (scenario: Scenario): number => kitFootprintRadiusCm(productionKits.get(scenarioKitRef(scenario)!)!);
// The N18 scenarios only (N19 D4: the gripper lessons use the N19 keys by design and are pinned by tests/robot-scenarios.test.ts).
const cases: [string, Scenario][] = [
  ...scenarioCatalog.scenarios.filter((scenario) => scenario.key in pinned).map((scenario): [string, Scenario] => [scenario.key, scenario]),
  ['all-goals', loadScenario(allGoals)],
];

describe('the N18 scenarios after N19 D1 (master 675cff6 numbers)', () => {
  it('covers the seven shipped scenarios and the schema fixture', () => {
    expect(cases.map(([name]) => name)).toEqual(Object.keys(pinned));
  });

  it.each(cases)('%s loads to the same JSON, varies to the same offsets, starts, arenas and seeds, and prints the same mat', (name, scenario) => {
    const pin = pinned[name]!;
    const offsets = Array.from({ length: scenario.variants.count }, (_, index) => variantOffsets(scenario, index, radiusOf(scenario)));
    expect(fnv1a32(JSON.stringify(scenario))).toBe(pin.parse);
    expect(fnv1a32(JSON.stringify(offsets))).toBe(pin.offsets);
    expect(fnv1a32(JSON.stringify(offsets.map((variant) => applyVariant(scenario, variant))))).toBe(pin.applied);
    expect(offsets.map((variant) => variant.seed)).toEqual(pin.seeds);
    expect(fnv1a32(buildArenaMat(scenario).svg)).toBe(pin.svg);
    expect(fnv1a32(buildTiledSheet(scenario).html)).toBe(pin.sheet);
  });

  it.each(cases)('%s has none of the N19 keys: no object jitter or colours, no zone names, no nouns or body colours', (_name, scenario) => {
    expect(scenario.variants).not.toHaveProperty('objectJitter');
    expect(scenario.variants).not.toHaveProperty('objectColors');
    expect(scenario.arena.paint.zones.filter((zone) => 'name' in zone)).toEqual([]);
    expect(scenario.arena.objects.filter((object) => 'noun' in object || 'color' in object)).toEqual([]);
    for (const body of [...scenario.arena.walls, ...scenario.arena.boxes, ...scenario.arena.cylinders]) expect(body).not.toHaveProperty('color');
    for (let index = 0; index < scenario.variants.count; index++) expect(variantOffsets(scenario, index, radiusOf(scenario))).not.toHaveProperty('objects');
  });
});
