import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { openLastProject } from '../core/persistence/project-repository';
import { unoDocument } from '../core/profiles/__fixtures__/uno-document';
import { createTemplateProject } from '../samples/templates';
import { createDexieProjectRepository } from './dexie-project-repository';

// N18 R2.1 (plan §4.0): the kit of a robot project survives the editor's own storage too (IndexedDB, fake-indexeddb here).

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('a robot project survives a save and a reload', () => {
  it.each([
    ['with its kit', unoDocument('uno-advanced', { kit: { id: 'acme-rover', version: '2' } })],
    ['without one', unoDocument('uno-basic')],
  ])('%s, deep-equal', async (name, document) => {
    const database = `stem-studio-kit-${name}`;
    await createDexieProjectRepository(database).save(document);
    const opened = await openLastProject(createDexieProjectRepository(database), registry, {
      sample: () => createTemplateProject('blink'),
      newId: () => 'new',
      canOpenProgram: () => true,
    });

    expect(opened).toEqual({ document, notice: null, canSave: true });
  });
});
