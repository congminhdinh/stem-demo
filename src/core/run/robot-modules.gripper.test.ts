import { describe, expect, it } from 'vitest';
import { createModuleIO, createVirtualUno, productionKits, referenceKitRef, unoR3Board, type Kit } from '../hardware';
import { createModuleModels } from './robot-modules';

// N19 B1: the gripper's module model (gripper-servo2, contract rows U-35, U-36) reads the claw's and the lift's servo angles off the CLAW
// (D9) and LIFT (D10) pins, `PinState.servoDeg`, into `ActuatorTargets.gripper`. Like a servo, a pin the Servo library has not attached says
// nothing (the world holds the gripper's target). A kit without a gripper gets no `gripper` field at all.

const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const rover = productionKits.get(referenceKitRef) as Kit;
const COAST = { duty: 0, dir: 0, brake: false };

function bench(kit: Kit) {
  let ms = 0;
  const uno = createVirtualUno(unoR3Board, { now: () => ms, charge: (us) => void (ms += us / 1000) });
  return { uno, models: createModuleModels(kit, unoR3Board) };
}

describe('createModuleModels (ref-uno-gripper@0): the gripper', () => {
  it('reads the claw and the lift off CLAW and LIFT: setup() writes 0° and 90°, gripper.claw and gripper.lift what the program says', () => {
    const { uno, models } = bench(gripperKit);
    // Before the Servo library attaches the pins, nothing to say: the world holds what it has.
    expect(models.targets(uno.pins())).toEqual({ motors: { motorLeft: COAST, motorRight: COAST }, servos: {}, gripper: {} });
    const modules = createModuleIO(gripperKit, uno);
    expect(models.targets(uno.pins()).gripper).toEqual({ clawDeg: 0, liftDeg: 90 });
    modules.call('gripper', 'gripper.claw', [80]);
    modules.call('gripper', 'gripper.lift', [15]);
    expect(models.targets(uno.pins())).toEqual({ motors: { motorLeft: COAST, motorRight: COAST }, servos: {}, gripper: { clawDeg: 80, liftDeg: 15 } });
    // The driver clamps to 0..90 (D-G3) before Servo.write.
    modules.call('gripper', 'gripper.claw', [120]);
    expect(models.targets(uno.pins()).gripper).toEqual({ clawDeg: 90, liftDeg: 15 });
    const pins = uno.pins();
    expect([pins.find((pin) => pin.pin === 'D9')!.servoDeg, pins.find((pin) => pin.pin === 'D10')!.servoDeg]).toEqual([90, 15]);
  });

  it('a kit without a gripper has no gripper target', () => {
    const { uno, models } = bench(rover);
    createModuleIO(rover, uno);
    expect('gripper' in models.targets(uno.pins())).toBe(false);
  });
});
