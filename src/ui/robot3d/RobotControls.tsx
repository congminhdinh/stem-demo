import { useRef, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { SteadyLabel } from '../app/RunToolbar';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import { Icon } from './icons';
import { isRunOver, ROBOT_SPEEDS, type RobotRunStore } from './robot-run-store';

// The robot lab's run controls (N18 R4.4), in the header where the other labs have Run and Stop: Chạy, Dừng, Tạm dừng / Tiếp tục,
// Bước 0,1 s, Đặt lại robot and the speed (0,5× to 4×). Everything is locked while a check holds the lab (R6.3). Run and Step are the
// lab's (they save the blocks and compile the project); the rest goes to the store. N18 R4.8: with the robot placed (Di chuyển robot),
// Đặt lại robot goes back to the placed pose, then, pressed again, to the lesson's start; its tooltip says which.

type RobotControlsProps = {
  store: RobotRunStore;
  onRun(): void;
  onStep(): void;
};

export function RobotControls({ store, onRun, onStep }: RobotControlsProps) {
  const t = useText();
  const locale = useLocale();
  const active = useStore(store, (state) => state.active);
  const starting = useStore(store, (state) => state.starting);
  const paused = useStore(store, (state) => state.paused);
  const speed = useStore(store, (state) => state.speed);
  const locked = useStore(store, (state) => state.locked);
  const held = useStore(store, (state) => state.held !== null);
  const placed = useStore(store, (state) => state.placement !== null);
  const toStart = useStore(store, (state) => state.resetToStart);
  const over = useStore(store, (state) => state.snapshot.status !== 'idle' && isRunOver(state.snapshot));
  const { stop, togglePause, resetRobot, setSpeed } = store.getState();
  // The speeds are one radio group (WAI-ARIA): Tab reaches the chosen one, the arrows, Home and End choose another and move to it.
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = ROBOT_SPEEDS.indexOf(speed as (typeof ROBOT_SPEEDS)[number]);
  const onSpeedKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = ROBOT_SPEEDS.length - 1;
    const from = chosen < 0 ? 0 : chosen;
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (from + 1) % ROBOT_SPEEDS.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (from + last) % ROBOT_SPEEDS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null || locked) {
      return;
    }
    event.preventDefault();
    setSpeed(ROBOT_SPEEDS[to]!);
    radios.current[to]?.focus();
  };

  return (
    <div className="robot-controls" role="toolbar" aria-label={t('robot.controls')} data-testid="robot-controls">
      <button type="button" className="robot-button robot-button-primary" onClick={onRun} disabled={locked} data-testid="robot-run">
        <Icon name="run" />
        {t('robot.run')}
      </button>
      <button type="button" className="robot-button" onClick={stop} disabled={locked || (!active && !starting)} data-testid="robot-stop">
        <Icon name="stop" />
        {t('robot.stop')}
      </button>
      <button type="button" className="robot-button" onClick={togglePause} disabled={locked || !active || over} aria-pressed={paused} data-testid="robot-pause">
        <Icon name={paused ? 'resume' : 'pause'} />
        <SteadyLabel shown={paused ? t('robot.resume') : t('robot.pause')} labels={[t('robot.pause'), t('robot.resume')]} />
      </button>
      <button type="button" className="robot-button" onClick={onStep} disabled={locked || starting || over} title={t('robot.step.hint')} data-testid="robot-step">
        <Icon name="step" />
        {t('robot.step')}
      </button>
      <button
        type="button"
        className="robot-button"
        onClick={() => void resetRobot()}
        disabled={locked || starting || (!active && !held && !placed)}
        title={t(!placed ? 'robot.resetRobot.hint' : toStart ? 'robot.resetRobot.hintToStart' : 'robot.resetRobot.hintPlaced')}
        data-testid="robot-reset"
      >
        <Icon name="reset" />
        {t('robot.resetRobot')}
      </button>
      <div className="robot-speed" role="radiogroup" aria-label={t('robot.speed')} data-testid="robot-speed" onKeyDown={onSpeedKey}>
        <span className="robot-speed-label" aria-hidden="true">
          {t('robot.speed')}
        </span>
        {ROBOT_SPEEDS.map((value, index) => (
          <button
            key={value}
            ref={(button) => {
              radios.current[index] = button;
            }}
            type="button"
            role="radio"
            aria-checked={speed === value}
            tabIndex={index === (chosen < 0 ? 0 : chosen) ? 0 : -1}
            disabled={locked}
            onClick={() => setSpeed(value)}
          >
            {t('robot.speed.value', { value: formatNumber(value, locale) })}
          </button>
        ))}
      </div>
    </div>
  );
}
