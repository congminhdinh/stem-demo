import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { RobotRunError } from '../../core/run/robot-run-session';
import type { RunDiagnostic } from '../../core/run/run-session';
import { diagnosticText } from '../app/RunToolbar';
import { localizeCoreMessage } from '../i18n/core-text';
import { useLocale, useText, type Text } from '../i18n/text';
import type { Locale } from '../i18n/messages';
import { shownRun, type RobotRunStore, type RobotStartFailure } from './robot-run-store';

// Why the robot lab's run did not start, or what went wrong in it (N18 R4.4), over the bottom of the 3D view: the reason in the learner's
// words, then the core's diagnostics said in their language (core-text.ts). A diagnostic that names a block is shown on that block
// (BlocklyPanel `blockWarnings`) and not repeated here. A failure of the simulation itself says so in plain words, its English detail
// folded away for whoever reports it. N18 R8: what the card shows is also said, once, to the lab's assertive region (`alert`), which is
// the card's only live role; Esc in the card, or its ×, dismisses it and the focus goes back to the view.

type Shown = { messages: string[]; detail: string | null };

const internal = (code: string | undefined) => code === 'internal-error';

function startMessages(t: Text, locale: Locale, failure: RobotStartFailure): Shown {
  const reason = failure.reason === 'layer' || failure.reason === 'compile' || failure.reason === 'world-error' || failure.reason === 'scorer-error' ? failure.reason : null;
  const unnamed = failure.diagnostics.filter((diagnostic) => diagnostic.blockId === undefined && !internal(diagnostic.code));
  return {
    messages: [...(reason ? [t(`robot.failure.${reason}`)] : []), ...unnamed.map((diagnostic) => diagnosticText(t, locale, diagnostic))],
    detail: failure.diagnostics.filter((diagnostic) => internal(diagnostic.code)).map((diagnostic) => diagnostic.message).join('\n') || null,
  };
}

function runMessages(t: Text, locale: Locale, error: RobotRunError | null, diagnostics: readonly RunDiagnostic[]): Shown {
  const unnamed = diagnostics.filter((diagnostic) => diagnostic.blockId === undefined && !internal(diagnostic.code));
  const errorText = error === null ? [] : internal(error.code) ? [t('robot.error.internal')] : [t('run.error', { message: localizeCoreMessage(error.message, locale) })];
  return { messages: [...errorText, ...unnamed.map((diagnostic) => diagnosticText(t, locale, diagnostic))], detail: error !== null && internal(error.code) ? error.message : null };
}

export function RunMessages({ store, alert }: { store: RobotRunStore; alert?(text: string): void }) {
  const t = useText();
  const locale = useLocale();
  const startFailure = useStore(store, (state) => state.startFailure);
  // As text, so that a new snapshot with the same messages renders nothing.
  const runText = useStore(store, (state) => {
    const run = shownRun(state);
    return run === null ? 'null' : JSON.stringify({ error: run.error, diagnostics: run.diagnostics });
  });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const run = JSON.parse(runText) as { error: RobotRunError | null; diagnostics: RunDiagnostic[] } | null;
  const shown = startFailure ? startMessages(t, locale, startFailure) : run ? runMessages(t, locale, run.error, run.diagnostics) : { messages: [], detail: null };
  const key = JSON.stringify(shown);
  const visible = shown.messages.length > 0 && dismissed !== key;
  const said = visible ? shown.messages.join(' ') : '';
  useEffect(() => {
    if (said !== '') alert?.(said);
  }, [said, alert]);
  if (!visible) {
    return null;
  }
  const dismiss = (from: Element) => {
    setDismissed(key);
    // The card goes with the focus that was in it: the view takes it.
    from.closest<HTMLElement>('.robot-stage')?.focus({ preventScroll: true });
  };
  return (
    <div
      className="robot-messages"
      data-testid="robot-messages"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss(event.currentTarget);
        }
      }}
    >
      <ul>
        {shown.messages.map((message, index) => (
          <li key={index}>{message}</li>
        ))}
      </ul>
      {shown.detail !== null && (
        <details>
          <summary>{t('robot.error.detail')}</summary>
          <pre>{shown.detail}</pre>
        </details>
      )}
      <button type="button" className="robot-messages-close" onClick={(event) => dismiss(event.currentTarget)} aria-label={t('app.dismiss')} title={t('app.dismiss')}>
        ×
      </button>
    </div>
  );
}
