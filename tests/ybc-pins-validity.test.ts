import { describe, expect, it } from 'vitest';
import type { ProjectDocument } from '../src/core/circuit/document';
import { generateForDocument } from '../src/core/codegen/yolobit/generate-document';
import ybcBoardJson from '../src/core/devices/definitions/ybc-board.json';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { inspectStoredProject } from '../src/core/persistence/project-repository';
import { productionProfiles } from '../src/core/profiles';
import { resolveBoardContext } from '../src/core/profiles/board-context';
import { createFixtureEnvironment, fixtureDocument } from '../src/core/profiles/__fixtures__/test-profiles';
import { reportLayers } from '../src/core/profiles/validity';
import { buildToolbox, createBlockPackCatalog } from '../src/core/program/block-packs';
import { num, print, program, wait } from '../src/core/program/__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite } from '../src/core/program/__fixtures__/ybc-pin-blocks';
import { createRunSession } from '../src/core/run/run-session';
import { createPinCapabilities } from '../src/core/run/ybc-pin-io';
import { canOpenProgram } from '../src/ui/blockly/editor-blocks';

// The validity layers for programs with pins (YB plan §8.6, YB-4): a document with pin blocks is loadable
// whatever family it is in (L-1, real Blockly), profile-compatible only where a profile lists the pins pack and the
// devices (L-2), runtime-ready with one board and a program that compiles for it (L-3), and generator-ready when
// the generator says ok (L-4). The same diagnostics come from Run and from the Python panel (R-F5), and a hardware
// program is simulator-ready AND generator-ready at once: YB-4 gives the pins all four layers.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const open = (blocks: unknown) => canOpenProgram(blocks, packs);
const at = { x: 0, y: 0 };
const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: at };
const knob = { id: 'potentiometer-1', deviceType: 'potentiometer', position: at };
const pinProgram = () => program([pinWrite('P0', true), print(pinAnalog('P1'))], [wait(num(10))]);

const ybcDocument = (profile: string, blocks: unknown = pinProgram(), components: ProjectDocument['circuit']['components'] = [board, knob]) =>
  fixtureDocument(profile, { blocks, components });
const genericDocument = (blocks: unknown = pinProgram(), components: ProjectDocument['circuit']['components'] = [{ id: 'g', deviceType: 'board', position: at }]) =>
  fixtureDocument(undefined, { blocks, components });

describe('L-1 loadable: pins and the potentiometer open wherever they are stored', () => {
  it.each([
    ['ybc-basic', ybcDocument('ybc-basic')],
    ['ybc-advanced', ybcDocument('ybc-advanced')],
    ['a generic project that holds pin blocks and a potentiometer (data only)', genericDocument(pinProgram(), [{ id: 'g', deviceType: 'board', position: at }, knob])],
  ])('%s', (_, document) => {
    expect(inspectStoredProject(structuredClone(document), registry, open, productionProfiles)).toEqual({ ok: true, document });
  });

  it('refuses a program Blockly cannot open, not a pin block as such', () => {
    const broken = { blocks: { languageVersion: 0, blocks: [{ type: 'ybc_pin_write', id: 'w', inputs: { NOPE: { block: { type: 'ybc_pin_read', id: 'r' } } } }] } };
    expect(inspectStoredProject(ybcDocument('ybc-basic', broken), registry, open, productionProfiles)).toMatchObject({ ok: false });
  });
});

describe('L-2 profile-compatible: where the pins and the knob belong', () => {
  const layers = (document: ProjectDocument) => reportLayers(document, resolveBoardContext(document, registry, productionProfiles), packs);

  it('holds for both Yolo:Bit-compatible profiles, with the potentiometer in the circuit', () => {
    for (const profile of ['ybc-basic', 'ybc-advanced']) {
      expect(layers(ybcDocument(profile)).profileCompatible, profile).toEqual([]);
    }
  });

  it('does not hold for a generic project: every pin block is not-in-profile with its id, the potentiometer is an incompatible device', () => {
    const write = pinWrite('P0', true);
    const read = pinRead('P1');
    const analog = pinAnalog('P2');
    const document = genericDocument(program([write, print(read), print(analog)]), [{ id: 'g', deviceType: 'board', position: at }, knob]);
    const report = layers(document).profileCompatible;
    // Every block a pack owns that a generic project does not show is named (the print blocks around the pins too).
    const refused = report.filter((d) => d.code === 'not-in-profile').map((d) => d.blockId);
    expect(refused).toEqual(expect.arrayContaining([write.id, read.id, analog.id]));
    expect(report.filter((d) => d.code === 'incompatible-devices')).toEqual([expect.objectContaining({ componentIds: ['potentiometer-1'] })]);
    // And the document is the document it was: nothing was removed or rewritten to say so.
    expect(document.circuit.components).toHaveLength(2);
  });

  it('does not hold for a profile that does not list the pins pack: the blocks stay, the toolbox hides them (profile lowering)', () => {
    const fixture = createFixtureEnvironment();
    const write = pinWrite('P0', true);
    const analog = pinAnalog('P1');
    const lowered = fixtureDocument('test-base', { blocks: program([write, print(analog)]), components: [board] });
    const context = resolveBoardContext(lowered, fixture.registry, fixture.profiles);
    const report = reportLayers(lowered, context, fixture.packs);
    expect(report.profileCompatible.every((d) => d.code === 'not-in-profile')).toBe(true);
    expect(report.profileCompatible.map((d) => d.blockId)).toEqual(expect.arrayContaining([write.id, analog.id]));
    expect(JSON.stringify(buildToolbox(context.blockPacks, fixture.packs))).not.toContain('ybc_pin');
    expect(inspectStoredProject(structuredClone(lowered), fixture.registry, open, fixture.profiles)).toEqual({ ok: true, document: lowered });
  });

  it('shows Advanced exactly what Basic shows of the pins: same pack, same constructs, the same toolbox category', () => {
    const [basic, advanced] = ['ybc-basic', 'ybc-advanced'].map((id) => productionProfiles.get(id));
    // N17 B2: Advanced has the sensors pack on top; the pins are the same.
    expect(advanced?.blockPacks).toEqual([...(basic?.blockPacks ?? []), 'ybc.sensors']);
    expect(advanced?.constructs.filter((id) => ['C-23', 'C-24', 'C-25'].includes(id))).toEqual(basic?.constructs.filter((id) => ['C-23', 'C-24', 'C-25'].includes(id)));
    const category = (id: string) => buildToolbox(productionProfiles.get(id)?.blockPacks ?? [], packs).contents.find((c) => c.name === 'Pins');
    expect(category('ybc-advanced')).toEqual(category('ybc-basic'));
  });
});

