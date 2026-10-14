import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { addComponent } from '../src/core/circuit/components';
import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../src/core/circuit/document';
import { deleteWire } from '../src/core/circuit/wires';
import { localDeviceDefinitions } from '../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../src/core/devices/registry';
import { createDefaultProgram } from '../src/core/program/blocks';
import blinkSample from '../src/samples/blink.project.json';
import buttonLedSample from '../src/samples/button-led.project.json';
import { createDexieProjectRepository } from '../src/storage/dexie-project-repository';
import { parseLaunch } from '../src/ui/app/launch';
import { openAtStartup } from '../src/ui/app/startup';
import { autosaveDelayMs, startAutosave } from '../src/ui/state/autosave';
import { createProjectStore } from '../src/ui/state/project-store';

// S1 persistence isolation: an embedded lab neither restores nor overwrites
// the standalone last project. Each page load below is composed the way
// src/main.tsx composes it, on the real Dexie adapter (fake-indexeddb on
// Node) and the real autosave; one database stands for the browser's storage.

const registry = createDeviceRegistry(localDeviceDefinitions);
const blink = projectDocumentSchema.parse(blinkSample);
const buttonLed = projectDocumentSchema.parse(buttonLedSample);

let databaseCount = 0;
const freshDatabase = () => `stem-studio-launch-${++databaseCount}`;

/** One page load of the app at `search` (a URL query), as src/main.tsx does it. */
async function pageLoad(databaseName: string, search: string) {
  const started = await openAtStartup(parseLaunch(search), {
    openRepository: () => createDexieProjectRepository(databaseName),
    registry,
    newId: () => crypto.randomUUID(),
    canOpenProgram: () => true,
  });
  if (started.kind !== 'editor') {
    throw new Error(`The app did not open a project: ${started.problem}`);
  }
  const projectStore = createProjectStore(started.document);
  const saveErrors: unknown[] = [];
  const close = started.saveTo ? startAutosave(projectStore, started.saveTo, (error) => saveErrors.push(error)) : () => {};
  return { projectStore, saveErrors, close, document: () => projectStore.getState().document };
}

/** Every project record, read past the app, oldest first. */
async function storedRecords(databaseName: string) {
  const db = new Dexie(databaseName);
  db.version(1).stores({ projects: 'id, updatedAt' });
  try {
    return await db.table('projects').orderBy('updatedAt').toArray();
  } finally {
    db.close();
  }
}

const expectLastStored = (databaseName: string, document: ProjectDocument) =>
  vi.waitFor(async () => expect((await storedRecords(databaseName)).at(-1)?.document).toEqual(document));

/** A lab that saved would have written by then (autosave is debounced by autosaveDelayMs). */
const pastAutosave = () => new Promise((resolve) => setTimeout(resolve, autosaveDelayMs * 3));

describe('launch isolation (S1)', () => {
  it('an embedded Button LED lab, edited, leaves the standalone last project as it was', async () => {
    const storage = freshDatabase();
    // 1. Standalone: the user's own project A becomes the last project.
    const standalone = await pageLoad(storage, '');
    const projectA: ProjectDocument = {
      ...createNewProject('project-a'),
      circuit: addComponent({ components: [], wires: [] }, 'led', { x: 300, y: 200 }).circuit,
    };
    standalone.projectStore.getState().loadProject(projectA);
    await expectLastStored(storage, projectA);
    standalone.close();
    const before = await storedRecords(storage);

    // 2. The lab opens Button LED, not A, and its edits are not saved.
    const lab = await pageLoad(storage, '?embed=1&template=button-led');
    expect(lab.document()).toEqual(buttonLed);
    lab.projectStore.getState().setCircuit(deleteWire(buttonLed.circuit, buttonLed.circuit.wires[0]!.id));
    lab.projectStore.getState().setProgramBlocks(createDefaultProgram());
    expect(lab.document()).not.toEqual(buttonLed);
    await pastAutosave();
    lab.close();
    expect(await storedRecords(storage)).toEqual(before);

    // 3. Reloading the lab starts again from the template.
    const reloadedLab = await pageLoad(storage, '?embed=1&template=button-led');
    expect(reloadedLab.document()).toEqual(buttonLed);
    reloadedLab.close();

    // 4. Standalone again: still A.
    const back = await pageLoad(storage, '');
    expect(back.document()).toEqual(projectA);
    back.close();
    expect([...standalone.saveErrors, ...back.saveErrors]).toEqual([]);
  });

  it('an embedded Blink lab ignores a standalone Blink edited under the same id, and does not overwrite it', async () => {
    const storage = freshDatabase();
    // 1. Standalone opens the Blink sample (nothing saved yet) and edits it:
    //    the record keeps the sample's id, "sample-blink".
    const standalone = await pageLoad(storage, '');
    expect(standalone.document()).toEqual(blink);
    standalone.projectStore.getState().setCircuit(deleteWire(blink.circuit, 'wire-cathode-gnd'));
    const editedBlink = standalone.document();
    await expectLastStored(storage, editedBlink);
    standalone.close();
    const before = await storedRecords(storage);
    expect(before.map((record) => record.id)).toEqual([blink.id]);

    // 2. The lab shows the bundled Blink, not the edited one, and saves nothing.
    const lab = await pageLoad(storage, '?embed=1&template=blink');
    expect(lab.document()).toEqual(blink);
    lab.projectStore.getState().setCircuit({ components: [], wires: [] });
    await pastAutosave();
    lab.close();
    expect(await storedRecords(storage)).toEqual(before);

    // 3. Standalone again: the edited Blink.
    const back = await pageLoad(storage, '');
    expect(back.document()).toEqual(editedBlink);
    back.close();
  });

  it('an embedded lab in a fresh browser creates no storage at all', async () => {
    const storage = freshDatabase();

    const lab = await pageLoad(storage, '?embed=1&template=blink');
    lab.projectStore.getState().setCircuit({ components: [], wires: [] });
    await pastAutosave();
    lab.close();

    expect((await indexedDB.databases()).map((database) => database.name)).not.toContain(storage);
  });
});
