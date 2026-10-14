import { describe, expect, it } from 'vitest';
import { createNewProject } from '../circuit/document';
import { inspectStoredProject, readStoredProject } from '../persistence/project-repository';
import { buildToolbox } from '../program/block-packs';
import { createTemplateProject } from '../../samples/templates';
import {
  createFixtureEnvironment,
  fixtureComponents,
  fixtureDocument,
  programWithMarker,
  testMarkerType,
} from './__fixtures__/test-profiles';
import { resolveBoardContext } from './board-context';
import { checkBoardReadiness, checkProfileBlocks, reportLayers } from './validity';

// The validity layers (plan §8.6) with the test-only fixtures (§8.7): a document
// outside its profile is loadable (L-1), not profile-compatible (L-2), and still
// the same document after it.

const { registry, profiles, packs } = createFixtureEnvironment();
const resolve = (document: Parameters<typeof resolveBoardContext>[0]) => resolveBoardContext(document, registry, profiles);
const anyProgram = () => true;

/** A document of test-base that holds content only test-extended has. */
const lowered = fixtureDocument('test-base', {
  components: [fixtureComponents.board, fixtureComponents.testDevice],
  blocks: programWithMarker(),
});

describe('L-1 loadable', () => {
  it('opens a document whose content is outside its profile: the structure is fine', () => {
    const result = inspectStoredProject(structuredClone(lowered), registry, anyProgram, profiles);
    expect(result).toEqual({ ok: true, document: lowered });
  });

  it('refuses an unknown profile, with a diagnostic that names it (R-F2)', () => {
    const result = inspectStoredProject({ ...lowered, profile: 'ybc-expert' }, registry, anyProgram, profiles);
    expect(result).toEqual({ ok: false, problem: { code: 'unknown-profile', message: '"ybc-expert" is not a known profile.' } });
    expect(readStoredProject({ ...lowered, profile: 'ybc-expert' }, registry, anyProgram, profiles)).toBeNull();
  });

  it('does not know the fixture profiles in production: they are the fixture catalog\'s alone', () => {
    expect(inspectStoredProject(structuredClone(lowered), registry, anyProgram)).toMatchObject({
      ok: false,
      problem: { code: 'unknown-profile' },
    });
  });

  it.each([
    ['a profile that is not text', { ...lowered, profile: 5 }],
    ['an empty profile', { ...lowered, profile: '' }],
  ])('refuses %s as a broken document', (_, stored) => {
    expect(inspectStoredProject(stored, registry, anyProgram, profiles)).toMatchObject({
      ok: false,
      problem: { code: 'invalid-document' },
    });
  });

  it('does not reject for the number of boards, devices of another family or blocks outside the profile', () => {
    const none = fixtureDocument('ybc-basic', { components: [] });
    for (const document of [none, lowered, createTemplateProject('empty')]) {
      expect(inspectStoredProject(structuredClone(document), registry, anyProgram, profiles).ok).toBe(true);
    }
    const mixed = { ...fixtureDocument('test-base'), circuit: { components: [fixtureComponents.board, { id: 'b', deviceType: 'board', position: { x: 0, y: 0 } }], wires: [] } };
    expect(inspectStoredProject(mixed, registry, anyProgram, profiles).ok).toBe(true);
  });

  it('says which structural check failed', () => {
    const unknownDevice = { ...lowered, circuit: { components: [{ id: 'x', deviceType: 'motor', position: { x: 0, y: 0 } }], wires: [] } };
    expect(inspectStoredProject(unknownDevice, registry, anyProgram, profiles)).toMatchObject({ problem: { code: 'unknown-device' } });
    const twice = { ...lowered, circuit: { components: [fixtureComponents.board, fixtureComponents.board], wires: [] } };
    expect(inspectStoredProject(twice, registry, anyProgram, profiles)).toMatchObject({ problem: { code: 'invalid-circuit' } });
    expect(inspectStoredProject(lowered, registry, () => false, profiles)).toMatchObject({ problem: { code: 'program-not-openable' } });
  });
});

