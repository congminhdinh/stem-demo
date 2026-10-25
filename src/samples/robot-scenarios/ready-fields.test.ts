import { describe, expect, it } from 'vitest';
import readyFieldsSource from './ready-fields.ts?raw';
import { scenarioMaxScore } from '../../core/scenario/scenario';
import { robotTemplateKeys } from '../robot-keys';
import { robotReadyFields, robotReadyGoals } from '../robot-templates';
import { scenarioCatalog } from './index';
import { readyFieldsOf, scenarioReadyFields, scenarioReadyGoals } from './ready-fields';

// N18 R5.2: what `ready` tells the host of a robot scenario (plan §4.7), its version and top score, comes from the scenario files, the same
// files the catalog validates, instead of numbers written in robot-templates.ts. It is read without the scenario schema, which the main
// bundle must not carry (the schema pulls the arena's, under src/core/world: e2e/robot-bundle.spec.ts); this pins it to the catalog.

describe('readyFieldsOf', () => {
  it('gives each file its version and its top score: the points of its goals plus its time bonus', () => {
    const table = readyFieldsOf({
      version: { './rb-line-follow.json': 3, '/src/samples/robot-scenarios/rb-mini-mission.json': 1 },
      goals: { './rb-line-follow.json': [{ points: 60 }, { points: 25 }], '/src/samples/robot-scenarios/rb-mini-mission.json': [{ points: 90 }] },
      scoring: { './rb-line-follow.json': { timeBonusMax: 15 }, '/src/samples/robot-scenarios/rb-mini-mission.json': {} },
    });
    expect(table.get('rb-line-follow')).toEqual({ scenarioVersion: 3, maxScore: 100 });
    expect(table.get('rb-mini-mission')).toEqual({ scenarioVersion: 1, maxScore: 90 });
    expect(table.get('rb-sandbox')).toBeUndefined();
  });

  it('gives the sandbox no top score (the field is left out, never null)', () => {
    const table = readyFieldsOf({ version: { './rb-sandbox.json': 2 }, goals: { './rb-sandbox.json': [] }, scoring: { './rb-sandbox.json': {} } });
    expect(table.get('rb-sandbox')).toEqual({ scenarioVersion: 2 });
    expect(Object.hasOwn(table.get('rb-sandbox') ?? {}, 'maxScore')).toBe(false);
  });

  it('refuses a file that lacks one of the fields it reads', () => {
    expect(() => readyFieldsOf({ version: { './rb-sandbox.json': 1 }, goals: {}, scoring: { './rb-sandbox.json': {} } })).toThrow(
      'robot-scenarios/rb-sandbox.json: no goals',
    );
  });
});

describe('the ready fields of the scenarios this build ships', () => {
  it.each(robotTemplateKeys)('%s: the version and top score of its catalog scenario', (key) => {
    const scenario = scenarioCatalog.get(key);
    expect(scenario).toBeDefined();
    const maxScore = scenarioMaxScore(scenario!);
    const expected = maxScore === undefined ? { scenarioVersion: scenario!.version } : { scenarioVersion: scenario!.version, maxScore };
    expect(scenarioReadyFields(key)).toEqual(expected);
    expect(robotReadyFields(key)).toEqual(expected);
  });

  // N18 R6.3: `ready` lists the goals a scored check-result then lists, in the same order (lab-embed-contract §2).
  it.each(robotTemplateKeys)('%s: the goals of its catalog scenario, id and label, in its order', (key) => {
    const scenario = scenarioCatalog.get(key)!;
    expect(scenarioReadyGoals(key)).toEqual(scenario.goals.map((goal) => ({ id: goal.id, label: goal.label })));
    expect(robotReadyGoals(key, 'vi')).toEqual(scenario.goals.map((goal) => ({ id: goal.id, label: goal.label.vi })));
    expect(robotReadyGoals(key, 'en')).toEqual(scenario.goals.map((goal) => ({ id: goal.id, label: goal.label.en })));
  });

  it('imports the scenario files and the key table only, never the scenario schema or the world, and each file as Node reads JSON', () => {
    const imports = [...readyFieldsSource.matchAll(/^\s*import\b[^;]*?\bfrom\s+['"]([^'"]+)['"]([^;\n]*)/gm)].map((match) => [match[1], match[2]!.trim()]);
    expect(imports).toEqual([
      ['../robot-keys', ''],
      ...[...robotTemplateKeys].sort().map((key) => [`./${key}.json`, "with { type: 'json' }"]),
    ]);
    expect(readyFieldsSource).not.toMatch(/'rb-sandbox'|"rb-sandbox"/);
  });
});
