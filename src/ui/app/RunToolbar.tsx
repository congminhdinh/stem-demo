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

/**
 * Run, Stop and the lab's actions, with the run's status before them (Fix 6, N17 m1). The toolbar sits at the right of the header,
 * so whatever changes width is on its left: a longer status never moves a button. What the run printed and why it failed or
 * warns are rows of their own under the header (RunOutput), never inside the toolbar.
 */
export function RunToolbar({ runStore, onRun, runDisabled = false, actions }: RunToolbarProps) {
  const status = useStore(runStore, (state) => state.snapshot.status);
  const running = useStore(runStore, selectIsRunning);
  const t = useText();
  const statusText = t(`run.status.${status}`);

  return (
    <div className="run-toolbar" role="toolbar" aria-label={t('run.toolbar')}>
      <span className={`run-status run-status-${status}`} role="status" title={statusText} data-testid="run-status">
        {statusText}
      </span>
      <button type="button" onClick={onRun} disabled={runDisabled}>
        {t('run.run')}
      </button>
      <button type="button" onClick={() => runStore.getState().stop()} disabled={!running}>
        {t('run.stop')}
      </button>
      {actions}
    </div>
  );
}

/** What the run printed (the console) and why it failed or warns: full-width rows of the header, under the toolbar and the goals. */
export function RunOutput({ runStore }: { runStore: RunStore }) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
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
    <>
      {snapshot.console && <Console console={snapshot.console} />}
      {messages.length > 0 && (
        <ul className="run-messages" data-testid="run-messages">
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * A button's label that keeps the width of the longest of its `labels` (Fix 6, N17 m1): Check becomes "Checking…" while it
 * checks, and the buttons beside it stay where they are. Only `shown` is visible and named; the others only hold the room.
 */
export function SteadyLabel({ shown, labels }: { shown: string; labels: readonly string[] }) {
  return (
    <span className="steady-label">
      {labels.map((label) =>
        label === shown ? (
          <span key={label}>{label}</span>
        ) : (
          <span key={label} className="steady-label-room" aria-hidden="true">
            {label}
          </span>
        ),
      )}
    </span>
  );
}
