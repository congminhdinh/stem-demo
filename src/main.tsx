import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { projectDocumentSchema } from './core/circuit/document';
import { localDeviceDefinitions } from './core/devices/local-catalog';
import { createDeviceRegistry } from './core/devices/registry';
import { openLastProject } from './core/persistence/project-repository';
import { createRunSession } from './core/run/run-session';
import blinkSample from './samples/blink.project.json';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { installTestHooks } from './ui/app/test-hooks';
import { canOpenProgram } from './ui/blockly/editor-blocks';
import { startAutosave } from './ui/state/autosave';
import { createProjectStore } from './ui/state/project-store';
import { createRunStore } from './ui/state/run-store';

// Composition root: the only place that picks the local catalog, the sample
// and the storage implementation (B8).
const registry = createDeviceRegistry(localDeviceDefinitions);
// The PoC has a single board type; its pins are the board profile for blocks.
const boardPins = registry.get('board').board?.pins.map((pin) => pin.name) ?? [];
const repository = createDexieProjectRepository();

// The last project is read before anything renders, so nothing can be shown,
// edited or saved over it in the meantime.
const opened = await openLastProject(repository, registry, {
  sample: () => projectDocumentSchema.parse(blinkSample),
  newId: () => crypto.randomUUID(),
  // Blockly, with the editor's own blocks, tells whether the editor can open a stored program.
  canOpenProgram: (blocks) => canOpenProgram(blocks, boardPins),
});
const projectStore = createProjectStore(opened.document);
const runStore = createRunStore(createRunSession(registry));
if (opened.canSave) {
  startAutosave(projectStore, repository, (error) => console.warn('The project could not be saved.', error));
}

if (import.meta.env.DEV) {
  installTestHooks(projectStore);
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <App
      projectStore={projectStore}
      runStore={runStore}
      registry={registry}
      boardPins={boardPins}
      notice={opened.notice}
    />
  </StrictMode>,
);
