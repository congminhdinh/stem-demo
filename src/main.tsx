import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { localDeviceDefinitions } from './core/devices/local-catalog';
import { createDeviceRegistry } from './core/devices/registry';
import { productionProfiles } from './core/profiles';
import { createBlockPackCatalog } from './core/program/block-packs';
import { createRunSession } from './core/run/run-session';
import { createOnboardCapabilities } from './core/simulation/peripherals/onboard-capabilities';
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
// Which family and profile a project belongs to is decided by resolveBoardContext
// from the document's profile (YB plan §8.5); nothing here names a board type.
// The block packs are the data of every family's blocks, all of them registered
// with Blockly so any stored program loads, whatever profile is active.
const profiles = productionProfiles;
const packs = createBlockPackCatalog(registry);

// The project is chosen before anything renders: in the standalone editor the
// last project is read first, so nothing can be shown, edited or saved over
// it in the meantime; an embedded lab opens its template and never touches
// storage (S1).
const started = await openAtStartup(parseLaunch(window.location.search), {
  openRepository: () => createDexieProjectRepository(),
  registry,
  profiles,
  newId: () => crypto.randomUUID(),
  // Blockly, with the blocks of every pack, tells whether the editor can open a stored program.
  canOpenProgram: (blocks) => canOpenProgram(blocks, packs),
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
  // The onboard parts of a Yolo:Bit-compatible board (display, buttons, light, buzzer) are the run's capabilities.
  const runStore = createRunStore(
    createRunSession(registry, { profiles, packs, capabilities: createOnboardCapabilities }),
  );
  if (started.saveTo) {
    startAutosave(projectStore, started.saveTo, (error) => console.warn('The project could not be saved.', error));
  }

  if (import.meta.env.DEV) {
    installTestHooks(projectStore, profiles);
  }

  root.render(
    <StrictMode>
      <App
        projectStore={projectStore}
        runStore={runStore}
        registry={registry}
        profiles={profiles}
        packs={packs}
        notice={started.notice}
      />
    </StrictMode>,
  );
}
