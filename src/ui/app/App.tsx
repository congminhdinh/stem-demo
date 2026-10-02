import { useRef } from 'react';
import { useStore } from 'zustand';
import type { Circuit } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import type { ProjectStore } from '../state/project-store';
import { selectIsRunning, type RunStore } from '../state/run-store';
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
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
  const simulation = useStore(runStore, (state) => state.snapshot.simulation);
  const running = useStore(runStore, selectIsRunning);
  const blocklyRef = useRef<BlocklyPanelHandle>(null);

  const run = () => {
    // Run compiles the document, so the latest Blockly edits must be in it first.
    blocklyRef.current?.saveNow();
    runStore.getState().run(projectStore.getState().document);
  };

  // Every circuit edit lands here. The lock is read from the store, not from
  // the last render: an edit in the same task as Run must not slip through,
  // or the document would no longer match the circuit being run.
  const editCircuit = (circuit: Circuit) => {
    if (!selectIsRunning(runStore.getState())) {
      projectStore.getState().setCircuit(circuit);
    }
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
          {/* A loaded project starts without the previous selection or drag. */}
          <CircuitCanvas
            key={loadRevision}
            circuit={document.circuit}
            registry={registry}
            simulation={simulation}
            locked={running}
            onCircuitChange={editCircuit}
          />
        </section>
        <section className="program-region" aria-label="Program" data-testid="program-region">
          <BlocklyPanel ref={blocklyRef} projectStore={projectStore} boardPins={boardPins} />
        </section>
      </main>
    </div>
  );
}
