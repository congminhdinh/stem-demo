import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
import { useText, type Text } from '../i18n/text';
import { selectIsRunning, type RunStore } from '../state/run-store';
import { Console } from './Console';

/** A diagnostic of the core as the toolbar lists it: the core's message (English) after the UI's own prefix. */
export const diagnosticText = (t: Text, diagnostic: RunDiagnostic) =>
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message });

type RunToolbarProps = { runStore: RunStore; onRun(): void };

export function RunToolbar({ runStore, onRun }: RunToolbarProps) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
  const running = useStore(runStore, selectIsRunning);
  const t = useText();

  // A failed Run leaves the session idle, so its reasons come from the start result.
  const messages = startFailure
    ? [t(`run.failure.${startFailure.reason}`), ...startFailure.diagnostics.map((diagnostic) => diagnosticText(t, diagnostic))]
    : [
        ...(snapshot.error ? [t('run.error', { message: snapshot.error.message })] : []),
        ...snapshot.diagnostics.map((diagnostic) => diagnosticText(t, diagnostic)),
      ];

  return (
    <div className="run-toolbar" role="toolbar" aria-label={t('run.toolbar')}>
      <button type="button" onClick={onRun}>
        {t('run.run')}
      </button>
      <button type="button" onClick={() => runStore.getState().stop()} disabled={!running}>
        {t('run.stop')}
      </button>
      <span className={`run-status run-status-${snapshot.status}`} role="status" data-testid="run-status">
        {t(`run.status.${snapshot.status}`)}
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
