import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
import { localizeCoreMessage } from '../i18n/core-text';
import type { Locale } from '../i18n/messages';
import { useLocale, useText, type Text } from '../i18n/text';
import { selectIsRunning, type RunStore } from '../state/run-store';
import { Console } from './Console';

/** A diagnostic of the core as the toolbar lists it: the core's message, in the UI's language (core-text.ts), after the UI's own prefix. */
export const diagnosticText = (t: Text, locale: Locale, diagnostic: RunDiagnostic) =>
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: localizeCoreMessage(diagnostic.message, locale) });

type RunToolbarProps = {
  runStore: RunStore;
  onRun(): void;
  /** True while something else drives the run (a lab's check, N6a S4): Run waits, Stop still stops. */
  runDisabled?: boolean;
  /** More buttons after Stop (a lab's Check and Reset). */
  actions?: ReactNode;
};

export function RunToolbar({ runStore, onRun, runDisabled = false, actions }: RunToolbarProps) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
  const running = useStore(runStore, selectIsRunning);
  const t = useText();
  const locale = useLocale();

  // A failed Run leaves the session idle, so its reasons come from the start result.
  const messages = startFailure
    ? [t(`run.failure.${startFailure.reason}`), ...startFailure.diagnostics.map((diagnostic) => diagnosticText(t, locale, diagnostic))]
    : [
        ...(snapshot.error ? [t('run.error', { message: localizeCoreMessage(snapshot.error.message, locale) })] : []),
        ...snapshot.diagnostics.map((diagnostic) => diagnosticText(t, locale, diagnostic)),
      ];

  return (
    <div className="run-toolbar" role="toolbar" aria-label={t('run.toolbar')}>
      <button type="button" onClick={onRun} disabled={runDisabled}>
        {t('run.run')}
      </button>
      <button type="button" onClick={() => runStore.getState().stop()} disabled={!running}>
        {t('run.stop')}
      </button>
      {actions}
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
