// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { robotOutlineCm } from '../../core/scenario/placement';
import { driveKeyOf, dragPose, isTypingTarget, measure, onRobot, robotToArena, rulerTargets, sensorBarCm, snapPoint, SNAP_CM, TURN_STEP_DEG } from './robot-tools';

// N18 R4.8: the arithmetic of the 3D view's tools: where the ruler's points snap, what it reads (cm, and the angle to the robot's heading),
// whether a press is on the robot (the move tool grabs it), where a drag puts it, and which keys drive it by hand.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const outline = robotOutlineCm(kit);

describe('the ruler (N18 R4.8)', () => {
  it('finds the sensor bar in the middle of the kit’s line sensors (robot frame), and puts robot points on the arena at a pose', () => {
    expect(sensorBarCm(kit)).toEqual([7, 0]);
    expect(sensorBarCm({ ...kit, modules: kit.modules.filter((module) => module.kind !== 'line-sensor') } as Kit)).toBeNull();
    expect(robotToArena({ xCm: 40, yCm: 50, yawDeg: 0 }, [7, 0])).toEqual({ xCm: 47, yCm: 50 });
    const turned = robotToArena({ xCm: 40, yCm: 50, yawDeg: 90 }, [7, 0]);
    expect(turned.xCm).toBeCloseTo(40, 9);
    expect(turned.yCm).toBeCloseTo(57, 9);
  });

  it('snaps a point near the robot’s middle or its sensor bar to it, the nearer one first; leaves one farther than SNAP_CM', () => {
    const targets = rulerTargets({ xCm: 40, yCm: 50, yawDeg: 0 }, [7, 0]);
    expect(targets).toEqual([
      { kind: 'robot', point: { xCm: 40, yCm: 50 } },
      { kind: 'sensors', point: { xCm: 47, yCm: 50 } },
    ]);
    expect(snapPoint({ xCm: 41, yCm: 51 }, targets)).toEqual({ point: { xCm: 40, yCm: 50 }, snap: 'robot' });
    expect(snapPoint({ xCm: 45, yCm: 50 }, targets)).toEqual({ point: { xCm: 47, yCm: 50 }, snap: 'sensors' });
    expect(snapPoint({ xCm: 40 + SNAP_CM + 0.01, yCm: 50 + 10 }, targets)).toEqual({ point: { xCm: 40 + SNAP_CM + 0.01, yCm: 60 }, snap: null });
    expect(rulerTargets({ xCm: 40, yCm: 50, yawDeg: 0 }, null)).toEqual([{ kind: 'robot', point: { xCm: 40, yCm: 50 } }]);
  });

  it('reads the distance in cm and the angle of the segment to the robot’s heading, in (-180°, 180°], left positive', () => {
    expect(measure({ xCm: 0, yCm: 0 }, { xCm: 30, yCm: 40 }, 0)).toEqual({ distanceCm: 50, angleDeg: expect.closeTo(53.1301, 3) });
    expect(measure({ xCm: 10, yCm: 10 }, { xCm: 10, yCm: 30 }, 0)).toEqual({ distanceCm: 20, angleDeg: 90 });
    expect(measure({ xCm: 10, yCm: 10 }, { xCm: 10, yCm: -10 }, 0)).toEqual({ distanceCm: 20, angleDeg: -90 });
    expect(measure({ xCm: 10, yCm: 10 }, { xCm: 10, yCm: 30 }, 90)).toEqual({ distanceCm: 20, angleDeg: 0 });
    expect(measure({ xCm: 10, yCm: 10 }, { xCm: -10, yCm: 10 }, 0)).toEqual({ distanceCm: 20, angleDeg: 180 });
    expect(measure({ xCm: 10, yCm: 10 }, { xCm: 30, yCm: 10 }, -170).angleDeg).toBeCloseTo(170, 9);
    expect(measure({ xCm: 10, yCm: 10 }, { xCm: 30, yCm: 10 }, 170).angleDeg).toBeCloseTo(-170, 9);
    expect(measure({ xCm: 5, yCm: 5 }, { xCm: 5, yCm: 5 }, 30)).toEqual({ distanceCm: 0, angleDeg: 0 });
  });
});

