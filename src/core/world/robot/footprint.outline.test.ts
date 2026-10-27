import { describe, expect, it } from 'vitest';
import { productionKits } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { robotOutlineCm } from '../../scenario/placement';
import { robotFootprint, robotOutline } from './footprint';

// N19 E9 (hand-over from B5/B6 M4): the lab asks for the robot's outline when it opens (the tools' ghost, the floor picker), and the outline
// is the hull of the body and the wheels: it needs none of the gripper's 7 189 samples (13.9 ms on an M4 Pro, 55 to 64 ms on the bench's
// school profile, CPU 6x: a long task before first paint). `robotOutline` is the outline alone, the same array the footprint carries.

const gripper = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const rover = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const kits = [rover, gripper];

/** The median of the milliseconds `work` takes on a kit nobody has asked for yet (a copy: every cache is keyed by the kit object). */
function coldMs(kit: Kit, work: (copy: Kit) => unknown): number {
  const times = Array.from({ length: 5 }, () => {
    const copy = structuredClone(kit);
    const start = performance.now();
    work(copy);
    return performance.now() - start;
  });
  return times.sort((a, b) => a - b)[2]!;
}

describe('the robot’s outline without the footprint’s sweeps (N19 E9)', () => {
  it('is, for both production kits, the very array of the footprint’s outline, in either order of asking', () => {
    for (const kit of kits) {
      // The outline asked for first, then the footprint: the footprint carries the array already made.
      const first = robotOutline(kit);
      expect(robotFootprint(kit).outlineCm).toBe(first);
      expect(robotOutline(kit)).toBe(first);
      // The footprint asked for first, on a copy.
      const copy = structuredClone(kit);
      const whole = robotFootprint(copy).outlineCm;
      expect(robotOutline(copy)).toBe(whole);
      expect(whole).toEqual(first);
    }
  });

  it('is the gripper car’s body and wheels, as the rover’s: the arm and the claw ride above the floor', () => {
    expect(robotOutline(gripper)).toEqual(robotOutline(rover));
    expect(robotOutlineCm(gripper)).toBe(robotOutline(gripper));
    expect(robotOutlineCm(gripper)).toEqual([
      [-7.5, -6],
      [-5.3, -8.8],
      [1.3, -8.8],
      [7.5, -6],
      [7.5, 6],
      [1.3, 8.8],
      [-5.3, 8.8],
      [-7.5, 6],
    ].map(([x, y]) => [expect.closeTo(x!, 9), expect.closeTo(y!, 9)]));
  });

  it('takes a fraction of the footprint’s time on the gripper kit, and as long as it on the rover’s, which has no sweep', () => {
    // Both warmed on copies first: the JIT warms the sweep's code, and the one measured first would otherwise pay for it.
    for (let i = 0; i < 3; i++) {
      robotOutlineCm(structuredClone(gripper));
      robotFootprint(structuredClone(gripper));
    }
    const outline = coldMs(gripper, (copy) => robotOutlineCm(copy));
    const whole = coldMs(gripper, (copy) => robotFootprint(copy));
    // The sweep is most of the footprint's time: a fifth is a wide bound for a loaded machine, and fails an outline that sweeps.
    expect(outline * 5, `outline ${outline.toFixed(2)} ms, footprint ${whole.toFixed(2)} ms`).toBeLessThan(whole);
  });
});
