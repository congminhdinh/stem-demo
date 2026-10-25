import { useStore } from 'zustand';
import { SteadyLabel } from '../app/RunToolbar';
import { useLocale, useText } from '../i18n/text';
import { formatNumber } from './format';
import { Icon } from './icons';
import { isRunOver, ROBOT_SPEEDS, type RobotRunStore } from './robot-run-store';

// The robot lab's run controls (N18 R4.4), in the header where the other labs have Run and Stop: Chạy, Dừng, Tạm dừng / Tiếp tục,
// Bước 0,1 s, Đặt lại robot and the speed (0,5× to 4×). Everything is locked while a check holds the lab (R6.3). Run and Step are the
// lab's (they save the blocks and compile the project); the rest goes to the store.

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
  const over = useStore(store, (state) => state.snapshot.status !== 'idle' && isRunOver(state.snapshot));
  const { stop, togglePause, resetRobot, setSpeed } = store.getState();

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
        disabled={locked || starting || (!active && !held)}
        title={t('robot.resetRobot.hint')}
        data-testid="robot-reset"
      >
        <Icon name="reset" />
        {t('robot.resetRobot')}
      </button>
      <div className="robot-speed" role="radiogroup" aria-label={t('robot.speed')} data-testid="robot-speed">
        <span className="robot-speed-label" aria-hidden="true">
          {t('robot.speed')}
        </span>
        {ROBOT_SPEEDS.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={speed === value} disabled={locked} onClick={() => setSpeed(value)}>
            {t('robot.speed.value', { value: formatNumber(value, locale) })}
          </button>
        ))}
      </div>
    </div>
  );
}
