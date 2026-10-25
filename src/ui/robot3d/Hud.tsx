import { useState } from 'react';
import { useStore } from 'zustand';
import { TELEOP_LIMIT_S } from '../../core/run/teleop';
import { scenarioMaxScore, type Scenario } from '../../core/scenario/scenario';
import type { ScoreState } from '../../core/world/snapshot';
import { isMessageKey } from '../i18n/messages';
import { useLocale, useText } from '../i18n/text';
import { labStatus, shownRun, shownScore, type LabStatus, type RobotRunStore } from './robot-run-store';
import { formatNumber } from './format';

// The robot lab's HUD (N18 R4.4), over the top left of the 3D view: what the run is doing, its simulated time against the scenario's
// limit, the badge "slower than real time", and for a scenario with goals its score and each goal, met or not with how far it has got.
// It reads the store through selectors that change at most ten times a second (the time is shown in tenths), so a run re-renders it
// little; the 3D view never re-renders for it. N18 R6.3: while the view shows a round of a check (during a check at 1× or 4×, what the last
// round left, a replay) it says which ("Lượt 2/3"), and once that round's run is over its score is the check's (0 after an error).
// N18 R8: the status is no live region (it would speak every change of state, twice): the lab's announcer says the events of a run once,
// with the reason it ended.

type HudProps = {
  store: RobotRunStore;
  scenario: Scenario;
};

/** The colour a status is shown in: an alert only for a crash and an error, a success for a run that met every goal. */
export type StatusTone = 'neutral' | 'active' | 'info' | 'success' | 'alert' | 'error';

export function statusTone(status: LabStatus, allGoalsMet: boolean): StatusTone {
  switch (status) {
    case 'running':
    case 'teleop':
      return 'active';
    case 'paused':
    case 'finished':
      return 'info';
    case 'timeUp':
      return allGoalsMet ? 'success' : 'neutral';
    case 'crashed':
      return 'alert';
    case 'error':
      return 'error';
    default:
      return 'neutral';
  }
}

/** The time shown, s, in whole tenths: the HUD renders only when it changes. */
const tenths = (t: number) => Math.floor(t * 10 + 1e-9) / 10;

export function Hud({ store, scenario }: HudProps) {
  const t = useText();
  const locale = useLocale();
  const status = useStore(store, (state) => labStatus(state));
  const time = useStore(store, (state) => tenths(shownRun(state)?.world?.t ?? 0));
  const slower = useStore(store, (state) => state.snapshot.status !== 'idle' && state.snapshot.slowerThanRealtime);
  const outOfArena = useStore(store, (state) => shownRun(state)?.world?.outOfArena === true);
  // The score as text: a new snapshot with the same score renders nothing.
  const scoreText = useStore(store, (state) => JSON.stringify(shownScore(state)));
  const round = useStore(store, (state) => (state.round === null ? null : `${state.round.index + 1}/${state.round.count}`));
  // N18 R4.8 fix round 1: teleop is not held to the scenario's time limit, only to TELEOP_LIMIT_S.
  const limitS = useStore(store, (state) => (state.teleop ? TELEOP_LIMIT_S : scenario.timeLimitS));
  const [goalsOpen, setGoalsOpen] = useState(true);

  const score = JSON.parse(scoreText) as ScoreState | null;
  const maxScore = scenarioMaxScore(scenario);
  const hasGoals = scenario.goals.length > 0;
  const results = new Map((score?.goals ?? []).map((goal) => [goal.id, goal]));
  // How the status reads (N18 R4.2 fix round 1): a run that ends at its time limit is no failure, a success when every goal was met;
  // only a crash and an error are alerts.
  const allMet = hasGoals && scenario.goals.every((goal) => results.get(goal.id)?.passed === true);
  const tone = statusTone(status, allMet);

  return (
    <section className="robot-hud" aria-label={t('robot.hud')} data-testid="robot-hud" data-status={status}>
      <div className="robot-hud-row">
        {round !== null && (
          <span className="robot-badge robot-badge-round" data-testid="robot-round">
            {t('robot.check.round', { round: round.split('/')[0]!, count: round.split('/')[1]! })}
          </span>
        )}
        <span className={`robot-status robot-status-${tone}`} data-testid="robot-status" data-tone={tone}>
          {t(`robot.status.${status}`)}
        </span>
        <span className="robot-hud-time" data-testid="robot-time" title={t('robot.hud.time')}>
          <span className="robot-hud-label">{t('robot.hud.time')}</span>{' '}
          {t('robot.hud.timeOf', { value: formatNumber(time, locale, 1), limit: formatNumber(limitS, locale) })}
        </span>
      </div>
      {(slower || outOfArena) && (
        <div className="robot-hud-row">
          {slower && (
            <span className="robot-badge robot-badge-slow" data-testid="robot-slower" title={t('robot.slower.hint')}>
              {t('robot.slower')}
            </span>
          )}
          {outOfArena && (
            <span className="robot-badge robot-badge-out" data-testid="robot-out-of-arena">
              {t('robot.outOfArena')}
            </span>
          )}
        </div>
      )}
      {hasGoals && maxScore !== undefined && (
        <>
          <div className="robot-hud-row">
            <span className="robot-hud-score" data-testid="robot-score">
              <span className="robot-hud-label">{t('robot.hud.score')}</span> <strong>{t('robot.hud.points', { points: score?.points ?? 0, max: maxScore })}</strong>
            </span>
            <button type="button" className="robot-hud-toggle" aria-expanded={goalsOpen} onClick={() => setGoalsOpen(!goalsOpen)} title={goalsOpen ? t('robot.hud.hideGoals') : t('robot.hud.showGoals')}>
              {t('robot.hud.goals')}
              <span aria-hidden="true">{goalsOpen ? '▴' : '▾'}</span>
            </button>
          </div>
          {goalsOpen && (
            <ul className="robot-goals" data-testid="robot-goals">
              {scenario.goals.map((goal) => {
                const result = results.get(goal.id);
                const passed = result?.passed === true;
                const progress = passed ? 1 : (result?.progress ?? 0);
                const reason = !passed && result?.reasonKey !== undefined && isMessageKey(result.reasonKey) ? t(result.reasonKey) : undefined;
                return (
                  <li key={goal.id} className={passed ? 'robot-goal robot-goal-passed' : 'robot-goal'} data-goal={goal.id} data-passed={passed} title={reason}>
                    <span className="robot-goal-mark" aria-hidden="true">
                      {passed ? '✓' : ''}
                    </span>
                    <span className="robot-goal-label">
                      {goal.label[locale]}
                      <span className="visually-hidden">{` (${t(passed ? 'robot.hud.goal.passed' : 'robot.hud.goal.pending')})`}</span>
                    </span>
                    <span className="robot-goal-points">{t('robot.hud.goal.points', { points: goal.points })}</span>
                    {!passed && progress > 0 && (
                      <span className="robot-goal-progress" aria-hidden="true">
                        <span style={{ width: `${Math.round(progress * 100)}%` }} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
