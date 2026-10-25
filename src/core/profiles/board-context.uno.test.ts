import { describe, expect, it } from 'vitest';
import { createNewProject } from '../circuit/document';
import { generateForDocument } from '../codegen/yolobit/generate-document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { boardPinChoices, createBlockPackCatalog, ybcPinChoices } from '../program/block-packs';
import { createTemplateProject } from '../../samples/templates';
import { unoBoardComponent, unoDocument } from './__fixtures__/uno-document';
import { resolveBoardContext } from './board-context';
import { productionProfiles } from './index';

// N18 R2.1: the board family is the profile's (`profile.family`), so a uno profile makes a uno project, whatever is on the canvas.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const resolve = (document: Parameters<typeof resolveBoardContext>[0]) => resolveBoardContext(document, registry, productionProfiles);
const ybcBoard = { id: 'y', deviceType: 'ybc-board', position: { x: 0, y: 0 } };

describe('resolveBoardContext for the uno family (N18 R2.1)', () => {
  it.each(['uno-basic', 'uno-advanced'] as const)('is uno for the profile %s, with only the UNO board allowed and the profile’s packs (N18 R2.2)', (profile) => {
    const context = resolve(unoDocument(profile));
    expect(context).toMatchObject({ family: 'uno', profile: { id: profile }, allowedDeviceTypes: ['uno-r3'], blockPacks: productionProfiles.get(profile)?.blockPacks, incompatible: [] });
    expect(context.blockPacks.every((id) => packs.get(id)?.family === 'uno')).toBe(true);
    expect(context.boards).toEqual([unoBoardComponent]);
    expect(context.readiness).toEqual({ ok: true, board: unoBoardComponent, capabilities: ['digital', 'pwm', 'analogIn'] });
  });

  it('keeps the family of the profile whatever the boards: a Yolo:Bit board in a uno project is incompatible', () => {
    const context = resolve(unoDocument('uno-basic', { circuit: { components: [unoBoardComponent, ybcBoard], wires: [] } }));
    expect(context.family).toBe('uno');
    expect(context.readiness).toEqual({ ok: false, reason: 'incompatible-devices', componentIds: ['y'] });
  });

  it('never offers the UNO board to a generic or a Yolo:Bit project, and marks it incompatible there', () => {
    const generic = resolve({ ...createNewProject('g'), circuit: { components: [unoBoardComponent], wires: [] } });
    expect(generic.family).toBe('generic');
    expect(generic.allowedDeviceTypes).not.toContain('uno-r3');
    expect(generic.incompatible).toEqual([unoBoardComponent]);
    const ybc = resolve({ ...createTemplateProject('ybc-empty'), circuit: { components: [unoBoardComponent], wires: [] } });
    expect(ybc.family).toBe('ybc');
    expect(ybc.allowedDeviceTypes).not.toContain('uno-r3');
    expect(ybc.incompatible).toEqual([unoBoardComponent]);
  });

  it('has no Python for a uno document: its code is C++ for Arduino AVR (C1)', () => {
    expect(generateForDocument(unoDocument(), registry, productionProfiles, packs)).toBeNull();
  });
});

describe('boardPinChoices (N18 R2.1)', () => {
  it('offers the pins of the family’s boards only: the UNO header for uno, P0–P2 for ybc, as before', () => {
    const digital = [...Array.from({ length: 14 }, (_, index) => `D${String(index)}`), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
    expect(boardPinChoices(registry, 'uno')).toEqual({
      digital,
      analogIn: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
      pwm: ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'],
      servo: [],
    });
    expect(boardPinChoices(registry, 'ybc')).toEqual(ybcPinChoices(registry));
    expect(ybcPinChoices(registry).digital).toEqual(['P0', 'P1', 'P2']);
  });
});
