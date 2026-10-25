import { GCProfiler, getHeapStatistics } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { fullGc } from '../../../core/program/__fixtures__/allocation';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { createSensorOverlay } from './sensor-overlay';

// N18 R4.3: the overlay makes no object in a frame. It runs on every frame of a run, 60 a second beside the robot's own update, so what it
// allocated would be garbage the main thread collects while it draws (as P1 holds the interpreter's read path to). Its geometry and its
// materials are made once; `update` moves, scales, shows and hides what exists. What is left is the heap numbers V8 makes where a double
// is passed to a function it does not inline (measured: 31.6 bytes an update with every reading changing, before the pose was written as
// a matrix instead of through `writePose`, 120). The heap is measured over 20 000 updates after 2 000 of warm-up (the JIT's): a generous
// bound, which survives other workers and the JIT.

const gc = fullGc();
const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
const scenario = scenarioCatalog.get('rb-line-follow')!;
const idle = idleSnapshot(scenario, kit);

/** Worlds that differ on every update: the robot turns and drives, every reading and every spot moves, the colours alternate. */
function worlds(count: number): RobotSnapshot[] {
  return Array.from({ length: count }, (_, i) => {
    const yaw = (i * 7) % 360;
    const half = (yaw * Math.PI) / 360;
    const robot: Pose = { xCm: 30 + (i % 90), yCm: 20 + (i % 60), zCm: 0.1, yawDeg: yaw, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
    const sensors: SensorReadout[] = [
      { role: 'ultrasonic', kind: 'ultrasonic', cm: 5 + (i % 380) + (i % 10) / 10, hitId: i % 9 === 0 ? null : 'wall' },
      { role: 'lineLeft', kind: 'line-sensor', reflectance: i % 2, dark: i % 2 === 0, spotCm: [robot.xCm + 7, robot.yCm + 1.5] },
      { role: 'lineCenter', kind: 'line-sensor', reflectance: 1, dark: i % 3 === 0, spotCm: i % 11 === 0 ? null : [robot.xCm + 7, robot.yCm] },
      { role: 'lineRight', kind: 'line-sensor', reflectance: 0, dark: i % 5 === 0, spotCm: [robot.xCm + 7, robot.yCm - 1.5] },
    ];
    return { ...idle, t: i / 120, status: 'running', robot: { ...idle.robot, ...robot }, sensors, score: { points: 0, maxScore: 100, goals: i % 400 < 200 ? [] : [{ id: 'reach-garage', passed: true, points: 60, progress: 1 }] } };
  });
}

describe('the heap the sensor overlay allocates per frame (N18 R4.3)', () => {
  if (!gc) {
    it.skip('skipped: this Node exposes no gc(), so the heap cannot be measured.', () => {});
    return;
  }

  it('at most 64 bytes an update, with every reading changing', () => {
    const overlay = createSensorOverlay({ kit, model, scenario, decimal: ',', fovDeg: 40, makeLabel: () => null });
    const set = worlds(997);
    for (let i = 0; i < 2000; i++) overlay.update(set[i % set.length]!, true, (i % 10) / 10);
    gc();
    const profiler = new GCProfiler();
    const before = getHeapStatistics().used_heap_size;
    profiler.start();
    const updates = 20_000;
    for (let i = 0; i < updates; i++) overlay.update(set[i % set.length]!, true, (i % 10) / 10);
    const { statistics } = profiler.stop();
    const after = getHeapStatistics().used_heap_size;
    const bytes = after - before + statistics.reduce((freed, collection) => freed + collection.beforeGC.heapStatistics.usedHeapSize - collection.afterGC.heapStatistics.usedHeapSize, 0);
    expect(bytes / updates).toBeLessThanOrEqual(64);
    overlay.dispose();
  }, 60_000);
});
