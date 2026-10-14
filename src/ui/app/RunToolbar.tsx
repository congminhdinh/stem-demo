import { useStore } from 'zustand';
import type { RunDiagnostic, RunStatus } from '../../core/run/run-session';
import { selectIsRunning, type RunState, type RunStore } from '../state/run-store';
import { Console } from './Console';

const statusText: Record<RunStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  finished: 'Program finished — board powered',
  error: 'Error',
};

const startFailureText: Record<NonNullable<RunState['startFailure']>['reason'], string> = {
  'no-board': 'The circuit needs a board.',
  'multiple-boards': 'The circuit can have only one board.',
  'incompatible-devices': 'The circuit has devices that this kind of project cannot use.',
  'compile-error': 'The program has errors.',
};

const diagnosticText = (diagnostic: RunDiagnostic) =>
  `${diagnostic.severity === 'error' ? 'Error' : 'Warning'}: ${diagnostic.message}`;

type RunToolbarProps = { runStore: RunStore; onRun(): void };

export function RunToolbar({ runStore, onRun }: RunToolbarProps) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
  const running = useStore(runStore, selectIsRunning);

  // A failed Run leaves the session idle, so its reasons come from the start result.
  const messages = startFailure
    ? [startFailureText[startFailure.reason], ...startFailure.diagnostics.map(diagnosticText)]
    : [...(snapshot.error ? [`Error: ${snapshot.error.message}`] : []), ...snapshot.diagnostics.map(diagnosticText)];

  return (
    <div className="run-toolbar" role="toolbar" aria-label="Run">
      <button type="button" onClick={onRun}>
        Run
      </button>
      <button type="button" onClick={() => runStore.getState().stop()} disabled={!running}>
        Stop
      </button>
      <span className={`run-status run-status-${snapshot.status}`} role="status" data-testid="run-status">
        {statusText[snapshot.status]}
      </span>
      {snapshot.console && <Console console={snapshot.console} />}
      {messages.length > 0 && (
        <ul className="run-messages" data-testid="run-messages">
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
