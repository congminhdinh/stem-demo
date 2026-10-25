import { describe, expect, it } from 'vitest';
import { productionKits, referenceKitRef, type Kit } from '../hardware';
import { sandboxScenario } from '../run/__fixtures__/robot-session';
import { checkPlacement } from './placement';

// N18 R4.8: where the learner may put the robot before a Run ("Di chuyển robot"): inside the arena, its heading in (-180°, 180°], and on
// nothing (the same check a scenario's start passes, footprint.ts).

const rover = productionKits.get(referenceKitRef) as Kit;
// The rover seen from above, at yaw 0: its outline spans x -7.5..7.5 (the body) and y -8.8..8.8 (the wheels).
const open = sandboxScenario({ sizeCm: [300, 150] }).arena;
const walled = sandboxScenario({ sizeCm: [300, 150], wallAtCm: 100 }).arena;

describe('checkPlacement', () => {
  it('keeps a pose that is clear and inside, its heading turned into (-180°, 180°]', () => {
    expect(checkPlacement(open, rover, { xCm: 120, yCm: 60, yawDeg: 30 })).toEqual({ pose: { xCm: 120, yCm: 60, yawDeg: 30 }, issues: [] });
    expect(checkPlacement(open, rover, { xCm: 120, yCm: 60, yawDeg: 370 }).pose.yawDeg).toBe(10);
    expect(checkPlacement(open, rover, { xCm: 120, yCm: 60, yawDeg: -190 }).pose.yawDeg).toBe(170);
    expect(checkPlacement(open, rover, { xCm: 120, yCm: 60, yawDeg: -180 }).pose.yawDeg).toBe(180);
    expect(checkPlacement(open, rover, { xCm: 120, yCm: 60, yawDeg: 540 }).pose.yawDeg).toBe(180);
    expect(checkPlacement(open, rover, { xCm: 120, yCm: 60, yawDeg: -0 }).pose.yawDeg).toBe(0);
  });

  it('moves a pose that sticks out of the arena back in, just far enough for the whole outline at its heading', () => {
    expect(checkPlacement(open, rover, { xCm: -20, yCm: -5, yawDeg: 0 }).pose).toEqual({ xCm: 7.5, yCm: 8.8, yawDeg: 0 });
    expect(checkPlacement(open, rover, { xCm: 400, yCm: 200, yawDeg: 0 }).pose).toEqual({ xCm: 292.5, yCm: 141.2, yawDeg: 0 });
    // Turned a quarter, the wheels span x and the body y.
    const turned = checkPlacement(open, rover, { xCm: 0, yCm: 0, yawDeg: 90 }).pose;
    expect(turned.xCm).toBeCloseTo(8.8, 9);
    expect(turned.yCm).toBeCloseTo(7.5, 9);
    expect(turned.yawDeg).toBe(90);
    // Already inside: not moved.
    expect(checkPlacement(open, rover, { xCm: 7.5, yCm: 8.8, yawDeg: 0 }).pose).toEqual({ xCm: 7.5, yCm: 8.8, yawDeg: 0 });
  });

  it('says what the robot would stand in, as the scenario’s start check does; clear away from it', () => {
    const blocked = checkPlacement(walled, rover, { xCm: 100, yCm: 75, yawDeg: 0 });
    expect(blocked.pose).toEqual({ xCm: 100, yCm: 75, yawDeg: 0 });
    expect(blocked.issues.length).toBe(1);
    expect(blocked.issues[0]!.path).toBe('start');
    expect(blocked.issues[0]!.message).toContain('overlap walls[0] (wall)');
    expect(checkPlacement(walled, rover, { xCm: 60, yCm: 75, yawDeg: 0 }).issues).toEqual([]);
  });

  it('refuses a pose that is not numbers', () => {
    expect(() => checkPlacement(open, rover, { xCm: Number.NaN, yCm: 60, yawDeg: 0 })).toThrow('A robot pose is finite numbers of cm and degrees.');
    expect(() => checkPlacement(open, rover, { xCm: 10, yCm: 60, yawDeg: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});
