import { useStore } from 'zustand';
import type { DeviceRegistry } from '../../core/devices/registry';
import { BlocklyPanel } from '../blockly/BlocklyPanel';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import type { ProjectStore } from '../state/project-store';
import './app.css';

type AppProps = { projectStore: ProjectStore; registry: DeviceRegistry; boardPins: readonly string[] };

export function App({ projectStore, registry, boardPins }: AppProps) {
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
          <BlocklyPanel projectStore={projectStore} boardPins={boardPins} />
        </section>
      </main>
    </div>
  );
}
