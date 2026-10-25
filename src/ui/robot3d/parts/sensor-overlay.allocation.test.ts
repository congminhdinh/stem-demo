import { GCProfiler, getHeapStatistics } from 'node:v8';
import { Sprite } from 'three';
import { describe, expect, it } from 'vitest';
import { fullGc } from '../../../core/program/__fixtures__/allocation';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { placeLabel, type LabelPlace } from '../sensor-label-boxes';
import type { DistanceLabel } from './distance-label';
import { createSensorOverlay } from './sensor-overlay';
import type { ScreenBox } from './zone-tag-layout';

// N18 R4.3: the overlay makes no object in a frame. It runs on every frame of a run, 60 a second beside the robot's own update, so what it
// allocated would be garbage the main thread collects while it draws (as P1 holds the interpreter's read path to). Its geometry and its
// materials are made once; `update` writes vertices, moves and shows and hides what exists. What is left is the heap numbers V8 makes
// where a double is passed to a function it does not inline: no object, array or closure (a `const [a, b] = [x, y]` in a frame callback
// is one: it made 100 bytes an update here until the sampling heap profiler, node:inspector's HeapProfiler.startSampling, found it).
// Measured about 60 bytes an update with everything changing, the loop's own garbage included (31 of it). The heap is measured over 20 000 updates after
// 2 000 of warm-up (the JIT's), with readings that change on every one, the distance tag's pace and its settling included (the tag is
// a stand-in that counts what it is told to paint: its canvas needs a document, and the canvas painter costs a few `drawImage` calls),
// and the placing of the tag the frame callback does (`placeLabel`): a generous bound, which survives other workers and the JIT.

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

/** What `work` allocated over `times` calls, in bytes a call: what the used heap grew by plus what every collection in between freed. */
function bytesPerCall(work: (i: number) => void, times: number, warmup = 2000): number {
  for (let i = 0; i < warmup; i++) work(i);
  gc!();
  const profiler = new GCProfiler();
  const before = getHeapStatistics().used_heap_size;
  profiler.start();
  for (let i = 0; i < times; i++) work(i);
  const { statistics } = profiler.stop();
  const after = getHeapStatistics().used_heap_size;
  return (after - before + statistics.reduce((freed, collection) => freed + collection.beforeGC.heapStatistics.usedHeapSize - collection.afterGC.heapStatistics.usedHeapSize, 0)) / times;
}

describe('the heap the sensor overlay allocates per frame (N18 R4.3)', () => {
  if (!gc) {
    it.skip('skipped: this Node exposes no gc(), so the heap cannot be measured.', () => {});
    return;
  }

  it('at most 96 bytes an update (about 60 measured), with every reading changing, the tag held back and settled, and the tag’s spot chosen', () => {
    let paints = 0;
    const label: DistanceLabel = { sprite: new Sprite(), widthShare: 0.5, show: () => void (paints += 1), showNoEcho: () => void (paints += 1), dispose: () => void 0 };
    const overlay = createSensorOverlay({ kit, model, scenario, decimal: ',', unit: 'cm', noEchoText: 'không thấy vật', fovDeg: 40, detail: 'high', makeLabel: () => label });
    const set = worlds(997);
    // The pulse and the clock of each frame, as objects made before the measure: a number computed in the loop and passed to a function V8
    // does not inline is boxed by the caller (16 bytes), which is the test's own garbage, not the overlay's. (In the app the clock's is
    // a number already made, and `pulseLevel`'s is the one box a frame makes.)
    const frames = Array.from({ length: 22_000 }, (_, i) => ({ pulse: (i % 10) / 10, time: i / 60 }));
    const anchors = new Float64Array(8);
    const place: LabelPlace = { reach: 0, center: 0, clear: false };
    const out: ScreenBox = { left: 0, right: 0, bottom: 0, top: 0 };
    const avoid: ScreenBox[] = [
      { left: -1, right: 1, bottom: 0.84, top: 1 },
      { left: -1, right: -0.1, bottom: 0.5, top: 1 },
      { left: -1, right: 0.2, bottom: -1, top: -0.6 },
    ];
    const bytes = bytesPerCall((i) => {
      // 60 frames a second; the loop settles (the tail) every 7th frame.
      const frame = frames[i]!;
      overlay.update(set[i % set.length]!, true, frame.pulse, frame.time);
      if (i % 7 === 0) overlay.flushLabels();
      for (let a = 0; a < 4; a++) {
        anchors[2 * a] = ((i + a) % 20) / 10 - 1;
        anchors[2 * a + 1] = ((i * 3 + a) % 20) / 10 - 1;
      }
      placeLabel(out, place, anchors, 4, 0.3, 0.1, avoid, 3);
    }, 20_000, 2000);
    expect(paints).toBeGreaterThan(1000);
    expect(bytes).toBeLessThanOrEqual(96);
    overlay.dispose();
  }, 60_000);
});
