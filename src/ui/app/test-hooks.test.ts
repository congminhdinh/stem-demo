// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { productionProfiles } from '../../core/profiles';
import { createProjectStore } from '../state/project-store';
import { installTestHooks } from './test-hooks';

// The dev-only hooks the E2E reads (plan §11.4), and, since N18 R4.1, the robot lab's: window.__stem.robot.

afterEach(() => {
  delete window.__stem;
});

const install = () => {
  installTestHooks(createProjectStore(createNewProject('p')), productionProfiles);
  const robot = window.__stem?.robot;
  if (!robot) {
    throw new Error('window.__stem.robot is not installed');
  }
  return robot;
};

describe('window.__stem.robot (N18 R4.1)', () => {
  it('has getSnapshot, setSpeed and snapshotHash, beside the hooks of the editor', () => {
    install();
    expect(Object.keys(window.__stem ?? {}).sort()).toEqual(['getCanvasState', 'getProgramBlocks', 'getProject', 'loadProject', 'robot']);
    expect(Object.keys(window.__stem?.robot ?? {}).sort()).toEqual(['getSnapshot', 'getSpeed', 'setSpeed', 'snapshotHash']);
  });

  it('getSnapshot is null until a run exists, and so is snapshotHash (R3.6 and R4.2 fill them)', () => {
    const robot = install();
    expect(robot.getSnapshot()).toBeNull();
    expect(robot.snapshotHash()).toBeNull();
  });

  it('setSpeed stores the speed, which is 1 until it is set', () => {
    const robot = install();
    expect(robot.getSpeed()).toBe(1);
    robot.setSpeed(4);
    expect(robot.getSpeed()).toBe(4);
    robot.setSpeed(0.5);
    expect(robot.getSpeed()).toBe(0.5);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('setSpeed(%s) is refused and keeps the speed', (speed) => {
    const robot = install();
    robot.setSpeed(2);
    expect(() => robot.setSpeed(speed)).toThrow(RangeError);
    expect(robot.getSpeed()).toBe(2);
  });

  it('a new install starts again: speed 1, nothing run', () => {
    install().setSpeed(8);
    expect(install().getSpeed()).toBe(1);
  });
});
