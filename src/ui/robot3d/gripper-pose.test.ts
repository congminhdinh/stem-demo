import { describe, expect, it } from 'vitest';
import { productionKits, unoR3Board } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { createGripperPose, gripperPose, gripperPoseInto, type GripperPose } from './gripper-pose';
import { robotModel, type GripperModel } from './robot-model';

// N19 E9: gripperPoseInto reads the mount by index instead of destructuring it (the array's iterator allocated in every drawn frame;
// robot-assembly.gripper.allocation.test.ts). The pose is the same to the last bit: pinned at the corners the geometry names, and equal to
// the former arithmetic (destructuring) at 8 000 states.

const model = robotModel(productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit, unoR3Board).gripper!;

describe('the gripper’s pose in the 3D view', () => {
  it('pins the corners of the geometry: boom elevation −40° down, 0° at lift 40°, +50° up; the fingers meet at 80° and open at 12°', () => {
    // Lowered (lift 0): the boom 40° below level, the claw open (β 12° = 0.20943951023931956 rad).
    expect(gripperPose(model, { clawDeg: 0, liftDeg: 0 })).toEqual({
      elevationRad: -0.6981317007977318,
      tip: [0.0833022221559489, 0.01686061951567304, 0],
      betaRad: 0.20943951023931956,
      jawLeft: [0.0883022221559489, 0.01686061951567304, -0.022000000000000002],
      jawRight: [0.0883022221559489, 0.01686061951567304, 0.022000000000000002],
    });
    // Lift 40°: the boom level, 5 cm out from the mount (the farthest reach, plan 4.13); claw 80: β = 12 − 0.445 · 80 = −23.6°.
    expect(gripperPose(model, { clawDeg: 80, liftDeg: 40 })).toEqual({
      elevationRad: 0,
      tip: [0.095, 0.049, 0],
      betaRad: -0.4118977034706618,
      jawLeft: [0.1, 0.049, -0.022000000000000002],
      jawRight: [0.1, 0.049, 0.022000000000000002],
    });
    // Up (lift 90): the boom 50° above level.
    expect(gripperPose(model, { clawDeg: 0, liftDeg: 90 })).toEqual({
      elevationRad: 0.8726646259971648,
      tip: [0.07713938048432697, 0.0873022221559489, 0],
      betaRad: 0.20943951023931956,
      jawLeft: [0.08213938048432698, 0.0873022221559489, -0.022000000000000002],
      jawRight: [0.08213938048432698, 0.0873022221559489, 0.022000000000000002],
    });
  });

  it('is the former arithmetic to the last bit at 8 000 states, written into one pose made once', () => {
    /** The function as it was before E9: the mount destructured. */
    function before(out: GripperPose, gripper: GripperModel, state: { clawDeg: number; liftDeg: number }): GripperPose {
      const DEG = Math.PI / 180;
      const elevationRad = (gripper.elevationAtLift0Deg + state.liftDeg) * DEG;
      const [px, py, pz] = gripper.position;
      const tx = px + gripper.boomLengthM * Math.cos(elevationRad);
      const ty = py + gripper.boomLengthM * Math.sin(elevationRad);
      const closed = gripper.fingerOpenDeg - gripper.fingerDegPerServoDeg * gripper.jawsMeetDeg;
      const beta = Math.min(gripper.fingerOpenDeg, Math.max(closed, gripper.fingerOpenDeg - gripper.fingerDegPerServoDeg * state.clawDeg));
      out.elevationRad = elevationRad;
      out.tip = [tx, ty, pz];
      out.betaRad = beta * DEG;
      out.jawLeft = [tx + gripper.hinge.uM, ty, pz - gripper.hinge.vM];
      out.jawRight = [tx + gripper.hinge.uM, ty, pz + gripper.hinge.vM];
      return out;
    }
    const now = createGripperPose();
    const expected = createGripperPose();
    for (let i = 0; i < 8000; i++) {
      const state = { clawDeg: (i * 7) % 90, liftDeg: ((i * 13) % 1000) / 10 };
      expect(gripperPoseInto(now, model, state)).toBe(now);
      expect(now).toEqual(before(expected, model, state));
    }
  });
});
