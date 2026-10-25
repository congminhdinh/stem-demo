import { describe, expect, it } from 'vitest';
import fixture from '../../core/scenario/__fixtures__/all-goals.scenario.json';
import { ScenarioError } from '../../core/scenario/scenario';
import { robotTemplateKeys } from '../robot-templates';
import { createScenarioCatalog, scenarioCatalog } from './index';

describe('scenarioCatalog', () => {
  it('has one valid scenario for each rb-*.json file of this folder, each named after its key, in the order of the lessons', () => {
    const files = Object.keys(import.meta.glob('./rb-*.json'));
    expect(scenarioCatalog.scenarios).toHaveLength(files.length);
    expect(scenarioCatalog.scenarios.map((scenario) => scenario.key)).toEqual(robotTemplateKeys.filter((key) => files.includes(`./${key}.json`)));
    for (const scenario of scenarioCatalog.scenarios) {
      expect(scenarioCatalog.get(scenario.key)).toBe(scenario);
      expect(scenario.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('knows no scenario it was not given', () => {
    expect(scenarioCatalog.get('rb-nope')).toBeUndefined();
    expect(scenarioCatalog.get('constructor')).toBeUndefined();
    expect(scenarioCatalog.get('toString')).toBeUndefined();
  });
});

describe('createScenarioCatalog', () => {
  const sandbox = () => {
    const scenario = structuredClone(fixture) as Record<string, unknown>;
    return { ...scenario, key: 'rb-sandbox', goals: [], scoring: {}, toolbox: undefined };
  };

  it('loads the files it is given and hands them out by key', () => {
    const catalog = createScenarioCatalog({ './rb-mini-mission.json': fixture });
    expect(catalog.scenarios.map((scenario) => scenario.key)).toEqual(['rb-mini-mission']);
    expect(catalog.get('rb-mini-mission')?.version).toBe(1);
    expect(catalog.get('rb-sandbox')).toBeUndefined();
  });

  it('lists the scenarios in the order of robotTemplateKeys, whatever order the files came in', () => {
    const catalog = createScenarioCatalog({ './rb-sandbox.json': sandbox(), './rb-mini-mission.json': fixture });
    expect(catalog.scenarios.map((scenario) => scenario.key)).toEqual(['rb-mini-mission', 'rb-sandbox']);
  });

  it('takes the file name from the end of the path, as a bundler writes it', () => {
    expect(createScenarioCatalog({ '/src/samples/robot-scenarios/rb-mini-mission.json': fixture }).scenarios).toHaveLength(1);
  });

  it('refuses a file that is not named after the key of the scenario in it', () => {
    expect(() => createScenarioCatalog({ './rb-line-follow.json': fixture })).toThrow(
      'robot-scenarios/rb-line-follow.json holds the scenario "rb-mini-mission": a scenario file is named after its key',
    );
  });

  it('refuses a scenario that does not validate, saying which scenario and which path', () => {
    const broken = structuredClone(fixture) as { goals: { zone?: string }[] };
    broken.goals[0]!.zone = 'nowhere';
    expect(() => createScenarioCatalog({ './rb-mini-mission.json': broken })).toThrow(ScenarioError);
    expect(() => createScenarioCatalog({ './rb-mini-mission.json': broken })).toThrow('goals[0].zone: no zone "nowhere"');
  });
});
