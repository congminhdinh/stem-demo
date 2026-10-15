import { describe, expect, it } from 'vitest';
import { deleteComponent } from '../circuit/components';
import { createNewProject } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { createDefaultProgram } from '../program/blocks';
import { createTemplateProject } from '../../samples/templates';
import { createFixtureEnvironment, fixtureComponents, fixtureDocument, testDeviceType } from './__fixtures__/test-profiles';
import { capabilitiesOf, resolveBoardContext } from './board-context';
import { productionProfiles } from './index';

/** The block packs of both production profiles: the structure, the YB-3 hardware and the YB-2 language. */
const ybcPacks = ['ybc.structure', 'ybc.display', 'ybc.input', 'ybc.sound', 'lang.logic', 'lang.loops', 'lang.math', 'lang.text', 'lang.variables'];

const registry = createDeviceRegistry(localDeviceDefinitions);
const resolve = (document: Parameters<typeof resolveBoardContext>[0]) => resolveBoardContext(document, registry, productionProfiles);

const place = (id: string, deviceType: string) => ({ id, deviceType, position: { x: 100, y: 100 } });
const withComponents = (profile: string | undefined, ...components: { id: string; deviceType: string }[]) =>
  fixtureDocument(profile, { components: components.map((c) => place(c.id, c.deviceType)) });

describe('resolveBoardContext: the family comes from the document profile (R-F1)', () => {
  it('is generic when the document has no profile', () => {
    const context = resolve(createNewProject('p'));
    expect(context).toMatchObject({ family: 'generic', profile: null, blockPacks: ['generic.stem'] });
  });

  it.each(['ybc-basic', 'ybc-advanced'])('is ybc for the profile %s', (profile) => {
    const context = resolve(withComponents(profile));
    expect(context.family).toBe('ybc');
    expect(context.profile?.id).toBe(profile);
    expect(context.blockPacks).toEqual(ybcPacks);
  });

  it('does not depend on the boards present: a ybc project with only a generic board is still ybc', () => {
    const context = resolve(withComponents('ybc-basic', { id: 'b', deviceType: 'board' }));
    expect(context.family).toBe('ybc');
    expect(context.profile?.id).toBe('ybc-basic');
  });

  it('does not depend on the boards present: a generic project with a ybc board is still generic', () => {
    const context = resolve(withComponents(undefined, { id: 'y', deviceType: 'ybc-board' }));
    expect(context.family).toBe('generic');
    expect(context.profile).toBeNull();
  });

  it('throws for a profile the catalog does not know: such a document did not pass L-1 (R-F2)', () => {
    expect(() => resolve(withComponents('ybc-expert'))).toThrow('Unknown profile "ybc-expert"');
  });
});

describe('the generic editing states (R-F4, S16)', () => {
  it('has no board in the empty template: valid to edit, Run says no-board', () => {
    const context = resolve(createTemplateProject('empty'));
    expect(context.boards).toEqual([]);
    expect(context.readiness).toEqual({ ok: false, reason: 'no-board', componentIds: [] });
  });

  it('is ready with one board and reports its capabilities as digital only', () => {
    const blink = createTemplateProject('blink');
    const context = resolve(blink);
    expect(context.readiness).toMatchObject({ ok: true, board: { id: 'board' }, capabilities: ['digital'] });
    expect(context.incompatible).toEqual([]);
  });

  it('has several boards: valid to edit, Run says multiple-boards with their ids', () => {
    const context = resolve(withComponents(undefined, { id: 'one', deviceType: 'board' }, { id: 'two', deviceType: 'board' }));
    expect(context.boards.map((board) => board.id)).toEqual(['one', 'two']);
    expect(context.readiness).toEqual({ ok: false, reason: 'multiple-boards', componentIds: ['one', 'two'] });
  });

  it('keeps the generic devices allowed, in catalog order, and never the ybc board (GB9)', () => {
    expect(resolve(createNewProject('p')).allowedDeviceTypes).toEqual(['board', 'led', 'resistor', 'push-button']);
  });

  it('marks a ybc board in a generic project as incompatible and keeps it', () => {
    const document = withComponents(undefined, { id: 'b', deviceType: 'board' }, { id: 'y', deviceType: 'ybc-board' });
    const context = resolve(document);
    expect(context.incompatible.map((c) => c.id)).toEqual(['y']);
    expect(context.readiness).toEqual({ ok: false, reason: 'incompatible-devices', componentIds: ['y'] });
    expect(document.circuit.components).toHaveLength(2);
  });
});

