import { describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { idleSnapshot } from './scene-math';
import { createShadowWatch } from './shadow-watch';

// N18 P2: the key light's shadow map is drawn again when what casts a shadow moves or the scene changes, not for a frame where only the
// camera moved or an LED blinked; never left behind a robot that crept away a little at a time.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const base = idleSnapshot(scenarioCatalog.get('rb-servo-gate')!, kit);
const moved = (changes: Partial<RobotSnapshot['robot']>): RobotSnapshot => ({ ...base, robot: { ...base.robot, ...changes } });

describe('the shadow map’s redraws (N18 P2)', () => {
  it('draws on the first frame, then not for the same world, a new object of the same poses, an LED, a pin or another time', () => {
    const watch = createShadowWatch();
    expect(watch.frame(base)).toBe(true);
    expect(watch.frame(base)).toBe(false);
    expect(watch.frame({ ...base, t: 2, leds: { led1: true }, pins: base.pins.map((pin) => ({ ...pin, level: 1 as const })) })).toBe(false);
  });

  it('draws when the robot moves or turns, a wheel turns, the servo turns or a moving body moves', () => {
    for (const next of [
      moved({ xCm: base.robot.xCm + 0.02 }),
      moved({ rotation: { x: 0, y: 0, z: 0.01, w: 1 } }),
      moved({ wheelRad: [0.002, 0] }),
      moved({ servoDeg: { servo1: 0.06 } }),
      { ...base, objects: [{ id: 'crate', kind: 'object' as const, pose: { xCm: 60, yCm: 40, zCm: 2, yawDeg: 0, rotation: { x: 0, y: 0, z: 0, w: 1 } } }] },
    ]) {
      const watch = createShadowWatch();
      watch.frame(base);
      expect(watch.frame(next)).toBe(true);
      expect(watch.frame(next)).toBe(false);
    }
  });

  it('draws once a robot creeping by less than a pixel a frame has gone a pixel from where the map was drawn', () => {
    const watch = createShadowWatch();
    watch.frame(base);
    const steps = [0.002, 0.004, 0.006, 0.008, 0.012].map((dx) => watch.frame(moved({ xCm: base.robot.xCm + dx })));
    expect(steps).toEqual([false, false, false, false, true]);
  });

  it('draws on the next frame after the scene changed, once', () => {
    const watch = createShadowWatch();
    watch.frame(base);
    watch.changed();
    expect(watch.frame(base)).toBe(true);
    expect(watch.frame(base)).toBe(false);
  });
});
