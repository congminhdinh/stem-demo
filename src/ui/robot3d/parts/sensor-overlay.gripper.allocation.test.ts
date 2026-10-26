import { GCProfiler, getHeapStatistics } from 'node:v8';
import { Sprite } from 'three';
import { describe, expect, it } from 'vitest';
import { COLOR_NAMES, type ColorName } from '../../../core/hardware/drivers';
import { fullGc } from '../../../core/program/__fixtures__/allocation';
import { unoR3Board } from '../../../core/hardware/catalog';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { gripperKit, gripperTestScenario } from '../__fixtures__/gripper-scene';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { placeLabel, type LabelPlace } from '../sensor-label-boxes';
import type { DistanceLabel } from './distance-label';
import { createSensorOverlay, type GripperWords } from './sensor-overlay';
import type { WordsLabel } from './words-label';
import type { ScreenBox } from './zone-tag-layout';

// N19 E5: the gripper car's overlays make no object in a frame either (N18 R4.3, sensor-overlay.allocation.test.ts for the rover, whose
// method this is): the carriage's pose is written into a pose made once, the IR beam and the colour spot are repainted in place when their
// reading changes, the colour is classified again only when the counts change, and the tag is painted from words made once when they
// change. Measured over 20 000 updates after 2 000 of warm-up, with every reading changing on every one (the arm moving, the IR seeing on
// and off, the colour ray's reach, new counts of another colour, the tags placed), the bound the rover's test holds: 96 bytes an update
// (65.5 to 67.9 measured, Apple M4 Pro, Node 24, load 9 to 15; the rover's own is about 60; with a goal placed by colour whose round's
// colours change, 63.9 to 65.9 at load 6 to 9: the zone of such a goal is cached by colour, nextGoalZoneId's placedZone). Before E5's fixes it was 722: classifyColor's
// object and destructuring (1.5 KB a call, color-rules.allocation.test.ts), gripper-pose.ts's pose object (265 bytes a call) and the
// repaint's doubles passed as numbers (48 bytes).

const gc = fullGc();
const model = robotModel(gripperKit, unoR3Board);
const idle = idleSnapshot(gripperTestScenario, gripperKit);
// N19 E4/E5 (concern 3): a goal placed by colour, so that every update asks `nextGoalZoneId` its zone for the round's colours, which change.
const sortGoal = { id: 'sort', kind: 'object-placed', label: { vi: 'x', en: 'x' }, points: 10, object: 'cube-red', fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5, zoneByColor: { '#d32f2f': 'red-zone', '#1976d2': 'blue-zone' } };
const scenario = { ...gripperTestScenario, goals: [sortGoal] } as unknown as typeof gripperTestScenario;
const rounds = [{ 'cube-red': '#d32f2f' }, { 'cube-red': '#1976d2' }];
const counts = [
  { r: 14_000, g: 3000, b: 2800, c: 19_800 },
  { r: 3000, g: 5000, b: 13_000, c: 21_000 },
  { r: 3000, g: 13_000, b: 5000, c: 21_000 },
  { r: 100, g: 100, b: 50, c: 250 },
];

