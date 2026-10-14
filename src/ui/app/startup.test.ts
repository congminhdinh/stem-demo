import { describe, expect, it } from 'vitest';
import { addComponent } from '../../core/circuit/components';
import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import type { ProjectRepository } from '../../core/persistence/project-repository';
import blinkSample from '../../samples/blink.project.json';
import buttonLedSample from '../../samples/button-led.project.json';
import { createTemplateProject, templateKeys } from '../../samples/templates';
import { parseLaunch } from './launch';
import { openAtStartup } from './startup';

const registry = createDeviceRegistry(localDeviceDefinitions);
const blink = projectDocumentSchema.parse(blinkSample);
const buttonLed = projectDocumentSchema.parse(buttonLedSample);
/** The standalone user's own project: neither Blink nor Button LED. */
const ownProject: ProjectDocument = {
  ...createNewProject('own-project'),
  circuit: addComponent({ components: [], wires: [] }, 'led', { x: 100, y: 100 }).circuit,
};
/** Blink as edited in the standalone editor: stored under the sample's own id. */
const editedBlink: ProjectDocument = { ...blink, circuit: { ...blink.circuit, wires: [] } };

/** Storage holding `lastProject`, recording every use; created only through `openRepository`. */
function storage(lastProject: unknown) {
  const uses: string[] = [];
  const repository: ProjectRepository = {
    save: async () => void uses.push('save'),
    loadLast: async () => (uses.push('loadLast'), lastProject === null ? null : { document: lastProject }),
  };
  const options = {
    openRepository: () => (uses.push('open'), repository),
    registry,
    newId: () => 'new-project',
    canOpenProgram: () => true,
  };
  return { repository, uses, options };
}

describe('openAtStartup (S1)', () => {
  describe('standalone editor', () => {
    it('restores the last project, and saves to the same storage', async () => {
      const { repository, uses, options } = storage(ownProject);

      expect(await openAtStartup(parseLaunch(''), options)).toEqual({
        kind: 'editor',
        document: ownProject,
        notice: null,
        saveTo: repository,
      });
      expect(uses).toEqual(['open', 'loadLast']);
    });

    it('opens the Blink sample when nothing was saved', async () => {
      const { repository, options } = storage(null);

      expect(await openAtStartup(parseLaunch(''), options)).toEqual({
        kind: 'editor',
        document: blink,
        notice: null,
        saveTo: repository,
      });
    });

    it('keeps saving off when the browser storage fails, as before S1', async () => {
      const failing: ProjectRepository = {
        save: async () => {},
        loadLast: () => Promise.reject(new Error('IndexedDB is not available')),
      };
      const { options } = storage(null);

      expect(await openAtStartup(parseLaunch(''), { ...options, openRepository: () => failing })).toEqual({
        kind: 'editor',
        document: blink,
        notice: { message: 'Projects cannot be saved in this browser.', about: 'session' },
        saveTo: null,
      });
    });
  });

  describe('embedded lab', () => {
    it.each([
      ['the user’s own project', ownProject],
      ['an edited Blink under the sample’s id', editedBlink],
      ['nothing', null],
    ])('?embed=1&template=blink opens Blink, whatever the last project is (%s)', async (_, lastProject) => {
      const { uses, options } = storage(lastProject);

      expect(await openAtStartup(parseLaunch('?embed=1&template=blink'), options)).toEqual({
        kind: 'editor',
        document: blink,
        notice: null,
        saveTo: null,
      });
      // The standalone storage is not even created: nothing to read, nothing to overwrite.
      expect(uses).toEqual([]);
    });

    it('?embed=1&template=button-led opens Button LED, whatever the last project is', async () => {
      const { uses, options } = storage(ownProject);

      expect(await openAtStartup(parseLaunch('?embed=1&template=button-led'), options)).toEqual({
        kind: 'editor',
        document: buttonLed,
        notice: null,
        saveTo: null,
      });
      expect(uses).toEqual([]);
    });

    it('?embed=1&template=empty opens an empty project', async () => {
      const { uses, options } = storage(ownProject);

      expect(await openAtStartup(parseLaunch('?embed=1&template=empty'), options)).toEqual({
        kind: 'editor',
        document: createNewProject('template-empty'),
        notice: null,
        saveTo: null,
      });
      expect(uses).toEqual([]);
    });

    it.each(templateKeys)('opens the template %s, and never its storage', async (key) => {
      const { uses, options } = storage(ownProject);

      expect(await openAtStartup(parseLaunch(`?embed=1&template=${key}`), options)).toMatchObject({
        document: createTemplateProject(key),
        saveTo: null,
      });
      expect(uses).toEqual([]);
    });
  });

  describe('broken launch', () => {
    it.each([
      ['?embed=1&template=blinky', 'Unknown template "blinky".'],
      ['?embed=1', 'No template was given: add template=<key>.'],
      ['?template=button-led', 'A template opens only in an embedded lab: add embed=1.'],
    ])('%s opens no project at all: an error, never the last project', async (search, problem) => {
      const { uses, options } = storage(ownProject);

      expect(await openAtStartup(parseLaunch(search), options)).toEqual({ kind: 'launch-error', problem });
      expect(uses).toEqual([]);
    });
  });
});
