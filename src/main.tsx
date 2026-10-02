import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { projectDocumentSchema } from './core/circuit/document';
import { localDeviceDefinitions } from './core/devices/local-catalog';
import { createDeviceRegistry } from './core/devices/registry';
import { createRunSession } from './core/run/run-session';
import blinkSample from './samples/blink.project.json';
import { App } from './ui/app/App';
import { installTestHooks } from './ui/app/test-hooks';
import { createProjectStore } from './ui/state/project-store';
import { createRunStore } from './ui/state/run-store';

// Composition root: the only place that picks the local catalog and the sample.
const registry = createDeviceRegistry(localDeviceDefinitions);
const projectStore = createProjectStore(projectDocumentSchema.parse(blinkSample));
const runStore = createRunStore(createRunSession(registry));
// The PoC has a single board type; its pins are the board profile for blocks.
const boardPins = registry.get('board').board?.pins.map((pin) => pin.name) ?? [];

if (import.meta.env.DEV) {
  installTestHooks(projectStore);
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <App projectStore={projectStore} runStore={runStore} registry={registry} boardPins={boardPins} />
  </StrictMode>,
);
