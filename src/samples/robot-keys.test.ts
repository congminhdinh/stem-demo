import { describe, expect, it, vi } from 'vitest';
import catalogSource from './robot-scenarios/index.ts?raw';
import keysSource from './robot-keys.ts?raw';
import templatesSource from './robot-templates.ts?raw';
import schemaSource from '../core/scenario/scenario-schema.ts?raw';
import scenarioSource from '../core/scenario/scenario.ts?raw';
import { isRobotKitId, robotKitId, robotKits, robotKitVersion, robotKitVersionOf, robotLabProfiles, robotSandboxKey, robotTemplateKeys, robotTemplates } from './robot-keys';
import * as templates from './robot-templates';

// robot-keys.ts is the leaf under robot-templates.ts, the scenario schema and the scenario catalog. R5.2 makes robot-templates.ts read the
// catalog (`robotReadyFields`); had the schema and the catalog kept importing robot-templates.ts, the four would be a cycle
// (robot-templates → robot-scenarios → core/scenario → scenario-schema → robot-templates) and the first import of any of them would have
// thrown a ReferenceError on a binding not yet initialised.

/** The imports of a module’s source: the text after `from` in each import statement, comments left out. */
function importsOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
}

describe('robot-keys.ts', () => {
  it('imports nothing', () => {
    expect(importsOf(keysSource)).toEqual([]);
    expect(keysSource).not.toMatch(/^\s*import\b/m);
    expect(keysSource).not.toMatch(/\bimport\s*\(/);
  });

  it('is the one place that writes the sandbox key', () => {
    expect(robotSandboxKey).toBe('rb-sandbox');
    expect(keysSource.match(/'rb-sandbox'/g)).toHaveLength(1);
    for (const [name, source] of [
      ['robot-templates.ts', templatesSource],
      ['scenario-schema.ts', schemaSource],
      ['scenario.ts', scenarioSource],
      ['robot-scenarios/index.ts', catalogSource],
    ] as const) {
      expect(source, name).not.toMatch(/'rb-sandbox'|"rb-sandbox"/);
    }
  });

  it('is what robot-templates.ts re-exports, the same objects', () => {
    expect(templates.robotTemplateKeys).toBe(robotTemplateKeys);
    expect(templates.robotTemplates).toBe(robotTemplates);
    expect(templates.robotLabProfiles).toBe(robotLabProfiles);
    expect(templates.robotKitId).toBe(robotKitId);
    expect(templates.robotSandboxKey).toBe(robotSandboxKey);
    expect(robotTemplateKeys).toEqual(['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack', 'rb-sandbox']);
  });
});

describe('the kits of the robot labs (N19 A1, plan D-G1)', () => {
  // The seven keys the pilot course and the sandbox shipped with, which run on the rover for good: written out, so that a key a later task adds
  // (on another kit) is neither a row here nor a failure of this test.
  const shippedRoverKeys = ['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-sandbox'] as const;

  it('lists the rover at version 0, and every kit with a version', () => {
    expect(robotKits['ref-uno-rover']).toBe('0');
    expect(robotKitVersionOf('ref-uno-rover')).toBe('0');
    for (const id of Object.keys(robotKits) as (keyof typeof robotKits)[]) {
      expect(robotKitVersionOf(id), id).toBe(robotKits[id]);
      expect(isRobotKitId(id), id).toBe(true);
    }
  });

  it.each(shippedRoverKeys)('%s runs on the rover', (key) => {
    expect(robotTemplateKeys).toContain(key);
    expect(robotTemplates[key].kit).toBe('ref-uno-rover');
  });

  it('gives every key of the table a kit the table lists', () => {
    for (const key of robotTemplateKeys) {
      expect(isRobotKitId(robotTemplates[key].kit), key).toBe(true);
    }
  });

  it('says which ids are kits: an exact match, not a lookup that finds "constructor"', () => {
    expect(isRobotKitId('ref-uno-rover')).toBe(true);
    expect(['vendor-kit', 'constructor', 'toString', '__proto__', '', 'REF-UNO-ROVER'].map(isRobotKitId)).toEqual([false, false, false, false, false, false]);
  });

  it('keeps the two old names as aliases of the rover and its version, for the readers that have not moved', () => {
    expect([robotKitId, robotKitVersion]).toEqual(['ref-uno-rover', robotKitVersionOf('ref-uno-rover')]);
  });

  it('is what robot-templates.ts re-exports, the same objects', () => {
    expect(templates.robotKits).toBe(robotKits);
    expect(templates.robotKitVersionOf).toBe(robotKitVersionOf);
    expect(templates.isRobotKitId).toBe(isRobotKitId);
  });
});

describe('who imports what', () => {
  it('the scenario schema, the loader and the catalog read the keys from robot-keys.ts and never import robot-templates.ts', () => {
    for (const [name, source] of [
      ['scenario-schema.ts', schemaSource],
      ['scenario.ts', scenarioSource],
      ['robot-scenarios/index.ts', catalogSource],
    ] as const) {
      expect(importsOf(source).filter((path) => path.includes('robot-templates')), name).toEqual([]);
    }
    expect(importsOf(schemaSource)).toContain('../../samples/robot-keys');
    expect(importsOf(catalogSource)).toContain('../robot-keys');
  });
});

describe('module load order', () => {
  const modules = {
    templates: () => import('./robot-templates'),
    catalog: () => import('./robot-scenarios/index'),
    scenario: () => import('../core/scenario/scenario'),
  };
  const names = Object.keys(modules) as (keyof typeof modules)[];
  const orders = names.flatMap((a) => names.flatMap((b) => names.filter((c) => c !== a && c !== b && a !== b).map((c) => [a, b, c] as const)));

  it('has all six orders to try', () => {
    expect(orders).toHaveLength(6);
  });

  it.each(orders)('imports %s, %s, %s from a clean module cache without an error', async (first, second, third) => {
    vi.resetModules();
    for (const name of [first, second, third]) {
      await expect(modules[name]()).resolves.toBeDefined();
    }
    // Whatever order they came in, they agree on the table, and a catalog scenario is one of its keys.
    const [templatesModule, catalogModule, scenarioModule] = await Promise.all([modules.templates(), modules.catalog(), modules.scenario()]);
    for (const scenario of catalogModule.scenarioCatalog.scenarios) {
      expect(templatesModule.isRobotTemplateKey(scenario.key)).toBe(true);
    }
    expect(scenarioModule.loadScenario).toBeTypeOf('function');
  });
});
