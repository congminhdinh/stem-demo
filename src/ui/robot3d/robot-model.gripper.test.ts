import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { gripperJawsCm, robotMechanics } from '../../core/hardware/kit-mechanics';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { GRIPPER_REST, colorLedLit, createGripperPose, gripperPose, gripperPoseInto, gripperStateOf } from './gripper-pose';
import { robotModel } from './robot-model';
import { idleSnapshot } from './scene-math';

// N19 E6: the gripper the 3D view draws is the gripper of the kit (ref-uno-gripper.kit.json and kit-mechanics.ts): its pivot at the GR1
// mount, its boom, its fingers' hinges and boxes, and its sensors on the carriage at their mounts, in the robot group's three.js frame (m);
// it is posed from the snapshot's `robot.gripper` (plan §4.4) by the same geometry the world builds (N19 B1), so at lift 0° the jaws are
// where kit-mechanics' gripperJawsCm says.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(gripperKit, unoR3Board);
const gripper = model.gripper!;
const close = (actual: readonly number[], expected: readonly number[], digits = 9) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
const DEG = Math.PI / 180;

describe('the gripper of the 3D view’s robot (N19 E6)', () => {
  it('has none on the rover', () => {
    expect(robotModel(roverKit, unoR3Board).gripper).toBeNull();
  });

  it('pivots at the GR1 mount, with the kit’s boom, finger hinges and finger boxes (m)', () => {
    expect(gripper.role).toBe('gripper');
    close(gripper.position, [0.045, 0.049, 0]);
    expect(gripper.boomLengthM).toBeCloseTo(0.05, 12);
    expect(gripper.boomHalfSpanM).toBeCloseTo(0.066, 12);
    expect(gripper.elevationAtLift0Deg).toBe(-40);
    expect(gripper.hinge.uM).toBeCloseTo(0.005, 12);
    expect(gripper.hinge.vM).toBeCloseTo(0.022, 12);
    expect(gripper.finger.lengthM).toBeCloseTo(0.05, 12);
    expect(gripper.finger.thicknessM).toBeCloseTo(0.004, 12);
    expect(gripper.finger.heightM).toBeCloseTo(0.012, 12);
    expect([gripper.fingerOpenDeg, gripper.fingerDegPerServoDeg, gripper.jawsMeetDeg]).toEqual([12, 0.445, 80]);
  });

  it('puts the IR and colour sensors on the carriage at their mounts (three: u, w, −v), with their places among the snapshot’s sensors', () => {
    expect(gripper.ir?.role).toBe('irClaw');
    close(gripper.ir!.position, [0.003, 0, -0.006]);
    expect(gripper.ir?.sensorIndex).toBe(4);
    expect(gripper.color?.role).toBe('color1');
    close(gripper.color!.position, [0.003, 0, 0.006]);
    expect(gripper.color?.sensorIndex).toBe(5);
    // The kit's other sensors keep their places: the ultrasonic first, the line sensors after it.
    expect(model.ultrasonics.map((sensor) => sensor.role)).toEqual(['ultrasonic']);
    expect(model.lineSensors.map((sensor) => sensor.sensorIndex)).toEqual([1, 2, 3]);
  });
});

