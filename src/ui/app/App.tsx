import { useRef } from 'react';
import { useStore } from 'zustand';
import type { DeviceRegistry } from '../../core/devices/registry';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import type { ProjectStore } from '../state/project-store';
import type { RunStore } from '../state/run-store';
import { RunToolbar } from './RunToolbar';
import './app.css';

type AppProps = {
  projectStore: ProjectStore;
  runStore: RunStore;
  registry: DeviceRegistry;
  boardPins: readonly string[];
};

export function App({ projectStore, runStore, registry, boardPins }: AppProps) {
  const document = useStore(projectStore, (state) => state.document);
  const simulation = useStore(runStore, (state) => state.snapshot.simulation);
  const blocklyRef = useRef<BlocklyPanelHandle>(null);

  const run = () => {
    // Run compiles the document, so the latest Blockly edits must be in it first.
    blocklyRef.current?.saveNow();
    runStore.getState().run(projectStore.getState().document);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>STEM Studio</h1>
        <p>Proof of Concept</p>
        <RunToolbar runStore={runStore} onRun={run} />
      </header>
      <main className="workspace">
        <section className="canvas-region" aria-label="Circuit">
          <CircuitCanvas circuit={document.circuit} registry={registry} simulation={simulation} />
        </section>
        <section className="program-region" aria-label="Program" data-testid="program-region">
          <BlocklyPanel ref={blocklyRef} projectStore={projectStore} boardPins={boardPins} />
        </section>
      </main>
    </div>
  );
}
