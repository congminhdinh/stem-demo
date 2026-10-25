import { describe, expect, it } from 'vitest';
import fixture from '../../core/scenario/__fixtures__/all-goals.scenario.json';
import { MANIFEST_SCHEMA, robotScenarioManifest, serializeManifest } from './manifest';
import { createScenarioCatalog } from './index';

// N18 R7.1: the list of the robot scenarios this build ships, for the repositories that name them by key (STEMLearning's LabTemplateCatalog,
// its appsettings, its pin test). It is read from the catalog, so it can never say a scenario that the lab does not have.

const miniMission = () => structuredClone(fixture) as Record<string, unknown>;
const sandbox = () => ({ ...miniMission(), key: 'rb-sandbox', title: { vi: 'Sân tập tự do', en: 'Free play' }, goals: [], scoring: {}, toolbox: undefined });

describe('robotScenarioManifest', () => {
  it('is empty while the catalog is', () => {
    expect(robotScenarioManifest(createScenarioCatalog({}))).toEqual({ schema: MANIFEST_SCHEMA, scenarios: [] });
  });

  it('lists, for each scenario, its key, version, titles, goal ids, top score, profile and whether it has goals', () => {
    const manifest = robotScenarioManifest(createScenarioCatalog({ './rb-mini-mission.json': miniMission() }));
    expect(manifest).toEqual({
      schema: 'robot-scenarios/v1',
      scenarios: [
        {
          key: 'rb-mini-mission',
          version: 1,
          title: { vi: 'Bài thử: đủ mọi loại mục tiêu', en: 'Fixture: every goal kind' },
          goalIds: ['reach-dock', 'route', 'on-line', 'no-bump', 'push-crate', 'park', 'gate-open', 'in-time', 'loop'],
          maxScore: 100,
          profile: 'uno-basic',
          hasGoals: true,
        },
      ],
    });
  });

  it('leaves the top score out for the sandbox (no goals, no score), never null', () => {
    const [entry] = robotScenarioManifest(createScenarioCatalog({ './rb-sandbox.json': sandbox() })).scenarios;
    expect(entry).toEqual({ key: 'rb-sandbox', version: 1, title: { vi: 'Sân tập tự do', en: 'Free play' }, goalIds: [], profile: 'uno-basic', hasGoals: false });
    expect(Object.hasOwn(entry ?? {}, 'maxScore')).toBe(false);
  });

  it('lists the scenarios in the order of the lessons, whatever order the files came in', () => {
    const files = { './rb-sandbox.json': sandbox(), './rb-mini-mission.json': miniMission() };
    const reversed = { './rb-mini-mission.json': miniMission(), './rb-sandbox.json': sandbox() };
    const keys = (input: typeof files) => robotScenarioManifest(createScenarioCatalog(input)).scenarios.map((entry) => entry.key);
    expect(keys(files)).toEqual(['rb-mini-mission', 'rb-sandbox']);
    expect(keys(reversed)).toEqual(['rb-mini-mission', 'rb-sandbox']);
  });
});

describe('serializeManifest', () => {
  it('writes the same text for the same manifest: keys sorted at every depth, two-space indent, one newline at the end', () => {
    const manifest = robotScenarioManifest(createScenarioCatalog({ './rb-mini-mission.json': miniMission(), './rb-sandbox.json': sandbox() }));
    const text = serializeManifest(manifest);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(serializeManifest(structuredClone(manifest))).toBe(text);

    const keysOf = (value: unknown): string[][] =>
      Array.isArray(value) ? value.flatMap(keysOf) : value !== null && typeof value === 'object' ? [Object.keys(value), ...Object.values(value).flatMap(keysOf)] : [];
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toEqual(manifest);
    for (const keys of keysOf(parsed)) {
      expect(keys).toEqual([...keys].sort());
    }
    expect(text.split('\n')[1]).toBe('  "scenarios": [');
    expect(text.split('\n')[2]).toBe('    {');
    expect(text.split('\n')[3]).toBe('      "goalIds": [');
  });

  it('does not depend on the order the fields were written in', () => {
    const manifest = robotScenarioManifest(createScenarioCatalog({ './rb-mini-mission.json': miniMission() }));
    const entry: Record<string, unknown> = { ...manifest.scenarios[0] };
    const shuffled = { scenarios: [Object.fromEntries(Object.entries(entry).reverse())], schema: manifest.schema };
    expect(serializeManifest(shuffled as unknown as typeof manifest)).toBe(serializeManifest(manifest));
  });
});
