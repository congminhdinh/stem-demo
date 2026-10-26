import { afterEach, describe, expect, it, vi } from 'vitest';
import { productionKits, referenceKitRef } from '../../core/hardware/catalog';
import { GRIPPER_ANGLE, GRIPPER_START } from '../../core/hardware/drivers';
import type { Kit } from '../../core/hardware/kit';
import { cameraKeyOf, type KeyLike } from './camera-keys';
import { createRepeater, driveKeyOf, GRIPPER_REPEAT_DELAY_MS, GRIPPER_REPEAT_INTERVAL_MS, gripperKeyOf, gripperLimits, LIFT_STEP_DEG } from './robot-tools';

// N19 E3: the gripper's keys in teleop. They are matched by the key's place (KeyboardEvent.code), so a layout or an input method that
// types another letter on that place still works; Q opens the claw, E closes it, R raises the arm 15°, F lowers it 15° (a held key repeats
// the step). None of them is a drive key (arrows, W A S D, Space) or a camera key (1 2 3 0 Home + − and Shift with the arrows).

const rover = productionKits.get(referenceKitRef) as Kit;
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;

describe('gripperKeyOf', () => {
  it('reads Q and E as the claw opening and closing, R and F as the lift going up and down by a step', () => {
    expect(gripperKeyOf({ code: 'KeyQ' })).toEqual({ part: 'claw', to: 'open' });
    expect(gripperKeyOf({ code: 'KeyE' })).toEqual({ part: 'claw', to: 'close' });
    expect(gripperKeyOf({ code: 'KeyR' })).toEqual({ part: 'lift', stepDeg: 15 });
    expect(gripperKeyOf({ code: 'KeyF' })).toEqual({ part: 'lift', stepDeg: -15 });
    expect(LIFT_STEP_DEG).toBe(15);
  });

  it('goes by the place of the key, not the letter it types: AZERTY’s KeyQ types an a, and a letter on another place is no gripper key', () => {
    expect(gripperKeyOf({ code: 'KeyQ', key: 'a' } as { code: string })).toEqual({ part: 'claw', to: 'open' });
    expect(gripperKeyOf({ code: 'KeyT', key: 'r' } as { code: string })).toBeNull();
    expect(gripperKeyOf({ code: '', key: 'q' } as { code: string })).toBeNull();
    expect(gripperKeyOf({} as { code: string })).toBeNull();
  });

  it('is none of the drive keys or the camera keys: those mean what they meant', () => {
    const others: KeyLike[] = [
      ...['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Digit1', 'Digit2', 'Digit3', 'Digit0', 'Home', 'NumpadAdd', 'NumpadSubtract', 'Equal', 'Minus', 'Escape', 'Enter'].map(
        (code): KeyLike => ({ key: code, code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false }),
      ),
      { key: 'ArrowLeft', code: 'ArrowLeft', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false, repeat: false },
    ];
    for (const event of others) expect(gripperKeyOf(event), `${event.code}${event.shiftKey ? ' + Shift' : ''}`).toBeNull();
    // And the gripper's keys are no drive and no camera key.
    for (const code of ['KeyQ', 'KeyE', 'KeyR', 'KeyF']) {
      const event: KeyLike = { key: code.slice(3).toLowerCase(), code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false };
      expect(driveKeyOf(event), code).toBeNull();
      expect(cameraKeyOf(event), code).toBeNull();
    }
  });
});

afterEach(() => void vi.useRealTimers());

describe('gripperLimits and the driver’s start angles', () => {
  it('the claw closes to the angle its jaws meet at (80° on ref-uno-gripper@0) and opens at 0°; the rover has none', () => {
    expect(gripperLimits(gripperKit)).toEqual({ clawOpenDeg: 0, clawClosedDeg: 80 });
    expect(gripperLimits(rover)).toBeNull();
  });

  it('a teleop run starts as setup() leaves the gripper, and the lift keeps the range the driver clamps to: one place, the driver’s (D-G3)', () => {
    expect(GRIPPER_START).toEqual({ clawDeg: 0, liftDeg: 90 });
    expect([GRIPPER_ANGLE.min, GRIPPER_ANGLE.max]).toEqual([0, 90]);
  });
});

describe('createRepeater: a held step is 10 a second', () => {
  it('steps nothing of its own at once, then after 0.4 s and every 0.1 s until stopped, however it is asked', () => {
    vi.useFakeTimers();
    expect([GRIPPER_REPEAT_DELAY_MS, GRIPPER_REPEAT_INTERVAL_MS]).toEqual([400, 100]);
    const step = vi.fn();
    const repeater = createRepeater(step);
    repeater.start();
    expect(step).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(step).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(step).toHaveBeenCalledTimes(4);
    repeater.stop();
    vi.advanceTimersByTime(5000);
    expect(step).toHaveBeenCalledTimes(4);
  });

  it('starting again restarts it (never two schedules), and stopping when nothing runs is safe', () => {
    vi.useFakeTimers();
    const step = vi.fn();
    const repeater = createRepeater(step);
    repeater.stop();
    repeater.start();
    vi.advanceTimersByTime(450);
    repeater.start();
    vi.advanceTimersByTime(399);
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1 + 100);
    expect(step).toHaveBeenCalledTimes(3);
    repeater.stop();
    repeater.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