describe('the YBC editing states (R-F4, R-F5)', () => {
  it('has no board: valid to edit, the toolbox and the profile stay, Run says no-board', () => {
    const context = resolve(withComponents('ybc-basic'));
    expect(context.profile?.id).toBe('ybc-basic');
    expect(context.blockPacks).toEqual(ybcPacks);
    expect(context.readiness).toEqual({ ok: false, reason: 'no-board', componentIds: [] });
  });

  it.each(['ybc-basic', 'ybc-advanced'])('is ready with exactly one ybc board in %s', (profile) => {
    const context = resolve(fixtureDocument(profile));
    expect(context.readiness).toMatchObject({ ok: true, board: { deviceType: 'ybc-board' } });
    expect(context.allowedDeviceTypes).toEqual(['ybc-board']);
  });

  it('reports the capabilities of the ybc board: pin capabilities and onboard parts, each once', () => {
    const context = resolve(fixtureDocument('ybc-basic'));
    expect(context.readiness.ok && context.readiness.capabilities).toEqual(['digital', 'analogIn', 'display', 'buttons', 'light', 'sound']);
    expect(capabilitiesOf(registry.get('ybc-board'))).toEqual(['digital', 'analogIn', 'display', 'buttons', 'light', 'sound']);
  });

  it('has several boards: valid to edit, Run says multiple-boards', () => {
    const context = resolve(withComponents('ybc-basic', { id: 'one', deviceType: 'ybc-board' }, { id: 'two', deviceType: 'ybc-board' }));
    expect(context.readiness).toEqual({ ok: false, reason: 'multiple-boards', componentIds: ['one', 'two'] });
  });

  it('keeps a generic board but marks it incompatible, whatever else is on the canvas', () => {
    const context = resolve(withComponents('ybc-basic', { id: 'g', deviceType: 'board' }, { id: 'y', deviceType: 'ybc-board' }));
    expect(context.boards.map((board) => board.id)).toEqual(['y']);
    expect(context.incompatible.map((c) => c.id)).toEqual(['g']);
    expect(context.readiness).toEqual({ ok: false, reason: 'incompatible-devices', componentIds: ['g'] });
  });

  it('offers a generic LED or button only if the profile lists it (not at YB-1)', () => {
    const context = resolve(withComponents('ybc-basic', { id: 'y', deviceType: 'ybc-board' }, { id: 'l', deviceType: 'led' }));
    expect(context.incompatible.map((c) => c.id)).toEqual(['l']);
    expect(context.readiness.ok).toBe(false);
  });
});

describe('board deletion and replacement (R-F7, R-F8)', () => {
  const ready = fixtureDocument('ybc-advanced');

  it('keeps the family, the profile and the toolbox when the board is deleted; readiness becomes no-board', () => {
    const circuit = deleteComponent(ready.circuit, 'ybc-board-1');
    const context = resolve({ ...ready, circuit });
    expect(context).toMatchObject({ family: 'ybc', blockPacks: ybcPacks });
    expect(context.profile?.id).toBe('ybc-advanced');
    expect(context.readiness).toEqual({ ok: false, reason: 'no-board', componentIds: [] });
  });

  it('is ready again when a ybc board is added back', () => {
    const without = deleteComponent(ready.circuit, 'ybc-board-1');
    const replaced = { components: [...without.components, place('ybc-board-2', 'ybc-board')], wires: without.wires };
    expect(resolve({ ...ready, circuit: replaced }).readiness).toMatchObject({ ok: true, board: { id: 'ybc-board-2' } });
  });

  it('does not turn a generic project into a ybc one by deleting its board or adding a ybc board', () => {
    const blink = createTemplateProject('blink');
    const withoutBoard = { ...blink, circuit: deleteComponent(blink.circuit, 'board') };
    expect(resolve(withoutBoard).family).toBe('generic');
    expect(resolve({ ...withoutBoard, circuit: { ...withoutBoard.circuit, components: [place('y', 'ybc-board')] } }).family).toBe('generic');
  });
});

describe('profile mechanics, with the test-only fixtures (plan §8.7)', () => {
  const { registry: fixtureRegistry, profiles } = createFixtureEnvironment();
  const resolveFixture = (document: Parameters<typeof resolveBoardContext>[0]) =>
    resolveBoardContext(document, fixtureRegistry, profiles);

  it('gives test-base the base palette and packs, and test-extended the union', () => {
    const base = resolveFixture(fixtureDocument('test-base'));
    const extended = resolveFixture(fixtureDocument('test-extended'));
    expect(base.allowedDeviceTypes).toEqual(['ybc-board']);
    expect(base.blockPacks).toEqual(['ybc.structure']);
    expect(extended.allowedDeviceTypes).toEqual(['ybc-board', testDeviceType]);
    expect(extended.blockPacks).toEqual(['ybc.structure', 'test.extended']);
  });

  it('keeps a registered ybc device out of the generic palette (GB9) and out of the ybc-basic palette', () => {
    const generic = resolveFixture(createNewProject('p'));
    expect(generic.allowedDeviceTypes).toEqual(['board', 'led', 'resistor', 'push-button']);
    expect(resolveFixture(fixtureDocument('ybc-basic')).allowedDeviceTypes).toEqual(['ybc-board']);
  });

  it('marks a device of test-extended incompatible in test-base, keeps it, and is fine in test-extended', () => {
    const components = [fixtureComponents.board, fixtureComponents.testDevice];
    const lowered = resolveFixture(fixtureDocument('test-base', { components }));
    expect(lowered.incompatible.map((c) => c.id)).toEqual(['test-device-1']);
    expect(lowered.readiness).toEqual({ ok: false, reason: 'incompatible-devices', componentIds: ['test-device-1'] });
    expect(resolveFixture(fixtureDocument('test-extended', { components })).readiness.ok).toBe(true);
  });

  it('leaves the document untouched: resolving never edits it', () => {
    const document = fixtureDocument('test-base', { components: [fixtureComponents.board, fixtureComponents.testDevice], blocks: createDefaultProgram() });
    const before = structuredClone(document);
    resolveFixture(document);
    expect(document).toEqual(before);
  });
});