describe('L-2 profile-compatible', () => {
  it('reports the out-of-profile block and device of a lowered document, and keeps them', () => {
    const before = structuredClone(lowered);
    const report = reportLayers(lowered, resolve(lowered), packs);
    expect(report.profileCompatible).toEqual([
      expect.objectContaining({ layer: 'L-2', code: 'not-in-profile', blockId: 'marker-1' }),
      expect.objectContaining({ layer: 'L-2', code: 'incompatible-devices', componentIds: ['test-device-1'] }),
    ]);
    expect(lowered).toEqual(before);
  });

  it('is satisfied once the document is test-extended', () => {
    const raised = { ...lowered, profile: 'test-extended' };
    expect(reportLayers(raised, resolve(raised), packs)).toEqual({ profileCompatible: [], runtimeReady: [] });
  });

  it('is satisfied by a document inside its profile, and by generic ones', () => {
    for (const document of [fixtureDocument('test-base'), createTemplateProject('blink'), createNewProject('p')]) {
      expect(reportLayers(document, resolve(document), packs).profileCompatible).toEqual([]);
    }
  });

  it('refuses a generic block in a YBC project, and a YBC-only block in a generic one', () => {
    const generic = createTemplateProject('blink');
    const ybcWithGenericBlocks = { ...fixtureDocument('ybc-basic'), program: generic.program };
    const blocks = checkProfileBlocks(ybcWithGenericBlocks.program.blocks, resolve(ybcWithGenericBlocks), packs);
    expect(blocks.map((d) => d.code)).toEqual(Array(blocks.length).fill('not-in-profile'));
    expect(blocks.length).toBeGreaterThan(0);

    const genericWithMarker = { ...createNewProject('p'), program: { blocks: programWithMarker() } };
    expect(checkProfileBlocks(genericWithMarker.program.blocks, resolve(genericWithMarker), packs)).toEqual([
      expect.objectContaining({ code: 'not-in-profile', blockId: 'marker-1' }),
    ]);
  });

  it('does not judge a block no pack owns (the compiler\'s unknown-block)', () => {
    const blocks = { blocks: { languageVersion: 0, blocks: [{ type: 'math_number', id: 'n' }] } };
    expect(checkProfileBlocks(blocks, resolve(fixtureDocument('ybc-basic')), packs)).toEqual([]);
  });

  it('survives a program of unknown shape', () => {
    for (const blocks of [null, 7, 'x', [], { blocks: 3 }, { blocks: { blocks: [null, 1, { type: 5 }] } }]) {
      expect(() => checkProfileBlocks(blocks, resolve(fixtureDocument('ybc-basic')), packs)).not.toThrow();
    }
  });

  it('finds a block nested in an input or a next chain', () => {
    const nested = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'stem_on_start', id: 'h', inputs: { DO: { block: { type: 'stem_wait', id: 'w', next: { block: { type: testMarkerType, id: 'deep' } } } } } },
        ],
      },
    };
    expect(checkProfileBlocks(nested, resolve(fixtureDocument('test-extended')), packs)).toEqual([
      expect.objectContaining({ blockId: 'w' }),
    ]);
  });
});

describe('L-3 runtime-ready (the board part; the compile part is the RunSession\'s)', () => {
  it('includes every L-2 problem and adds the board problems', () => {
    const noBoard = fixtureDocument('test-base', { components: [fixtureComponents.testDevice], blocks: programWithMarker() });
    const report = reportLayers(noBoard, resolve(noBoard), packs);
    expect(report.runtimeReady.map((d) => d.code)).toEqual(['not-in-profile', 'incompatible-devices']);
  });

  it('names no-board and multiple-boards as L-3', () => {
    expect(checkBoardReadiness(resolve(fixtureDocument('test-base', { components: [] })))).toEqual([
      expect.objectContaining({ layer: 'L-3', code: 'no-board' }),
    ]);
    const two = fixtureDocument('test-base', { components: [fixtureComponents.board, { ...fixtureComponents.board, id: 'second' }] });
    expect(checkBoardReadiness(resolve(two))).toEqual([
      expect.objectContaining({ layer: 'L-3', code: 'multiple-boards', componentIds: ['ybc-board-1', 'second'] }),
    ]);
  });

  it('is fine for a ready document', () => {
    expect(reportLayers(fixtureDocument('test-base'), resolve(fixtureDocument('test-base')), packs).runtimeReady).toEqual([]);
  });
});

describe('toolbox and palette follow the profile', () => {
  it('shows the structure for test-base and adds the Test category for test-extended', () => {
    const names = (profile: string) =>
      buildToolbox(resolve(fixtureDocument(profile)).blockPacks, packs).contents.map((category) => category.name);
    expect(names('test-base')).toEqual(['Program']);
    expect(names('test-extended')).toEqual(['Program', 'Test']);
  });

  it('never shows the test marker to a generic or production-profile project', () => {
    const shown = (document: Parameters<typeof resolve>[0]) =>
      JSON.stringify(buildToolbox(resolve(document).blockPacks, packs));
    expect(shown(createNewProject('p'))).not.toContain(testMarkerType);
    expect(shown(fixtureDocument('ybc-advanced'))).not.toContain(testMarkerType);
    expect(shown(fixtureDocument('test-base'))).not.toContain(testMarkerType);
    expect(shown(fixtureDocument('test-extended'))).toContain(testMarkerType);
  });
});
