import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import { bodyPalette } from '../../../core/world/arena/body-colors';
import { parseArena, type ArenaInput } from '../../../core/world/arena/arena-schema';
import type { RobotSnapshot, SnapshotObject } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { gripperPose, type GripperState } from '../gripper-pose';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';

// N19 E6/E7 test fixtures (no gripper scenario ships yet, plan D4): a test arena for the gripper car with every pick-and-place prop (a cube
// of each palette colour, a parcel, a yellow base, a warehouse shelf on a `kho-wall`, the named zones), and snapshots of the car at a
// gripper pose, holding the red cube where the world would hold it (centred between the fingers). Used by the unit tests and by the
// e2e gallery page (e2e/robot-gripper-look.html). Plain data: no vitest.

export const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;

const arena: ArenaInput = {
  ground: { sizeCm: [120, 90], color: '#f2f2f2' },
  paint: {
    lines: [{ pointsCm: [[12, 30], [108, 30]], widthCm: 2 }],
    zones: [
      { id: 'start', kind: 'start', polygonCm: [[6, 18], [34, 18], [34, 42], [6, 42]], color: '#cfe2f3' },
      { id: 'pickup', kind: 'area', name: 'pickup', polygonCm: [[44, 12], [76, 12], [76, 48], [44, 48]], color: '#fff2cc' },
      { id: 'red-zone', kind: 'target', name: 'red', polygonCm: [[84, 52], [100, 52], [100, 66], [84, 66]], color: '#f4cccc' },
      { id: 'blue-zone', kind: 'target', name: 'blue', polygonCm: [[102, 52], [116, 52], [116, 66], [102, 66]], color: '#cfe2f3' },
      { id: 'kho', kind: 'target', name: 'warehouse', polygonCm: [[20, 56], [62, 56], [62, 76], [20, 76]], color: '#d9ead3' },
    ],
  },
  walls: [
    { fromCm: [0, 1], toCm: [120, 1] },
    { fromCm: [0, 89], toCm: [120, 89] },
    { fromCm: [1, 0], toCm: [1, 90] },
    { fromCm: [119, 0], toCm: [119, 90] },
    { id: 'shelf', fromCm: [22, 82], toCm: [60, 82], thicknessCm: 4, heightCm: 12, tags: ['kho-wall'] },
  ],
  objects: [
    { id: 'cube-red', shape: 'box', centerCm: [52, 30], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.red },
    { id: 'cube-green', shape: 'box', centerCm: [60, 22], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.green },
    { id: 'cube-blue', shape: 'box', centerCm: [60, 38], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.blue },
    { id: 'cube-yellow', shape: 'box', centerCm: [68, 30], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.yellow },
    { id: 'parcel', shape: 'box', centerCm: [90, 30], sizeCm: [6, 6, 5], massG: 30, noun: 'parcel' },
    { id: 'base', shape: 'box', centerCm: [104, 30], sizeCm: [6, 6, 4], massG: 40, noun: 'base', color: bodyPalette.yellow },
  ],
};

/** A test scenario on the gripper kit: the sandbox's, with the arena above (not a lesson: it is never checked or scored). */
export const gripperTestScenario: Scenario = {
  ...scenarioCatalog.get('rb-sandbox')!,
  kit: 'ref-uno-gripper',
  arena: parseArena(arena),
  start: { xCm: 20, yCm: 30, yawDeg: 0 },
};

const model = robotModel(gripperKit, unoR3Board);

/**
 * The car at its start with the gripper at `state` (robot.gripper, plan §4.4), `status` its run's; holding `held` (an object's id) centred
 * between the fingers 2.5 cm ahead of the carriage, where the world's grasp keeps it, the other objects where the arena puts them.
 */
export function gripperSnapshot(state: GripperState, status: RobotSnapshot['status'] = 'running', scenario: Scenario = gripperTestScenario): RobotSnapshot {
  const idle = idleSnapshot(scenario, gripperKit);
  const pose = gripperPose(model.gripper!, state);
  const yaw = (scenario.start.yawDeg * Math.PI) / 180;
  const objects: SnapshotObject[] = idle.objects.map((object) => {
    if (object.id !== state.heldId) return object;
    // The tip in the robot frame (three: x forward, y up), 2.5 cm on: the arena point of the robot turned by its yaw.
    const forwardCm = (pose.tip[0] + 0.025) * 100;
    const upCm = pose.tip[1] * 100;
    return { ...object, pose: { ...object.pose, xCm: scenario.start.xCm + forwardCm * Math.cos(yaw), yCm: scenario.start.yCm + forwardCm * Math.sin(yaw), zCm: upCm } };
  });
  return { ...idle, status, objects, robot: { ...idle.robot, gripper: state } as RobotSnapshot['robot'] };
}
