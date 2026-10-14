import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteComponent } from '../core/circuit/components';
import { createNewProject } from '../core/circuit/document';
import { openLastProject } from '../core/persistence/project-repository';
import {
  createFixtureEnvironment,
  fixtureComponents,
  fixtureDocument,
  programWithMarker,
} from '../core/profiles/__fixtures__/test-profiles';
import { resolveBoardContext } from '../core/profiles/board-context';
import { reportLayers } from '../core/profiles/validity';
import { createTemplateProject } from '../samples/templates';
import { createDexieProjectRepository } from './dexie-project-repository';

// Save and reload through IndexedDB (fake-indexeddb) for every state the board
// context allows (plan §8.5 acceptance, §8.7): the document comes back
// deep-equal and resolves to the same context. Profile mechanics use the
// test-only fixtures; the lowering round trip with real Advanced constructs is YB-7.

const { registry, profiles, packs } = createFixtureEnvironment();
const anyProgram = () => true;
let databaseCount = 0;
const freshDatabase = () => `stem-studio-profile-${++databaseCount}`;

/** Saves the document, then opens the app on the same database again, as the next page load would. */
async function reload(document: ReturnType<typeof fixtureDocument>) {
  const name = freshDatabase();
  await createDexieProjectRepository(name).save(document);
  return openLastProject(createDexieProjectRepository(name), registry, {
    sample: () => createTemplateProject('blink'),
    newId: () => 'new',
    canOpenProgram: anyProgram,
    profiles,
  });
}
const contextOf = (document: ReturnType<typeof fixtureDocument>) => resolveBoardContext(document, registry, profiles);

describe('reload keeps every valid editing state', () => {
  const states: [string, ReturnType<typeof fixtureDocument>][] = [
    ['generic, no board (the empty template)', createTemplateProject('empty')],
    ['generic, one board', createTemplateProject('blink')],
    ['generic, several boards', { ...createNewProject('two'), circuit: { components: [{ id: 'a', deviceType: 'board', position: { x: 0, y: 0 } }, { id: 'b', deviceType: 'board', position: { x: 50, y: 0 } }], wires: [] } }],
    ['ybc-basic, one board, empty program', fixtureDocument('ybc-basic')],
    ['ybc-advanced, one board, empty program', fixtureDocument('ybc-advanced')],
    ['ybc-basic, board deleted', { ...fixtureDocument('ybc-basic'), circuit: deleteComponent(fixtureDocument('ybc-basic').circuit, 'ybc-board-1') }],
    ['ybc-basic, two boards', fixtureDocument('ybc-basic', { components: [fixtureComponents.board, { ...fixtureComponents.board, id: 'second' }] })],
    ['ybc-basic, a generic board among the devices (data only)', fixtureDocument('ybc-basic', { components: [fixtureComponents.board, { id: 'g', deviceType: 'board', position: { x: 0, y: 0 } }] })],
  ];

  it.each(states)('%s', async (_, document) => {
    const opened = await reload(document);

    expect(opened).toEqual({ document, notice: null, canSave: true });
    expect(contextOf(opened.document)).toEqual(contextOf(document));
  });
});

describe('content outside the profile survives a save and a reload (plan §8.7)', () => {
  const lowered = fixtureDocument('test-base', {
    components: [fixtureComponents.board, fixtureComponents.testDevice],
    blocks: programWithMarker(),
  });

  it('keeps the block and the device, deep-equal, and the profile', async () => {
    const opened = await reload(lowered);

    expect(opened.notice).toBeNull();
    expect(opened.document).toEqual(lowered);
    expect(opened.document.profile).toBe('test-base');
    expect(opened.document.circuit.components.map((c) => c.deviceType)).toEqual(['ybc-board', 'test-device']);
    expect(JSON.stringify(opened.document.program.blocks)).toContain('test_marker');
  });

  it('is still outside the profile after the reload, with the same diagnostics, and fine once test-extended', async () => {
    const opened = await reload(lowered);
    const before = reportLayers(lowered, contextOf(lowered), packs);

    expect(reportLayers(opened.document, contextOf(opened.document), packs)).toEqual(before);
    expect(before.profileCompatible.map((d) => d.code)).toEqual(['not-in-profile', 'incompatible-devices']);

    const raised = await reload({ ...lowered, profile: 'test-extended' });
    expect(reportLayers(raised.document, contextOf(raised.document), packs).profileCompatible).toEqual([]);
  });

  it('lowering test-extended to test-base and reloading loses nothing', async () => {
    const extended = { ...lowered, profile: 'test-extended' };
    const afterSwitch = await reload({ ...extended, profile: 'test-base' });
    expect(afterSwitch.document).toEqual(lowered);
  });
});

describe('a profile nobody knows does not open', () => {
  it('starts a new project with the existing notice (R-F2)', async () => {
    const opened = await reload({ ...fixtureDocument('ybc-basic'), profile: 'ybc-expert' });

    expect(opened.document).toEqual(createNewProject('new'));
    expect(opened.notice).toEqual({
      message: 'The saved project could not be opened, so a new project was started.',
      about: 'opened-project',
    });
  });
});
