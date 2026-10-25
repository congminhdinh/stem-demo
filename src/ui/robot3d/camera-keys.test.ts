import { describe, expect, it } from 'vitest';
import { cameraKeyOf, orbitedOffset, zoomedOffset, ORBIT_STEP_RAD, ZOOM_FACTOR } from './camera-keys';
import { createCameraCommands, type CameraCommand } from './camera-commands';

// N18 R8: the camera by keyboard, for a learner who cannot drag: 1 / 2 / 3 choose Tự do / Theo xe / Nhìn từ trên, 0 or Home put the view
// back, + and − zoom, Shift with the arrows orbit (plain arrows drive the robot in teleop). The key reading is plain, the arithmetic of a
// step exact; the lab reads these keys only when the 3D view has the focus and never from a field or the block editor (use-camera-keys.ts).

const key = (init: { key: string; code?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean }) => cameraKeyOf({ code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...init });

describe('cameraKeyOf', () => {
  it('reads 1, 2 and 3 as the three views, by the key or the digit key’s place', () => {
    expect(key({ key: '1' })).toEqual({ kind: 'mode', mode: 'orbit' });
    expect(key({ key: '2' })).toEqual({ kind: 'mode', mode: 'follow' });
    expect(key({ key: '3' })).toEqual({ kind: 'mode', mode: 'top' });
    expect(key({ key: 'ă', code: 'Digit2' })).toEqual({ kind: 'mode', mode: 'follow' });
    expect(key({ key: '3', code: 'Numpad3' })).toEqual({ kind: 'mode', mode: 'top' });
    expect(key({ key: '4' })).toBeNull();
  });

  it('reads 0 and Home as putting the view back', () => {
    expect(key({ key: '0' })).toEqual({ kind: 'reset' });
    expect(key({ key: 'Home' })).toEqual({ kind: 'reset' });
    expect(key({ key: '0', code: 'Numpad0' })).toEqual({ kind: 'reset' });
  });

  it('reads + and = as zooming in and − and _ as zooming out, with or without Shift, and the numeric keypad’s', () => {
    expect(key({ key: '+', shiftKey: true })).toEqual({ kind: 'zoom', direction: 'in' });
    expect(key({ key: '=' })).toEqual({ kind: 'zoom', direction: 'in' });
    expect(key({ key: '+', code: 'NumpadAdd' })).toEqual({ kind: 'zoom', direction: 'in' });
    expect(key({ key: '-' })).toEqual({ kind: 'zoom', direction: 'out' });
    expect(key({ key: '_', shiftKey: true })).toEqual({ kind: 'zoom', direction: 'out' });
    expect(key({ key: '-', code: 'NumpadSubtract' })).toEqual({ kind: 'zoom', direction: 'out' });
  });

  it('reads Shift with an arrow as an orbit step: the camera swings the way the arrow points (left, right) or rises and sinks (up, down)', () => {
    expect(key({ key: 'ArrowLeft', shiftKey: true })).toEqual({ kind: 'orbit', dx: -1, dy: 0 });
    expect(key({ key: 'ArrowRight', shiftKey: true })).toEqual({ kind: 'orbit', dx: 1, dy: 0 });
    expect(key({ key: 'ArrowUp', shiftKey: true })).toEqual({ kind: 'orbit', dx: 0, dy: 1 });
    expect(key({ key: 'ArrowDown', shiftKey: true })).toEqual({ kind: 'orbit', dx: 0, dy: -1 });
  });

  it('leaves the plain arrows to the robot (teleop) and to the tools', () => {
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) expect(key({ key: arrow })).toBeNull();
  });

  it('leaves the browser’s and the system’s shortcuts alone: Ctrl, Meta or Alt with a key is never the camera’s', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(key({ key: '1', [modifier]: true })).toBeNull();
      expect(key({ key: '+', [modifier]: true })).toBeNull();
      expect(key({ key: '0', [modifier]: true })).toBeNull();
      expect(key({ key: 'ArrowLeft', shiftKey: true, [modifier]: true })).toBeNull();
    }
  });

  it('does not take a digit or Home typed with Shift (a symbol on another layout)', () => {
    expect(key({ key: '!', code: 'Digit1', shiftKey: true })).toBeNull();
    expect(key({ key: 'Home', shiftKey: true })).toBeNull();
  });

  it('lets a held zoom or orbit repeat, and a held view key act once', () => {
    expect(key({ key: '+', repeat: true })).toEqual({ kind: 'zoom', direction: 'in' });
    expect(key({ key: 'ArrowLeft', shiftKey: true, repeat: true })).toEqual({ kind: 'orbit', dx: -1, dy: 0 });
    expect(key({ key: '2', repeat: true })).toBeNull();
    expect(key({ key: '0', repeat: true })).toBeNull();
    expect(key({ key: 'Home', repeat: true })).toBeNull();
  });
});