/** Worlds that differ on every update. */
function worlds(count: number): RobotSnapshot[] {
  return Array.from({ length: count }, (_, i) => {
    const yaw = (i * 7) % 360;
    const half = (yaw * Math.PI) / 360;
    const robot: Pose = { xCm: 30 + (i % 50), yCm: 20 + (i % 40), zCm: 0.1, yawDeg: yaw, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
    const sensors: SensorReadout[] = [
      { role: 'ultrasonic', kind: 'ultrasonic', cm: 3 + (i % 300) + (i % 10) / 10, hitId: i % 9 === 0 ? null : 'wall' },
      { role: 'lineLeft', kind: 'line-sensor', reflectance: i % 2, dark: i % 2 === 0, spotCm: [robot.xCm + 7, robot.yCm + 1.5] },
      { role: 'lineCenter', kind: 'line-sensor', reflectance: 1, dark: i % 3 === 0, spotCm: [robot.xCm + 7, robot.yCm] },
      { role: 'lineRight', kind: 'line-sensor', reflectance: 0, dark: i % 5 === 0, spotCm: [robot.xCm + 7, robot.yCm - 1.5] },
      { role: 'irClaw', kind: 'ir-obstacle', detected: i % 2 === 0, hitId: i % 2 === 0 ? 'cube' : null },
      { role: 'color1', kind: 'color-sensor', hitId: i % 3 === 0 ? null : 'cube', distanceCm: i % 3 === 0 ? null : 0.5 + (i % 30) / 10, ...(i % 7 === 0 ? {} : { rgbc: counts[i % counts.length]! }) },
    ];
    return { ...idle, t: i / 120, status: 'running', robot: { ...idle.robot, ...robot, gripper: { clawDeg: i % 80, liftDeg: (i * 3) % 90, heldId: i % 4 === 0 ? 'cube-red' : null } }, sensors };
  });
}

/** What `work` allocated over `times` calls, in bytes a call (sensor-overlay.allocation.test.ts's measure). */
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

describe('the heap the gripper car’s overlays allocate per frame (N19 E5)', () => {
  if (!gc) {
    it.skip('skipped: this Node exposes no gc(), so the heap cannot be measured.', () => {});
    return;
  }

  it('at most 96 bytes an update, with every reading changing, both tags painted when their words change and placed', () => {
    let paints = 0;
    const distance: DistanceLabel = { sprite: new Sprite(), widthShare: 0.5, show: () => void (paints += 1), showNoEcho: () => void (paints += 1), dispose: () => void 0 };
    let wordsPaints = 0;
    const label: WordsLabel = { sprite: new Sprite(), widthShare: 0.4, heightShare: 0.8, show: () => void (wordsPaints += 1), dispose: () => void 0 };
    const words: GripperWords = { irSeen: 'IR: có vật', irClear: 'IR: không', color: Object.fromEntries(COLOR_NAMES.map((name) => [name, `Màu: ${name}`])) as Record<ColorName, string>, noReading: 'Màu: chưa có số đọc' };
    const overlay = createSensorOverlay({ kit: gripperKit, model, scenario, decimal: ',', unit: 'cm', noEchoText: 'không thấy vật', fovDeg: 40, detail: 'high', makeLabel: () => distance, gripperWords: words, makeWordsLabel: () => label });
    const set = worlds(997);
    const frames = Array.from({ length: 22_000 }, (_, i) => ({ pulse: (i % 10) / 10, time: i / 60 }));
    const anchors = new Float64Array(8);
    const place: LabelPlace = { reach: 0, center: 0, clear: false };
    const out: ScreenBox = { left: 0, right: 0, bottom: 0, top: 0 };
    const avoid: ScreenBox[] = [
      { left: -1, right: 1, bottom: 0.84, top: 1 },
      { left: -1, right: -0.1, bottom: 0.5, top: 1 },
      { left: -1, right: 0.2, bottom: -1, top: -0.6 },
      { left: 0, right: 0.1, bottom: 0, top: 0.1 },
    ];
    const bytes = bytesPerCall((i) => {
      const frame = frames[i]!;
      if (i % 50 === 0) overlay.setRoundColors(rounds[(i / 50) % 2]!);
      overlay.update(set[i % set.length]!, true, frame.pulse, frame.time);
      if (i % 7 === 0) overlay.flushLabels();
      // Both tags placed, as the frame callback does (SensorOverlay.tsx).
      for (let tag = 0; tag < 2; tag++) {
        for (let a = 0; a < 4; a++) {
          anchors[2 * a] = ((i + a + tag) % 20) / 10 - 1;
          anchors[2 * a + 1] = ((i * 3 + a) % 20) / 10 - 1;
        }
        placeLabel(out, place, anchors, tag === 0 ? 4 : 3, 0.3, 0.1, avoid, 3 + tag);
      }
    }, 20_000, 2000);
    expect(paints).toBeGreaterThan(1000);
    expect(wordsPaints).toBeGreaterThan(1000);
    expect(overlay.gripperLabelShown()).toBe(true);
    // The last colours told were round 2's (blue): the goal placed by colour lights the blue zone.
    expect(overlay.probe().zone).toBe('blue-zone');
    expect(bytes).toBeLessThanOrEqual(96);
    overlay.dispose();
  }, 60_000);
});
