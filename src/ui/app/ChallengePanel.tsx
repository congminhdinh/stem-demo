import type { Challenge, CheckResult } from '../../core/challenge';
import { useText } from '../i18n/text';

// The goals of a lab and how the last check went (N6a S4): every goal with its state, and one line that says
// what to do next. The state is said in words as well as by the mark, for whoever cannot see the colour.

export type CheckView =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; result: CheckResult; started: boolean };

export function ChallengePanel({ challenge, check }: { challenge: Challenge; check: CheckView }) {
  const t = useText();
  const verdict = (goalId: string) => (check.state === 'done' ? check.result.goals.find((goal) => goal.id === goalId)?.passed : undefined);
  const summary =
    check.state === 'checking'
      ? t('lab.result.checking')
      : check.state === 'done'
        ? check.result.passed
          ? t('lab.result.passed')
          : check.started
            ? t('lab.result.failed')
            : t('lab.result.notStarted')
        : '';
  return (
    <section className="challenge-panel" aria-label={t('lab.goals')} data-testid="challenge-panel">
      <h2>{t('lab.goals')}</h2>
      <ul>
        {challenge.goals.map((goal) => {
          const passed = verdict(goal.id);
          const state = passed === undefined ? 'todo' : passed ? 'passed' : 'failed';
          return (
            <li key={goal.id} className={`challenge-goal challenge-goal-${state}`} data-testid={`goal-${goal.id}`} data-state={state}>
              <span className="challenge-goal-mark" aria-hidden="true">
                {state === 'passed' ? '✓' : state === 'failed' ? '✗' : '○'}
              </span>
              {goal.label}
              <span className="visually-hidden">, {t(`lab.goal.${state}`)}</span>
            </li>
          );
        })}
      </ul>
      <p
        className={check.state === 'done' ? `challenge-status challenge-status-${check.result.passed ? 'passed' : 'failed'}` : 'challenge-status'}
        role="status"
        data-testid="challenge-status"
      >
        {summary}
      </p>
    </section>
  );
}
