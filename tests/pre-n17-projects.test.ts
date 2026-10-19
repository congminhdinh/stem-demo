import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../src/core/circuit/document';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { readStoredProject } from '../src/core/persistence/project-repository';
import { productionProfiles } from '../src/core/profiles';
import { createBlockPackCatalog } from '../src/core/program/block-packs';
import { canOpenProgram } from '../src/ui/blockly/editor-blocks';
import projectData from './pre-n17/projects.json';
import runData from './pre-n17/runs.json';
import { record, type OldProject, type Recording } from './pre-n17/record';

// Review Focus 5 of N17 (task B6): a project saved before N17 opens and runs exactly as before, at both levels.
// `pre-n17/projects.json` holds projects in the shape the editor saved before N17 (a picture without a colour field, a
// scroll without a colour input): the four lesson solutions as they were, and four projects of our own that use the
// display, the buttons and their presses, the light, the buzzer, variables, loops, prints, a knob on P2 and an LED on P0.
// `pre-n17/runs.json` is what the code of commit 1ee5fa5 (the last one before N17 B1) did with each of them, in each profile,
// recorded by the same harness (`pre-n17/record.ts`): the Python, the start, and every change of the run on fake timers.
// Not recorded, on purpose: a floating header pin, whose read stopped the program before N17 and now reads 0 with a
// warning (the owner's decision in N17 B4, contract §26).

const projects = projectData as unknown as OldProject[];
const runs = runData as unknown as Record<string, Record<string, Recording>>;
const profiles = ['ybc-basic', 'ybc-advanced'] as const;
const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a project saved before N17 (Review Focus 5)', () => {
  it('covers the four lessons and four projects of our own, recorded in both profiles', () => {
    expect(projects.map((project) => project.name)).toEqual([
      'template-solution-ybc-heart',
      'template-solution-ybc-button-ab',
      'template-solution-ybc-night-light',
      'template-solution-ybc-melody',
      'pictures-and-buttons',
      'night-light-notes',
      'knob-and-led',
      'loops-and-presses',
    ]);
    for (const project of projects) {
      expect(Object.keys(runs[project.name] ?? {})).toEqual([...profiles]);
      // The shape of before N17: no picture carries a colour field, no scroll a colour input.
      expect(JSON.stringify(project.document)).not.toContain('COLOUR');
    }
  });

  describe.each(projects.map((project) => [project.name, project] as const))('%s', (_, project) => {
    it.each(profiles)('opens in the editor with the profile %s (real Blockly, every pack)', (profile) => {
      const stored = { ...(project.document as ProjectDocument), profile };
      expect(canOpenProgram(stored.program.blocks, packs)).toBe(true);
      expect(readStoredProject(stored, registry, (blocks) => canOpenProgram(blocks, packs), productionProfiles)).toEqual(stored);
    });

    it.each(profiles)('with the profile %s: the same Python, the same start and the same run, change by change, as before N17', async (profile) => {
      expect(await record(project, profile)).toEqual(runs[project.name]?.[profile]);
    });
  });
});