describe('orbitedOffset', () => {
  const near = (actual: readonly number[], expected: readonly number[]) => expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 9));

  it('swings the camera round the target to its right: a quarter turn takes it from in front (+z) to the right (+x), as far away', () => {
    near(orbitedOffset([0, 0, 1], 1, 0, Math.PI / 2, Math.PI / 2), [1, 0, 0]);
    near(orbitedOffset([0, 0, 1], -1, 0, Math.PI / 2, Math.PI / 2), [-1, 0, 0]);
    // The same distance and height from any place round.
    const [x, y, z] = orbitedOffset([0.3, 0.5, 0.4], 1, 0, 0.7, 1.48);
    expect(Math.hypot(x!, y!, z!)).toBeCloseTo(Math.hypot(0.3, 0.5, 0.4), 12);
    expect(y).toBeCloseTo(0.5, 12);
  });

  it('raises and sinks it along the sphere, never past the floor’s limit nor over the top', () => {
    // From level (polar angle 90°), up by 45° is at 45° from the vertical: height cos 45°, distance along the floor sin 45°.
    near(orbitedOffset([0, 0, 1], 0, 1, Math.PI / 4, Math.PI / 2), [0, Math.SQRT1_2, Math.SQRT1_2]);
    const lowest = orbitedOffset([0, 0.5, 1], 0, -1, Math.PI, 1.48);
    expect(Math.acos(lowest[1] / Math.hypot(...lowest))).toBeCloseTo(1.48, 12);
    const highest = orbitedOffset([0, 0.5, 1], 0, 1, Math.PI, 1.48);
    expect(Math.acos(highest[1] / Math.hypot(...highest))).toBeGreaterThan(0);
    expect(Math.acos(highest[1] / Math.hypot(...highest))).toBeLessThan(0.1);
  });

  it('a step is a few degrees, so that a held key sweeps smoothly', () => {
    expect((ORBIT_STEP_RAD * 180) / Math.PI).toBeCloseTo(7.5, 12);
  });
});

describe('zoomedOffset', () => {
  it('brings the camera in or takes it out by a share of its distance, within the view’s limits', () => {
    expect(ZOOM_FACTOR).toBe(0.85);
    expect(zoomedOffset([0, 0, 1], 'in', 0.12, 3)).toEqual([0, 0, 0.85]);
    const out = zoomedOffset([0, 0, 1], 'out', 0.12, 3);
    expect(out[2]).toBeCloseTo(1 / 0.85, 12);
    expect(zoomedOffset([0, 0, 0.13], 'in', 0.12, 3)).toEqual([0, 0, 0.12]);
    expect(zoomedOffset([0, 0, 2.9], 'out', 0.12, 3)).toEqual([0, 0, 3]);
    // The direction does not change.
    const [x, y, z] = zoomedOffset([0.3, 0.4, 0.5], 'in', 0.01, 3);
    expect([x! / 0.3, y! / 0.4, z! / 0.5].map((ratio) => Math.round(ratio * 1e9) / 1e9)).toEqual([0.85, 0.85, 0.85]);
  });
});

describe('the camera’s commands', () => {
  it('tell every listener, in order, until it stops listening', () => {
    const commands = createCameraCommands();
    const seen: CameraCommand[] = [];
    const stop = commands.subscribe((command) => seen.push(command));
    const other: CameraCommand[] = [];
    commands.subscribe((command) => other.push(command));
    commands.emit({ kind: 'reset' });
    stop();
    commands.emit({ kind: 'zoom', direction: 'out' });
    expect(seen).toEqual([{ kind: 'reset' }]);
    expect(other).toEqual([{ kind: 'reset' }, { kind: 'zoom', direction: 'out' }]);
  });
});
