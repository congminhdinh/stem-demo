// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { productionProfiles } from '../../core/profiles';
import { createProjectStore } from '../state/project-store';
import { attachRobotTestTarget, installTestHooks, type RobotTestTarget } from './test-hooks';

// N18 R4.2: window.__stem.robot serves the mounted robot lab's run: its snapshot and hash, and the speed its frames drive the run at.

afterEach(() => {
  delete window.__stem;
});

function target(): RobotTestTarget & { speed: number; chain: string[] } {
  return {
    speed: 1,
    chain: [],
    setLowTierChain(mode) {
      this.chain.push(mode);
    },
    forceLowTierStep(step) {
      this.chain.push(`force ${step}`);
    },
    getSnapshot: () => ({ t: 1.5 }),
    snapshotHash: () => '0adb8d09',
    setSpeed(multiplier) {
      this.speed = multiplier;
    },
    getSpeed() {
      return this.speed;
    },
  };
}

describe('window.__stem.robot with a robot lab (N18 R4.2)', () => {
  it('reads the lab’s snapshot and hash and sets its speed while the lab is mounted, and nothing once it goes', () => {
    installTestHooks(createProjectStore(createNewProject('p')), productionProfiles);
    const robot = window.__stem!.robot;
    const lab = target();
    const detach = attachRobotTestTarget(lab);
    expect(robot.getSnapshot()).toEqual({ t: 1.5 });
    expect(robot.snapshotHash()).toBe('0adb8d09');
    robot.setSpeed(4);
    expect(lab.speed).toBe(4);
    expect(robot.getSpeed()).toBe(4);
    expect(() => robot.setSpeed(-1)).toThrow(RangeError);
    expect(lab.speed).toBe(4);
    detach();
    expect(robot.getSnapshot()).toBeNull();
    expect(robot.snapshotHash()).toBeNull();
  });

  it('a lab that went does not detach the one that replaced it', () => {
    installTestHooks(createProjectStore(createNewProject('p')), productionProfiles);
    const first = attachRobotTestTarget(target());
    const second = target();
    const detachSecond = attachRobotTestTarget(second);
    first();
    expect(window.__stem!.robot.snapshotHash()).toBe('0adb8d09');
    detachSecond();
  });
});

describe('window.__stem.robot and the low tier’s chain (N18 P2 fix round 1)', () => {
  it('pins the chain in the mounted lab and in every lab mounted after it, forces a step in the mounted one, and refuses what is none', () => {
    installTestHooks(createProjectStore(createNewProject('p')), productionProfiles);
    const robot = window.__stem!.robot;
    expect(() => robot.forceLowTierStep('cap')).toThrow('No robot lab is mounted.');
    robot.setLowTierChain('off');
    const first = target();
    const detachFirst = attachRobotTestTarget(first);
    expect(first.chain).toEqual(['off']);
    robot.forceLowTierStep('cap');
    robot.forceLowTierStep('offer');
    expect(first.chain).toEqual(['off', 'force cap', 'force offer']);
    detachFirst();
    const second = target();
    const detachSecond = attachRobotTestTarget(second);
    expect(second.chain).toEqual(['off']);
    robot.setLowTierChain('auto');
    expect(second.chain).toEqual(['off', 'auto']);
    expect(() => robot.setLowTierChain('never' as 'off')).toThrow(RangeError);
    detachSecond();
    // 'auto' is the default: a lab mounted now is told nothing.
    const third = target();
    attachRobotTestTarget(third)();
    expect(third.chain).toEqual([]);
  });
});
