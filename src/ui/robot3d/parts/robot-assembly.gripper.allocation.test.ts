import { GCProfiler, getHeapStatistics } from 'node:v8';
import { Texture } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import { fullGc } from '../../../core/program/__fixtures__/allocation';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { createGripperPose, gripperPoseInto } from '../gripper-pose';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { assembleRobot, gripperReferenceSizes, poseGripper, referenceSizes, type AssemblyOptions } from './robot-assembly';

// N19 E9 (hand-over from E4/E5, concern 2): the view poses the gripper in every drawn frame (parts/robot-assembly.ts `poseGripper`, and
// RobotView.tsx for the fallback scene), so it makes no object in a frame either (the method of sensor-overlay.gripper.allocation.test.ts):
// measured over 20 000 poses.
//   - gripper-pose.ts's `gripperPoseInto` made 33 bytes a call once the JIT had optimised it: the array destructuring
//     `const [px, py, pz] = gripper.position` takes the array's iterator. Read by index, it makes none (0.5 to 1.8 measured, Apple M4 Pro,
//     Node 24, load 5 to 12; the harness's own floor is 1.1). Three's own `position.set`, `rotation.z` and a Float64 store allocate nothing
//     (0.04 to 0.34 bytes a call, measured in the same run).
//   - A frame with the claw and the arm where the last one left them does nothing (`posedFor`; robot-assembly.gripper.rest.test.ts): at rest,
//     which is most frames of a run, the pose makes no arithmetic, so no object whatever tier of the JIT runs it. In the interpreter's first
//     calls a pose made 150 to 265 bytes (it boxes every double it computes). The heap test of the rest case measures the optimised code
//     (a cold pass counts the code V8 allocates to tier up, 8 to 69 bytes a call on a loaded machine), so it is a guard, and the test that
//     the nodes are not written is the proof.
//   - A frame that moves the arm still computes the pose and sets the nodes: whether V8 inlines three's setters decides if their double
//     arguments are boxed (16 bytes each), and it decided differently from one run to the next (1, 16 or 32 bytes a call under load). So that
//     case is bounded as the overlay's is, at 96 bytes a call.

const gc = fullGc();
const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const reference = referenceSizes(robotModel(roverKit, unoR3Board));
const model = robotModel(gripperKit, unoR3Board);
const gripperReference = gripperReferenceSizes(model)!;
const idle = idleSnapshot(scenarioCatalog.get('rb-line-follow')!, gripperKit);

/** Worlds whose claw and arm differ on every pose, and whose status flips (the colour sensor's LED follows it). */
const worlds: RobotSnapshot[] = Array.from({ length: 997 }, (_, i) => ({
  ...idle,
  status: i % 2 === 0 ? 'running' : 'idle',
  robot: { ...idle.robot, gripper: { clawDeg: (i * 7) % 81, liftDeg: (i * 3) % 91, heldId: null } },
}));
const options = (detail: 'high' | 'low'): AssemblyOptions => ({ detail, shadows: detail === 'high', flag: null, boardLedPin: 13, blob: new Texture(), gripperReference });

/** What `work` allocated over `times` calls, in bytes a call (sensor-overlay.gripper.allocation.test.ts's measure). */
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

/**
 * The least of three passes: what else the worker allocates meanwhile (the runner's messages, more of them on a loaded machine) only adds.
 * The first pass warms up 50 000 calls, not 2 000: V8 optimises on a background thread, and on a loaded machine the pass would still be
 * running the interpreter's boxed doubles (13 to 16 bytes a call measured at 2 000, 33 to 65 before that).
 */
const least = (work: (i: number) => void) => Math.min(bytesPerCall(work, 20_000, 50_000), bytesPerCall(work, 20_000, 0), bytesPerCall(work, 20_000, 0));

let assets: Record<'high' | 'low', RobotAssets>;
beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});

describe('the heap the gripper car’s pose allocates per drawn frame (N19 E9)', () => {
  if (!gc) {
    it.skip('skipped: this Node exposes no gc(), so the heap cannot be measured.', () => {});
    return;
  }

  // 8 bytes a call: one boxed double (16 bytes) a call fails it, and so does the destructuring's 33.
  it('gripperPoseInto allocates at most 8 bytes a call, the claw and the arm moving on every one', () => {
    const pose = createGripperPose();
    const bytes = least((i) => void gripperPoseInto(pose, model.gripper!, worlds[i % worlds.length]!.robot.gripper!));
    expect(bytes).toBeLessThanOrEqual(8);
  }, 60_000);

  for (const detail of ['high', 'low'] as const) {
    it(`poseGripper allocates at most 8 bytes a call while the claw and the arm stay, with the LED flipping (${detail})`, () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      // The same claw and arm in every world; the status (and with it the LED) flips.
      const still = worlds.map((world, i): RobotSnapshot => ({ ...world, robot: { ...world.robot, gripper: { clawDeg: 35, liftDeg: 45, heldId: null } }, status: i % 2 === 0 ? 'running' : 'idle' }));
      expect(least((i) => poseGripper(handles, still[i % still.length]!))).toBeLessThanOrEqual(8);
      robot.dispose();
    }, 60_000);

    it(`poseGripper allocates at most 96 bytes a call with the claw and the arm moving on every frame (${detail})`, () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      const bytes = least((i) => poseGripper(handles, worlds[i % worlds.length]!));
      expect(bytes).toBeLessThanOrEqual(96);
      robot.dispose();
    }, 60_000);
  }
});
