import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { localDeviceDefinitions } from './core/devices/local-catalog';
import { createDeviceRegistry } from './core/devices/registry';
import { createRunSession } from './core/run/run-session';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { LaunchError } from './ui/app/LaunchError';
import { parseLaunch } from './ui/app/launch';
import { openAtStartup } from './ui/app/startup';
import { installTestHooks } from './ui/app/test-hooks';
import { canOpenProgram } from './ui/blockly/editor-blocks';
import { startAutosave } from './ui/state/autosave';
import { createProjectStore } from './ui/state/project-store';
import { createRunStore } from './ui/state/run-store';

// Composition root: the only place that reads the launch URL and picks the
// local catalog and the storage implementation (B8).
const registry = createDeviceRegistry(localDeviceDefinitions);
// The PoC has a single board type; its pins are the board profile for blocks.
const boardPins = registry.get('board').board?.pins.map((pin) => pin.name) ?? [];

// The project is chosen before anything renders: in the standalone editor the
// last project is read first, so nothing can be shown, edited or saved over
// it in the meantime; an embedded lab opens its template and never touches
// storage (S1).
const started = await openAtStartup(parseLaunch(window.location.search), {
  openRepository: () => createDexieProjectRepository(),
  registry,
  newId: () => crypto.randomUUID(),
  // Blockly, with the editor's own blocks, tells whether the editor can open a stored program.
  canOpenProgram: (blocks) => canOpenProgram(blocks, boardPins),
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

if (started.kind === 'launch-error') {
  root.render(
    <StrictMode>
      <LaunchError problem={started.problem} />
    </StrictMode>,
  );
} else {
  const projectStore = createProjectStore(started.document);
  const runStore = createRunStore(createRunSession(registry));
  if (started.saveTo) {
    startAutosave(projectStore, started.saveTo, (error) => console.warn('The project could not be saved.', error));
  }

  if (import.meta.env.DEV) {
    installTestHooks(projectStore);
  }

  root.render(
    <StrictMode>
      <App
        projectStore={projectStore}
        runStore={runStore}
        registry={registry}
        boardPins={boardPins}
        notice={started.notice}
      />
    </StrictMode>,
  );
}
