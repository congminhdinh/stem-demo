import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { Scenario } from '../../core/scenario/scenario';
import { hashSnapshot } from '../../core/world/snapshot';
import { useLocale, useText } from '../i18n/text';
import type { ProjectStore } from '../state/project-store';
import { checkReport } from './check-report';
import { Icon } from './icons';
import { checkFraction, type CheckRecord, type RobotCheckStore } from './robot-check-store';
import type { RobotRunStore } from './robot-run-store';

// What a check shows over the robot lab's 3D view (N18 R6.3).
//
//   - A fast check (headless) is not shown while it runs: a progress view stands over the view instead (the round, a progress bar, the
//     rounds scored so far), never a frozen scene.
//   - After a check, its result: passed or not with the score (the lowest round's), each round's verdict and score (the check's: 0 for a
//     round that ended in an error) with "Xem lại" for a round that failed, each goal (passed in every round) with why not in each round it
//     failed ("Xe chạm tường lúc 12,4 s ở lượt 2"), and the time bonus line. It belongs to the program it checked: an edit closes it, as
//     the other labs' results go back to "not checked yet". It folds to its first line while a round is replayed, so the arena shows.

type CheckResultsProps = {
  checks: RobotCheckStore;
  store: RobotRunStore;
  projectStore: ProjectStore;
  scenario: Scenario;
};

/** The progress of a fast check, over the 3D view. */
export function FastCheckView({ checks }: { checks: RobotCheckStore }) {
  const t = useText();
  const running = useStore(checks, (state) => state.running);
  if (running === null || running.speed !== 'fast') {
    return null;
  }
  const percent = Math.round(checkFraction(running) * 100);
  return (
    <div className="robot-check-fast" role="status" data-testid="robot-check-fast">
      <p className="robot-check-fast-title">{t('robot.check.fastRunning')}</p>
      <p>{t('robot.check.round', { round: running.index + 1, count: running.count })}</p>
      <span className="robot-check-bar robot-check-bar-wide" role="progressbar" aria-label={t('robot.check.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </span>
      {running.ended.length > 0 && (
        <ul className="robot-check-fast-rounds">
          {running.ended.map((round) => (
            <li key={round.index} data-passed={round.passed}>
              <span aria-hidden="true">{round.passed ? '✓' : '✗'}</span> {t('robot.check.variant', { round: round.index + 1 })}:{' '}
              {t('robot.check.variant.points', { points: round.score })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CheckResults({ checks, store, projectStore, scenario }: CheckResultsProps) {
  const report = useStore(checks, (state) => state.report);
  // The result belongs to the program it checked: once the learner edits, it is no longer about what the blocks say.
  const current = useStore(projectStore, (state) => report !== null && state.document === report.document);
  if (report === null || !current) {
    return null;
  }
  return <CheckPanel checks={checks} store={store} scenario={scenario} record={report} />;
}

function CheckPanel({ checks, store, scenario, record }: { checks: RobotCheckStore; store: RobotRunStore; scenario: Scenario; record: CheckRecord }) {
  const t = useText();
  const locale = useLocale();
  const locked = useStore(store, (state) => state.locked);
  // Folded for this record: a new check's result opens.
  const [folded, setFolded] = useState<CheckRecord | null>(null);
  const open = folded !== record;
  const report = useMemo(() => checkReport(scenario, record.result, record.variants, t, locale), [scenario, record, t, locale]);
  const replay = (index: number) => {
    setFolded(record);
    void checks.getState().replay(index);
  };
  return (
    <section
      className={report.passed ? 'robot-check-panel robot-check-panel-passed' : 'robot-check-panel'}
      aria-label={t('robot.check.results')}
      data-testid="robot-check-results"
      data-passed={report.passed}
      data-open={open}
    >
      <div className="robot-check-panel-head">
        <h3>{t('robot.check.results')}</h3>
        <button
          type="button"
          className="robot-check-icon-button"
          aria-expanded={open}
          onClick={() => setFolded(open ? record : null)}
          title={t(open ? 'robot.check.collapse' : 'robot.check.expand')}
          aria-label={t(open ? 'robot.check.collapse' : 'robot.check.expand')}
          data-testid="robot-check-fold"
        >
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
        <button
          type="button"
          className="robot-check-icon-button"
          onClick={() => checks.getState().dismiss()}
          title={t('robot.check.close')}
          aria-label={t('robot.check.close')}
          data-testid="robot-check-close"
        >
          ×
        </button>
      </div>
      <p className="robot-check-summary">
        <span className="robot-check-verdict" data-testid="robot-check-verdict">
          {t(report.passed ? 'robot.check.passed' : 'robot.check.failed')}
        </span>
        <strong className="robot-check-score" data-testid="robot-check-score">
          {t('robot.check.score', { score: report.score, max: report.maxScore })}
        </strong>
        {open && report.count > 1 && <span className="robot-check-lowest">{t('robot.check.lowest', { count: report.count })}</span>}
      </p>
      {open && (
        <div className="robot-check-panel-body">
          <h4>{t('robot.check.rounds')}</h4>
          <ul className="robot-check-rounds" data-testid="robot-check-rounds">
            {report.variants.map((variant) => {
              const world = record.variants[variant.index]?.snapshot.world ?? null;
              return (
                <li
                  key={variant.index}
                  data-round={variant.round}
                  data-passed={variant.passed}
                  // Dev builds: the hash of the world the round ended in, which the E2E compares across speeds and with a replay.
                  data-world-hash={import.meta.env.DEV && world !== null ? hashSnapshot(world) : undefined}
                >
                  <span className="robot-check-mark" aria-hidden="true">
                    {variant.passed ? '✓' : '✗'}
                  </span>
                  <span className="robot-check-round-name">
                    {t('robot.check.variant', { round: variant.round })}
                    <span className="visually-hidden">{` (${t(variant.passed ? 'robot.check.passed' : 'robot.check.failed')})`}</span>
                  </span>
                  <span className="robot-check-points">{t('robot.check.variant.points', { points: variant.score })}</span>
                  {!variant.passed && (
                    <button
                      type="button"
                      className="robot-check-replay"
                      onClick={() => replay(variant.index)}
                      disabled={locked}
                      title={t('robot.check.replay.hint', { round: variant.round })}
                      data-testid={`robot-check-replay-${variant.round}`}
                    >
                      <Icon name="replay" />
                      {t('robot.check.replay')}
                    </button>
                  )}
                  {variant.note !== null && <p className="robot-check-why">{variant.note}</p>}
                </li>
              );
            })}
          </ul>
          <h4>{t('robot.check.goals')}</h4>
          <ul className="robot-check-goals" data-testid="robot-check-goals">
            {report.goals.map((goal) => (
              <li key={goal.id} data-goal={goal.id} data-passed={goal.passed}>
                <span className="robot-check-mark" aria-hidden="true">
                  {goal.passed ? '✓' : '✗'}
                </span>
                <span className="robot-check-goal-label">
                  {goal.label}
                  <span className="visually-hidden">{` (${t(goal.passed ? 'robot.check.passed' : 'robot.check.failed')})`}</span>
                </span>
                <span className="robot-check-points">{t('robot.hud.goal.points', { points: goal.points })}</span>
                {goal.why.length > 0 && (
                  <ul className="robot-check-why-list">
                    {goal.why.map((why) => (
                      <li key={why} className="robot-check-why">
                        {why}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {report.bonus !== null && (
            <p className="robot-check-bonus" data-testid="robot-check-bonus">
              {report.bonus}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
