import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useStore } from 'zustand';
import { Console } from '../app/Console';
import type { BuzzerSound } from '../audio/use-buzzer-sound';
import { useText } from '../i18n/text';
import { Icon } from './icons';
import { isRunOver, shownRun, type RobotRunStore } from './robot-run-store';

// Under the robot lab's 3D view (N18 R4.4): the robot's button ("Nút", held with the pointer or the keyboard while a run goes on), the
// sound switch, and what the program printed on Serial, in the console the other labs use (N18 R8: quiet, not read out line by line; the
// sound button's name says what it does, "Tắt âm thanh" or "Bật âm thanh", so it is not also "pressed").

type RobotDockProps = {
  store: RobotRunStore;
  /** The kit's button role, or null when the kit has none. */
  buttonRole: string | null;
  sound: BuzzerSound;
};

/**
 * The robot's button: down while the pointer holds it or Space / Enter is held on it, up on release, on leaving the page's focus, and when
 * the run can no longer take it (stopped, over, a check or the replay of a round of one). One press per hold: a key's repeats are ignored.
 */
function HoldButton({ store, role }: { store: RobotRunStore; role: string }) {
  const t = useText();
  // N18 R6.3: a replay of a check's round takes only the scenario's presses, as the check did.
  const usable = useStore(store, (state) => state.active && !state.locked && state.round === null && !isRunOver(state.snapshot));
  const [down, setDown] = useState(false);
  const downRef = useRef(false);
  const press = (pressed: boolean) => {
    if (downRef.current === pressed) return;
    downRef.current = pressed;
    setDown(pressed);
    store.getState().press(role, pressed);
  };
  const pressRef = useRef(press);
  useEffect(() => {
    pressRef.current = press;
  });
  // A button that can no longer be used lets go (React does not fire pointerup on a disabled button).
  useEffect(() => {
    if (!usable) pressRef.current(false);
  }, [usable]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is not active has no capture: its up event still lets go.
    }
    press(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) press(true);
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      press(false);
    }
  };
  return (
    <button
      type="button"
      className="robot-hold-button"
      disabled={!usable}
      aria-pressed={down}
      title={t('robot.button.hint')}
      data-testid="robot-button"
      onPointerDown={onPointerDown}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onLostPointerCapture={() => press(false)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => press(false)}
    >
      <span className="robot-hold-cap" aria-hidden="true" />
      {t('robot.button')}
    </button>
  );
}

export function RobotDock({ store, buttonRole, sound }: RobotDockProps) {
  const t = useText();
  const output = useStore(store, (state) => shownRun(state)?.console ?? null);
  return (
    <div className="robot-dock" data-testid="robot-dock">
      <div className="robot-dock-actions">
        {buttonRole !== null && <HoldButton store={store} role={buttonRole} />}
        <button
          type="button"
          className="robot-sound"
          onClick={sound.toggle}
          title={sound.on ? t('sound.turnOff') : t('sound.turnOn')}
          aria-label={sound.on ? t('sound.turnOff') : t('sound.turnOn')}
          data-testid="robot-sound"
        >
          <Icon name={sound.on ? 'sound' : 'muted'} />
        </button>
      </div>
      <section className="robot-serial" aria-label={t('robot.serial')}>
        <h3>{t('robot.serial')}</h3>
        {output !== null && (output.lines.length > 0 || output.hidden > 0) ? (
          <Console console={output} quiet />
        ) : (
          <p className="robot-serial-empty" data-testid="robot-serial-empty">
            {t('robot.serial.empty')}
          </p>
        )}
      </section>
    </div>
  );
}