describe('the move tool (N18 R4.8)', () => {
  it('a press is on the robot inside its outline at its pose, with a margin', () => {
    const pose = { xCm: 100, yCm: 50, yawDeg: 0 };
    expect(onRobot({ xCm: 100, yCm: 50 }, pose, outline)).toBe(true);
    expect(onRobot({ xCm: 107, yCm: 58 }, pose, outline)).toBe(true);
    expect(onRobot({ xCm: 109.6, yCm: 50 }, pose, outline)).toBe(false);
    // Turned a quarter, the robot's length lies along y.
    expect(onRobot({ xCm: 100, yCm: 58.5 }, { ...pose, yawDeg: 90 }, outline)).toBe(true);
    expect(onRobot({ xCm: 109, yCm: 50 }, { ...pose, yawDeg: 90 }, outline)).toBe(true);
    expect(onRobot({ xCm: 100, yCm: 62 }, { ...pose, yawDeg: 90 }, outline)).toBe(false);
  });

  it('a drag keeps the point where the robot was grabbed under the pointer, and its heading', () => {
    const pose = { xCm: 100, yCm: 50, yawDeg: 30 };
    expect(dragPose(pose, { xCm: 103, yCm: 48 }, { xCm: 150, yCm: 70 })).toEqual({ xCm: 147, yCm: 72, yawDeg: 30 });
    expect(TURN_STEP_DEG).toBe(15);
  });
});

describe('the keys of teleop (N18 R4.8)', () => {
  it('drives with the arrows and W A S D (by the key’s place, any layout), stops with Space, and takes nothing else', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((key) => driveKeyOf({ key, code: key }))).toEqual(['forward', 'backward', 'spinLeft', 'spinRight']);
    expect(['KeyW', 'KeyS', 'KeyA', 'KeyD'].map((code) => driveKeyOf({ key: code.slice(3).toLowerCase(), code }))).toEqual(['forward', 'backward', 'spinLeft', 'spinRight']);
    // A Vietnamese input method may change the key's text; its place is still W.
    expect(driveKeyOf({ key: 'ư', code: 'KeyW' })).toBe('forward');
    expect(driveKeyOf({ key: 'W', code: '' })).toBe('forward');
    expect(driveKeyOf({ key: ' ', code: 'Space' })).toBe('stop');
    expect(driveKeyOf({ key: 'q', code: 'KeyQ' })).toBeNull();
    expect(driveKeyOf({ key: 'Enter', code: 'Enter' })).toBeNull();
  });

  it('never takes a key typed into a field, a text area, a list, editable text or the block editor', () => {
    const make = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.append(host);
      return host;
    };
    const host = make(`
      <input id="speed" type="range"><input id="name"><textarea id="note"></textarea><select id="pick"></select>
      <div contenteditable="true"><span id="editable">x</span></div>
      <div class="injectionDiv"><svg><g id="block"></g></svg></div>
      <div class="blocklyWidgetDiv"><input id="blockField"></div>
      <button id="pad">↑</button><div id="stage"></div>`);
    const typing = (id: string) => isTypingTarget(host.querySelector(`#${id}`));
    expect(['speed', 'name', 'note', 'pick', 'editable', 'block', 'blockField'].map(typing)).toEqual([true, true, true, true, true, true, true]);
    expect(['pad', 'stage'].map(typing)).toEqual([false, false]);
    expect(isTypingTarget(null)).toBe(false);
    // N18 R4.8 fix round 1: a slider takes only the keys that move it; W A S D and Space drive from it.
    const slider = host.querySelector('#speed');
    expect(['ArrowUp', 'ArrowLeft', 'Home', 'End', 'PageUp'].map((key) => isTypingTarget(slider, key))).toEqual([true, true, true, true, true]);
    expect(['w', 'd', ' ', 'Enter', 'q'].map((key) => isTypingTarget(slider, key))).toEqual([false, false, false, false, false]);
    expect(isTypingTarget(host.querySelector('#name'), 'w')).toBe(true);
    host.remove();
  });
});