describe('the gripper’s pose (N19 E6)', () => {
  it('lowered and open: the boom 40° down, the tip at mount + 5 cm along it, each finger 12° out', () => {
    const pose = gripperPose(gripper, { clawDeg: 0, liftDeg: 0 });
    expect(pose.elevationRad).toBeCloseTo(-40 * DEG, 12);
    close(pose.tip, [0.045 + 0.05 * Math.cos(-40 * DEG), 0.049 + 0.05 * Math.sin(-40 * DEG), 0]);
    expect(pose.betaRad).toBeCloseTo(12 * DEG, 12);
    close(pose.jawLeft, [pose.tip[0] + 0.005, pose.tip[1], -0.022]);
    close(pose.jawRight, [pose.tip[0] + 0.005, pose.tip[1], 0.022]);
  });

  it('puts the lowered jaws where kit-mechanics’ gripperJawsCm does (x 8.83–13.83, z 1.09–2.29 cm, the open tips 6.08 cm apart)', () => {
    const mechanics = robotMechanics(gripperKit).gripper!;
    const jaws = gripperJawsCm(mechanics, 0);
    const pose = gripperPose(gripper, { clawDeg: 0, liftDeg: 0 });
    expect(pose.jawLeft[0] * 100).toBeCloseTo(jaws.xMin, 9);
    expect((pose.jawLeft[0] + gripper.finger.lengthM) * 100).toBeCloseTo(jaws.xMax, 9);
    expect((pose.tip[1] - gripper.finger.heightM / 2) * 100).toBeCloseTo(jaws.zMin, 9);
    expect((pose.tip[1] + gripper.finger.heightM / 2) * 100).toBeCloseTo(jaws.zMax, 9);
    const tipV = gripper.hinge.vM + gripper.finger.lengthM * Math.sin(pose.betaRad);
    expect((2 * tipV - gripper.finger.thicknessM) * 100).toBeCloseTo(jaws.openTipGapCm, 9);
    expect(jaws.openTipGapCm).toBeCloseTo(6.08, 2);
  });

  it('raised and closed: the boom 50° up, the fingers at the jaws’ meeting angle (−23.6°), and no further past either end', () => {
    const pose = gripperPose(gripper, { clawDeg: 80, liftDeg: 90 });
    expect(pose.elevationRad).toBeCloseTo(50 * DEG, 12);
    expect(pose.betaRad).toBeCloseTo(-23.6 * DEG, 12);
    expect(gripperPose(gripper, { clawDeg: 90, liftDeg: 90 }).betaRad).toBeCloseTo(-23.6 * DEG, 12);
    expect(gripperPose(gripper, { clawDeg: -10, liftDeg: 90 }).betaRad).toBeCloseTo(12 * DEG, 12);
  });

  it('writes a pose into one it was given, making nothing (the view poses the gripper every frame; fix round 1, review M1)', () => {
    const out = createGripperPose();
    const [tip, left, right] = [out.tip, out.jawLeft, out.jawRight];
    expect(gripperPoseInto(out, gripper, { clawDeg: 80, liftDeg: 90 })).toBe(out);
    expect([out.tip, out.jawLeft, out.jawRight]).toEqual([tip, left, right]);
    expect(out.tip).toBe(tip);
    expect(out).toEqual(gripperPose(gripper, { clawDeg: 80, liftDeg: 90 }));
  });

  it('reads robot.gripper from the snapshot, and setup()’s pose (claw 0°, lift 90°) before the world has one', () => {
    const idle = idleSnapshot(scenarioCatalog.get('rb-line-follow')!, gripperKit);
    expect(gripperStateOf(idle)).toEqual(GRIPPER_REST);
    expect(GRIPPER_REST).toEqual({ clawDeg: 0, liftDeg: 90, heldId: null });
    const held: RobotSnapshot = { ...idle, robot: { ...idle.robot, gripper: { clawDeg: 31.5, liftDeg: 12, heldId: 'cube' } } };
    expect(gripperStateOf(held)).toEqual({ clawDeg: 31.5, liftDeg: 12, heldId: 'cube' });
  });

  it('lights the colour sensor’s LED while the robot runs (the breakout’s LED is on whenever the board is powered), not before or after', () => {
    const idle = idleSnapshot(scenarioCatalog.get('rb-line-follow')!, gripperKit);
    expect(colorLedLit(idle)).toBe(false);
    expect(colorLedLit({ ...idle, status: 'running' })).toBe(true);
    expect(colorLedLit({ ...idle, status: 'finished' })).toBe(false);
    expect(colorLedLit({ ...idle, status: 'error' })).toBe(false);
  });
});
