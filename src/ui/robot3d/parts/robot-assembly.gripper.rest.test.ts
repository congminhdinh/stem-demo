import { Texture } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { gripperPose } from '../gripper-pose';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { applyRobotWorld, assembleRobot, gripperReferenceSizes, poseGripper, referenceSizes, type AssemblyOptions } from './robot-assembly';

// N19 E9: a frame with the claw and the arm where the last one left them writes nothing to the gripper's nodes (poseGripper's `posedFor`):
// an arm at rest makes no arithmetic and no object in the frames of a run. Whatever moves is posed as before, the first frame always is, and
// the colour sensor's LED follows the robot's status on its own.

const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const reference = referenceSizes(robotModel(roverKit, unoR3Board));
const model = robotModel(gripperKit, unoR3Board);
const g = model.gripper!;
const options = (detail: 'high' | 'low'): AssemblyOptions => ({ detail, shadows: detail === 'high', flag: null, boardLedPin: 13, blob: new Texture(), gripperReference: gripperReferenceSizes(model)! });
const idle = idleSnapshot(scenarioCatalog.get('rb-line-follow')!, gripperKit);
const at = (clawDeg: number, liftDeg: number, status: RobotSnapshot['status'] = 'idle'): RobotSnapshot => ({ ...idle, status, robot: { ...idle.robot, gripper: { clawDeg, liftDeg, heldId: null } } });
let assets: Record<'high' | 'low', RobotAssets>;

beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});

for (const detail of ['high', 'low'] as const) {
  describe(`the gripper at rest in the 3D view (${detail})`, () => {
    it('poses the first frame whatever it says, even setup()’s pose (claw 0, arm 90), which no snapshot of the gripper car need carry', () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      expect(handles.boom.rotation.z).toBe(0);
      // A snapshot with no robot.gripper is setup()'s pose (gripperStateOf): the view before a run.
      poseGripper(handles, idle);
      const rest = gripperPose(g, { clawDeg: 0, liftDeg: 90 });
      expect(rest.elevationRad).toBe(0.8726646259971648);
      expect(handles.boom.rotation.z).toBe(rest.elevationRad);
      expect(handles.carriage.position.toArray()).toEqual(rest.tip);
      expect(handles.jawLeft.rotation.y).toBe(rest.betaRad);
      expect(handles.jawRight.rotation.y).toBe(-rest.betaRad);
      robot.dispose();
    });

    it('leaves the nodes alone while the claw and the arm are where they were, and poses them again the frame either moves', () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      poseGripper(handles, at(30, 45));
      const posed = gripperPose(g, { clawDeg: 30, liftDeg: 45 });
      expect(handles.boom.rotation.z).toBe(posed.elevationRad);
      expect(handles.jawLeft.position.toArray()).toEqual(posed.jawLeft);
      // Marked, to see whether the next frame writes them.
      handles.boom.rotation.z = 1.25;
      handles.carriage.position.x = 9;
      handles.jawLeft.rotation.y = 0.5;
      handles.jawRight.position.z = -3;
      poseGripper(handles, at(30, 45));
      poseGripper(handles, { ...at(30, 45), t: 12.5 });
      expect([handles.boom.rotation.z, handles.carriage.position.x, handles.jawLeft.rotation.y, handles.jawRight.position.z]).toEqual([1.25, 9, 0.5, -3]);
      // Another claw angle with the same arm: everything is posed again, from the pose of that state.
      poseGripper(handles, at(60, 45));
      const closing = gripperPose(g, { clawDeg: 60, liftDeg: 45 });
      expect(handles.boom.rotation.z).toBe(closing.elevationRad);
      expect(handles.carriage.position.toArray()).toEqual(closing.tip);
      expect(handles.jawLeft.position.toArray()).toEqual(closing.jawLeft);
      expect(handles.jawLeft.rotation.y).toBe(closing.betaRad);
      expect(handles.jawRight.rotation.y).toBe(-closing.betaRad);
      // Another arm angle with the same claw.
      poseGripper(handles, at(60, 20));
      const lowered = gripperPose(g, { clawDeg: 60, liftDeg: 20 });
      expect(handles.boom.rotation.z).toBe(lowered.elevationRad);
      expect(handles.carriage.position.toArray()).toEqual(lowered.tip);
      robot.dispose();
    });

    it('lights the colour sensor’s LED with the robot’s run and keeps it as it is between the frames of the same status', () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      expect(handles.led).not.toBeNull();
      poseGripper(handles, at(0, 90, 'idle'));
      expect(handles.led!.emissiveIntensity).toBe(0);
      expect(handles.ledHalo!.visible).toBe(false);
      poseGripper(handles, at(0, 90, 'running'));
      expect(handles.led!.emissiveIntensity).toBe(2.4);
      expect(handles.ledHalo!.visible).toBe(true);
      // Marked: the next frame of the same status does not write it.
      handles.led!.emissiveIntensity = 7;
      poseGripper(handles, at(0, 90, 'running'));
      expect(handles.led!.emissiveIntensity).toBe(7);
      poseGripper(handles, at(0, 90, 'finished'));
      expect(handles.led!.emissiveIntensity).toBe(0);
      expect(handles.ledHalo!.visible).toBe(false);
      robot.dispose();
    });

    it('is applyRobotWorld’s pose too, frame after frame', () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      applyRobotWorld(robot.handles, at(10, 80, 'running'), '#f00', '#300');
      applyRobotWorld(robot.handles, at(10, 80, 'running'), '#f00', '#300');
      applyRobotWorld(robot.handles, at(70, 5, 'running'), '#f00', '#300');
      const pose = gripperPose(g, { clawDeg: 70, liftDeg: 5 });
      expect(robot.handles.gripper!.boom.rotation.z).toBe(pose.elevationRad);
      expect(robot.handles.gripper!.jawRight.position.toArray()).toEqual(pose.jawRight);
      robot.dispose();
    });
  });
}
