import { useRef, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import { Icon } from './icons';
import { CHECK_SPEEDS, checkFraction, type CheckSpeed, type RobotCheckStore } from './robot-check-store';
import type { RobotRunStore } from './robot-run-store';

// The robot lab's Kiểm tra (N18 R6.3), in the header next to the run's controls, where the other labs keep Check: the button and the speed
// it checks at (1× and 4× show the rounds in the 3D view, Nhanh scores at once). While a check runs the group says which round it is in
// ("Lượt 2/3") with a progress bar, and offers to stop it.

type CheckControlsProps = {
  checks: RobotCheckStore;
  store: RobotRunStore;
  onCheck(): void;
};

export function CheckControls({ checks, store, onCheck }: CheckControlsProps) {
  const t = useText();
  const locale = useLocale();
  const speed = useStore(checks, (state) => state.speed);
  const running = useStore(checks, (state) => state.running);
  const starting = useStore(store, (state) => state.starting);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = CHECK_SPEEDS.indexOf(speed);
  const label = (value: CheckSpeed) => (value === 'fast' ? t('robot.check.speed.fast') : t('robot.speed.value', { value: formatNumber(value === '4x' ? 4 : 1, locale) }));
  // One radio group (WAI-ARIA), as the run's speed: Tab reaches the chosen one, the arrows, Home and End choose another and move to it.
  const onSpeedKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = CHECK_SPEEDS.length - 1;
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (chosen + 1) % CHECK_SPEEDS.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (chosen + last) % CHECK_SPEEDS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null) {
      return;
    }
    event.preventDefault();
    checks.getState().setSpeed(CHECK_SPEEDS[to]!);
    radios.current[to]?.focus();
  };

  if (running !== null) {
    const percent = Math.round(checkFraction(running) * 100);
    return (
      <div className="robot-check robot-check-running" role="group" aria-label={t('robot.check')} data-testid="robot-check" data-speed={running.speed}>
        <button type="button" className="robot-button" onClick={() => checks.getState().cancel()} data-testid="robot-check-cancel">
          <Icon name="stop" />
          {t('robot.check.cancel')}
        </button>
        <span className="robot-check-progress">
          <span className="robot-check-round" data-testid="robot-check-round">
            {t('robot.check.round', { round: running.index + 1, count: running.count })}
          </span>
          <span className="robot-check-bar" role="progressbar" aria-label={t('robot.check.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-testid="robot-check-bar">
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="robot-check" role="group" aria-label={t('robot.check')} data-testid="robot-check">
      <button type="button" className="robot-button robot-button-check" onClick={onCheck} disabled={starting} title={t('robot.check.hint')} data-testid="robot-check-start">
        <Icon name="check" />
        {t('robot.check')}
      </button>
      <div className="robot-speed robot-check-speed" role="radiogroup" aria-label={t('robot.check.speed')} data-testid="robot-check-speed" onKeyDown={onSpeedKey}>
        {CHECK_SPEEDS.map((value, index) => (
          <button
            key={value}
            ref={(button) => {
              radios.current[index] = button;
            }}
            type="button"
            role="radio"
            aria-checked={speed === value}
            tabIndex={index === chosen ? 0 : -1}
            title={value === 'fast' ? t('robot.check.speed.fast.hint') : undefined}
            onClick={() => checks.getState().setSpeed(value)}
            data-speed={value}
          >
            {label(value)}
          </button>
        ))}
      </div>
    </div>
  );
}