describe('L-3 runtime-ready and L-4 generator-ready: Run and the Python panel agree', () => {
  const generate = (document: ProjectDocument) => generateForDocument(document, registry, productionProfiles, packs);
  const run = (document: ProjectDocument) => createRunSession(registry, { capabilities: createPinCapabilities(registry) }).start(document);

  it('a pin program is runnable and generator-ready at once, in both profiles', () => {
    for (const profile of ['ybc-basic', 'ybc-advanced']) {
      const document = ybcDocument(profile);
      const session = createRunSession(registry, { capabilities: createPinCapabilities(registry) });
      expect(session.start(document), profile).toEqual({ ok: true });
      session.stop();
      const generated = generate(document);
      expect(generated, profile).toMatchObject({ ok: true });
      expect(generated?.ok && generated.source).toContain('from yolobit import *');
      expect(generated?.ok && generated.source).toContain('pin0.write_digital(1)');
      expect(generated?.ok && generated.source).toContain('int(pin1.read_analog())');
    }
  });

  it('is not generator business whether a pin can be read when the program runs: an open pin generates and then stops the run', () => {
    const document = ybcDocument('ybc-basic', program([print(pinRead('P2'))]), [board]);
    expect(generate(document)).toMatchObject({ ok: true });
    expect(run(document)).toEqual({ ok: true });
  });

  it('says the same thing when there is no board (L-3, no-board) and when a device is of the wrong family (L-2)', () => {
    const noBoard = ybcDocument('ybc-basic', pinProgram(), []);
    expect(run(noBoard)).toMatchObject({ ok: false, reason: 'no-board' });
    expect(generate(noBoard)).toMatchObject({ ok: false, layer: 'L-3', diagnostics: [expect.objectContaining({ code: 'no-board' })] });
    const wrongFamily = ybcDocument('ybc-basic', pinProgram(), [board, { id: 'g', deviceType: 'board', position: at }]);
    expect(run(wrongFamily)).toMatchObject({ ok: false, reason: 'incompatible-devices' });
    expect(generate(wrongFamily)).toMatchObject({ ok: false, layer: 'L-2', diagnostics: [expect.objectContaining({ code: 'incompatible-devices' })] });
  });

  it('says the same compile errors for a board without the capability, and for a reserved pin', () => {
    const custom = (change: (board: typeof ybcBoardJson) => unknown) => {
      const registryWith = createDeviceRegistry([
        ...localDeviceDefinitions.filter((definition) => (definition as { id: string }).id !== 'ybc-board'),
        change(structuredClone(ybcBoardJson)),
      ]);
      return { registry: registryWith, packs: createBlockPackCatalog(registryWith) };
    };
    const noAnalog = custom((b) => ({ ...b, board: { ...b.board, pins: b.board.pins.map((pin) => ({ ...pin, capabilities: ['digital'] })) } }));
    const reservedP2 = custom((b) => ({ ...b, board: { ...b.board, reservedPins: ['P2'] } }));
    const cases: [typeof noAnalog, unknown, string][] = [
      [noAnalog, program([print(pinAnalog('P0'))]), 'capability-unavailable'],
      [reservedP2, program([pinWrite('P2', true)]), 'value-out-of-range'],
    ];
    for (const [environment, blocks, code] of cases) {
      const document = ybcDocument('ybc-basic', blocks, [board]);
      const started = createRunSession(environment.registry, { packs: environment.packs, capabilities: createPinCapabilities(environment.registry) }).start(document);
      const generated = generateForDocument(document, environment.registry, productionProfiles, environment.packs);
      expect(started).toMatchObject({ ok: false, reason: 'compile-error', diagnostics: [expect.objectContaining({ code })] });
      expect(generated).toMatchObject({ ok: false, layer: 'L-3', diagnostics: [expect.objectContaining({ code })] });
    }
  });

  it('has no Python for a generic project, whatever its blocks hold (a generic project has no panel)', () => {
    expect(generate(genericDocument())).toBeNull();
  });
});
