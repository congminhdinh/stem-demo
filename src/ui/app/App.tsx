import { useStore } from 'zustand';
import type { DeviceRegistry } from '../../core/devices/registry';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import type { ProjectStore } from '../state/project-store';
import './app.css';

type AppProps = { projectStore: ProjectStore; registry: DeviceRegistry };

export function App({ projectStore, registry }: AppProps) {
  const document = useStore(projectStore, (state) => state.document);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>STEM Studio</h1>
        <p>Proof of Concept</p>
      </header>
      <main className="workspace">
        <section className="canvas-region" aria-label="Circuit">
          <CircuitCanvas circuit={document.circuit} registry={registry} />
        </section>
        <section className="program-region" aria-label="Program" data-testid="program-region">
          <p className="placeholder">Blockly program editor comes here (POC-05).</p>
        </section>
      </main>
    </div>
  );
}
