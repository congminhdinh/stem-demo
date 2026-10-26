import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import { bodyPalette } from '../../../core/world/arena/body-colors';
import { parseArena, type ArenaInput } from '../../../core/world/arena/arena-schema';
import type { RobotSnapshot, SensorReadout, SnapshotObject } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { gripperPose, type GripperState } from '../gripper-pose';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';

// N19 E6/E7 test fixtures (no gripper scenario ships yet, plan D4): a test arena for the gripper car with every pick-and-place prop (a cube
// of each palette colour, a parcel, a blue base (not the yellow cube's colour: fix round 1, review M4), a warehouse shelf on a `kho-wall`,
// the named zones), and snapshots of the car at a gripper pose, holding the red cube where the world would hold it (centred between the fingers). Used by the unit tests and by the
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
    { id: 'base', shape: 'box', centerCm: [104, 30], sizeCm: [6, 6, 4], massG: 40, noun: 'base', color: bodyPalette.blue },
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
 * N19 E4/E5 (fix round 1): what the gallery's close-ups of the gripper's sensors show. `ahead`: an object stands on the floor between the open
 * jaws, 4 cm on from the carriage (its near face at u 2, where the IR sees it: as the e2e's pick arena puts the cube); `sensors`: the
 * readouts in kit order, 'quiet' (the IR sees nothing, the colour ray meets nothing, the colour sensor's counts of the room's light) or
 * 'seen' (the IR sees the held or ahead object, the colour sensor's ray meets its face and reads it: the counts a real run read off a red
 * cube, spikes/n19-e45/results/rest-draws.txt); `heldAtCm`: how far on from the carriage the held object's centre is (2.5 by default, E6/E7's;
 * the e2e's real grab holds it at 4). Without them the snapshot has no readouts, as E6/E7's gallery had.
 */
export type GripperShotOptions = { ahead?: string; sensors?: 'quiet' | 'seen'; heldAtCm?: number };

/** Counts of the TCS34725 off a red cube 2.2 cm away (a real run, spikes/n19-e45/results/rest-draws.txt), and of the room's light alone (under C 300: unclear). */
const RED_COUNTS = { r: 2630, g: 569, b: 472, c: 3672 };
const AMBIENT_COUNTS = { r: 10, g: 10, b: 10, c: 30 };

/**
 * The car at its start with the gripper at `state` (robot.gripper, plan §4.4), `status` its run's; holding `held` (an object's id) centred
 * between the fingers 2.5 cm ahead of the carriage, where the world's grasp keeps it, the other objects where the arena puts them (and, E4/E5,
 * `options.ahead` between the open jaws, with `options.sensors`' readouts).
 */
export function gripperSnapshot(state: GripperState, status: RobotSnapshot['status'] = 'running', scenario: Scenario = gripperTestScenario, options: GripperShotOptions = {}): RobotSnapshot {
  const idle = idleSnapshot(scenario, gripperKit);
  const pose = gripperPose(model.gripper!, state);
  const yaw = (scenario.start.yawDeg * Math.PI) / 180;
  const at = (onCm: number, zCm: number | null, object: SnapshotObject): SnapshotObject => {
    // The tip in the robot frame (three: x forward, y up), `onCm` further: the arena point of the robot turned by its yaw.
    const forwardCm = pose.tip[0] * 100 + onCm;
    return { ...object, pose: { ...object.pose, xCm: scenario.start.xCm + forwardCm * Math.cos(yaw), yCm: scenario.start.yCm + forwardCm * Math.sin(yaw), zCm: zCm ?? object.pose.zCm } };
  };
  const objects: SnapshotObject[] = idle.objects.map((object) => {
    if (object.id === state.heldId) return at(options.heldAtCm ?? 2.5, pose.tip[1] * 100, object);
    if (object.id === options.ahead) return at(4, null, object);
    return object;
  });
  const target = state.heldId ?? options.ahead ?? null;
  // The near face of the object between the jaws (a 4 cm cube), from the sensors' mount at u 0.3.
  const reachCm = (state.heldId !== null ? (options.heldAtCm ?? 2.5) : 4) - 2 - 0.3;
  const seen = options.sensors === 'seen' && target !== null;
  const spots = model.lineSensors.map((sensor): [number, number] => [scenario.start.xCm + sensor.position[0] * 100, scenario.start.yCm - sensor.position[2] * 100]);
  const sensors: SensorReadout[] =
    options.sensors === undefined
      ? []
      : [
          // The ultrasonic hears the far wall over a cube between the jaws (it is in the cone's blind spot, B3; the e2e's real run heard the
          // wall too): the arena's east wall's face at x 118, from the sensor at the robot's x + 7.5.
          { role: 'ultrasonic', kind: 'ultrasonic', cm: 118 - scenario.start.xCm - 7.5, hitId: '#wall-3' },
          ...model.lineSensors.map((sensor, i): SensorReadout => ({ role: sensor.role, kind: 'line-sensor', reflectance: 0.95, dark: false, spotCm: spots[i]! })),
          { role: 'irClaw', kind: 'ir-obstacle', detected: seen, hitId: seen ? target : null },
          { role: 'color1', kind: 'color-sensor', hitId: seen ? target : null, distanceCm: seen ? reachCm : null, rgbc: seen ? RED_COUNTS : AMBIENT_COUNTS },
        ];
  return { ...idle, status, objects, sensors, robot: { ...idle.robot, gripper: state } };
}
