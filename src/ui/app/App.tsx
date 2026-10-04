import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createNewProject, type Circuit } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { Notice } from '../../core/persistence/project-repository';
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
  /** Why the app did not open the saved project, if it did not (plan §7). */
  notice?: Notice | null;
};

export function App({ projectStore, runStore, registry, boardPins, notice = null }: AppProps) {
  const document = useStore(projectStore, (state) => state.document);
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
  const simulation = useStore(runStore, (state) => state.snapshot.simulation);
  const running = useStore(runStore, selectIsRunning);
  const blocklyRef = useRef<BlocklyPanelHandle>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // A notice about the project the app opened is gone once another one is
  // loaded (New); one about the session (no saving) stays until dismissed.
  const isNoticeOutdated = notice?.about === 'opened-project' && loadRevision !== 0;
  const shownNotice = noticeDismissed || isNoticeOutdated ? null : notice?.message;

  const run = () => {
    // Run compiles the document, so the latest Blockly edits must be in it first.
    blocklyRef.current?.saveNow();
    runStore.getState().run(projectStore.getState().document);
  };

  // New replaces the whole project, so it is locked while running like any
  // edit. Why the last Run did not start was about the replaced project.
  const newProject = () => {
    if (!selectIsRunning(runStore.getState())) {
      projectStore.getState().loadProject(createNewProject(crypto.randomUUID()));
      runStore.getState().clearStartFailure();
    }
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
        <button type="button" onClick={newProject} disabled={running}>
          New
        </button>
        <RunToolbar runStore={runStore} onRun={run} />
        {shownNotice && (
          <p className="app-notice" role="status" data-testid="app-notice">
            {shownNotice}
            <button type="button" onClick={() => setNoticeDismissed(true)}>
              Dismiss
            </button>
          </p>
        )}
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
            // Runtime input, not an edit: the session ignores it unless running.
            onContactChange={(componentId, closed) => runStore.getState().setContactInput(componentId, closed)}
          />
        </section>
        <section className="program-region" aria-label="Program" data-testid="program-region">
          <BlocklyPanel ref={blocklyRef} projectStore={projectStore} boardPins={boardPins} />
        </section>
      </main>
    </div>
  );
}
