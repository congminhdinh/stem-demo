import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import buttonLedSample from '../../samples/button-led.project.json';
import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../circuit/document';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { createKitCatalog, unoR3Board } from '../hardware';
import { productionProfiles } from '../profiles';
import { unoDocument } from '../profiles/__fixtures__/uno-document';
import { inspectStoredProject, openLastProject, readStoredProject, type ProjectRepository } from './project-repository';

const registry = createDeviceRegistry(localDeviceDefinitions);
const blink = projectDocumentSchema.parse(blinkSample);
const buttonLed = projectDocumentSchema.parse(buttonLedSample);
/** Stands in for the editor's check (Blockly, in src/ui/blockly); core only passes the blocks to it. */
const anyProgram = () => true;

type Editable = Record<string, unknown> & typeof blink;
/** A deep copy of blink with `change` applied, as stored data might be. */
const storedBlink = (change: (document: Editable) => void): unknown => {
  const document = structuredClone(blink);
  change(document as Editable);
  return document;
};
const firstComponent = (document: Editable) => document.circuit.components[0]!;
const firstWire = (document: Editable) => document.circuit.wires[0]!;

describe('readStoredProject', () => {
  it.each<[string, ProjectDocument]>([
    ['blink', blink],
    ['button-led (if/else, push button)', buttonLed],
    ['a new project', createNewProject('project-1')],
  ])('opens a stored %s as it was saved', (_, document) => {
    expect(readStoredProject(structuredClone(document), registry, anyProgram)).toEqual(document);
  });

  it('refuses a program the editor cannot open, asking the editor’s check about its blocks', () => {
    const asked: unknown[] = [];
    const editorCannotOpen = (blocks: unknown) => {
      asked.push(blocks);
      return false;
    };

    expect(readStoredProject(structuredClone(buttonLed), registry, editorCannotOpen)).toBeNull();
    expect(asked).toEqual([buttonLed.program.blocks]);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['a string', 'blink'],
    ['another schema version', storedBlink((document) => Object.assign(document, { schemaVersion: 2 }))],
    ['a document without a circuit', storedBlink((document) => Reflect.deleteProperty(document, 'circuit'))],
    ['a position that is not a number', storedBlink((document) => (firstComponent(document).position.x = NaN))],
    ['an unknown device type', storedBlink((document) => (firstComponent(document).deviceType = 'motor'))],
    [
      'two components with one id (I1)',
      storedBlink((document) => (document.circuit.components[1]!.id = firstComponent(document).id)),
    ],
    ['a wire to a missing port (I2)', storedBlink((document) => (firstWire(document).to.portId = 'q'))],
    ['a wire to a missing component (I2)', storedBlink((document) => (firstWire(document).to.componentId = 'x'))],
    ['the same wire twice (I3)', storedBlink((document) => document.circuit.wires.push({ ...firstWire(document), id: 'b' }))],
  ])('refuses %s: the editor could not open it', (_, stored) => {
    expect(readStoredProject(stored, registry, anyProgram)).toBeNull();
  });
});

describe('openLastProject', () => {
  const repository = (loadLast: ProjectRepository['loadLast']): ProjectRepository => ({
    save: async () => {},
    loadLast,
  });
  const options = { sample: () => blink, newId: () => 'new-project', canOpenProgram: anyProgram };

  it('opens the last saved project', async () => {
    const opened = await openLastProject(repository(async () => ({ document: buttonLed })), registry, options);

    expect(opened).toEqual({ document: buttonLed, notice: null, canSave: true });
  });

  it('opens the sample when nothing was saved', async () => {
    expect(await openLastProject(repository(async () => null), registry, options)).toEqual({
      document: blink,
      notice: null,
      canSave: true,
    });
  });

  it('opens a new project with a notice when the saved one is corrupt or from another version', async () => {
    const opened = await openLastProject(
      repository(async () => ({ document: { ...blink, schemaVersion: 2 } })),
      registry,
      options,
    );

    expect(opened).toEqual({
      document: createNewProject('new-project'),
      notice: {
        message: 'The saved project could not be opened, so a new project was started.',
        about: 'opened-project',
      },
      canSave: true,
    });
  });

  it('opens the sample, saving nothing, when the browser storage fails', async () => {
    const failing = repository(async () => {
      throw new Error('IndexedDB is not available');
    });

    expect(await openLastProject(failing, registry, options)).toEqual({
      document: blink,
      // About the session, not the project: New does not make saving work again.
      notice: { message: 'Projects cannot be saved in this browser.', about: 'session' },
      canSave: false,
    });
  });
});

describe('the kit of a robot project at L-1 (N18 R2.2)', () => {
  const robot = (kit?: { id: string; version: string }) => unoDocument('uno-basic', kit ? { kit } : {});

  it('refuses a kit the kit catalog does not know with unknown-kit, never a throw', () => {
    for (const kit of [{ id: 'acme-rover', version: '2' }, { id: 'ref-uno-rover', version: '1' }, { id: 'constructor', version: '0' }]) {
      expect(inspectStoredProject(robot(kit), registry, anyProgram)).toEqual({
        ok: false,
        problem: { code: 'unknown-kit', message: `The robot kit "${kit.id}@${kit.version}" is not one this app knows.` },
      });
    }
  });

  it('opens a project with a known kit, and one without a kit (it means ref-uno-rover@0)', () => {
    expect(inspectStoredProject(robot({ id: 'ref-uno-rover', version: '0' }), registry, anyProgram)).toEqual({ ok: true, document: robot({ id: 'ref-uno-rover', version: '0' }) });
    expect(inspectStoredProject(robot(), registry, anyProgram)).toEqual({ ok: true, document: robot() });
  });

  it('asks the catalog it is given', () => {
    const kits = createKitCatalog([], [unoR3Board]);
    expect(inspectStoredProject(robot({ id: 'ref-uno-rover', version: '0' }), registry, anyProgram, productionProfiles, kits)).toMatchObject({ ok: false, problem: { code: 'unknown-kit' } });
  });

  it('falls back like an unknown profile: a new project with the notice', async () => {
    const opened = await openLastProject({ save: async () => {}, loadLast: async () => ({ document: robot({ id: 'acme-rover', version: '2' }) }) }, registry, {
      sample: () => blink,
      newId: () => 'new-project',
      canOpenProgram: anyProgram,
    });
    expect(opened).toEqual({
      document: createNewProject('new-project'),
      notice: { message: 'The saved project could not be opened, so a new project was started.', about: 'opened-project' },
      canSave: true,
    });
  });
});
