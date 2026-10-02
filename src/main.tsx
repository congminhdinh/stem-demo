import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { projectDocumentSchema } from './core/circuit/document';
import { localDeviceDefinitions } from './core/devices/local-catalog';
import { createDeviceRegistry } from './core/devices/registry';
import ledOnSample from './samples/led-on.project.json';
import { App } from './ui/app/App';
import { installTestHooks } from './ui/app/test-hooks';
import { createProjectStore } from './ui/state/project-store';

// Composition root: the only place that picks the local catalog and the sample.
const registry = createDeviceRegistry(localDeviceDefinitions);
const projectStore = createProjectStore(projectDocumentSchema.parse(ledOnSample));

if (import.meta.env.DEV) {
  installTestHooks();
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <App projectStore={projectStore} registry={registry} />
  </StrictMode>,
);
