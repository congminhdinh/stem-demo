import { describe, expect, it } from 'vitest';
import { Sprite } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { gripperKit, gripperTestScenario } from '../__fixtures__/gripper-scene';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import type { DistanceLabel } from './distance-label';
import { createSensorOverlay, GRIPPER_DISTANCE_LIFT_M, LABEL_LIFT_M } from './sensor-overlay';

// N19 E8 fix round 1 (review minor): a gripper car's distance tag stands GRIPPER_DISTANCE_LIFT_M over its ray's end, low by the claw and
// what it holds (at LABEL_LIFT_M it floated far over them, the ultrasonic being up on the deck); a rover's stands where N18 put it.

const label = (): DistanceLabel => ({ sprite: new Sprite(), widthShare: 0, show: () => void 0, showNoEcho: () => void 0, dispose: () => void 0 });

function liftOf(kit: Kit, scenario: Scenario) {
  const model = robotModel(kit, unoR3Board);
  const overlay = createSensorOverlay({ kit, model, scenario, decimal: ',', unit: 'cm', noEchoText: 'không thấy vật', fovDeg: 40, detail: 'high', makeLabel: label });
  const idle = idleSnapshot(scenario, kit);
  const world: RobotSnapshot = { ...idle, status: 'running', sensors: [{ role: model.ultrasonics[0]!.role, kind: 'ultrasonic', cm: 3.8, hitId: 'cube' }] };
  overlay.update(world, true, 0, 1);
  const sprite = overlay.labels[0]!.sprite;
  return { x: sprite.position.x, y: sprite.position.y, overlay };
}

describe('the distance tag’s height (N19 E8)', () => {
  it('stands low over a gripper car’s echo', () => {
    expect(GRIPPER_DISTANCE_LIFT_M).toBeLessThan(LABEL_LIFT_M / 2);
    const { x, y, overlay } = liftOf(gripperKit, gripperTestScenario);
    expect(x).toBeCloseTo(0.038, 6);
    expect(y).toBe(GRIPPER_DISTANCE_LIFT_M);
    expect(overlay.distanceLiftM).toBe(GRIPPER_DISTANCE_LIFT_M);
  });

  it('stands where it did over a rover’s', () => {
    const rover = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
    const { y, overlay } = liftOf(rover, scenarioCatalog.get('rb-sandbox')!);
    expect(y).toBe(LABEL_LIFT_M);
    expect(overlay.distanceLiftM).toBe(LABEL_LIFT_M);
  });
});
