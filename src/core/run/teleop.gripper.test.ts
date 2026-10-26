import { describe, expect, it } from 'vitest';
import type { ModuleIO } from '../capabilities/io';
import { productionKits, referenceKitRef, unoR3Board, type Kit } from '../hardware';
import { canTeleop, canTeleopGripper, createTeleopController, GRIPPER_ROLE, TELEOP_USES, teleopUses, type TeleopCommand } from './teleop';

// N19 E3: teleop on the gripper car. The claw and the lift are two more commands of the same controller, `{op:'gripper', part, deg}`,
// each applied at the start of the next tick through the module binding (gripper.claw / gripper.lift on the role `gripper`, never the
// physics), logged with its tick like a drive command. The rover has none of it: its uses, its commands and its log are as they were.

const rover = productionKits.get(referenceKitRef) as Kit;
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;

/** A ModuleIO that records every call. */
function recorder() {
  const calls: [string, string, number[]][] = [];
  const io: ModuleIO = {
    call: (role, op, args) => void calls.push([role, op, [...args]]),
    read: () => 0,
  };
  return { io, calls };
}

const claw = (deg: number): TeleopCommand => ({ op: 'gripper', part: 'claw', deg });
const lift = (deg: number): TeleopCommand => ({ op: 'gripper', part: 'lift', deg });
const forward = (speed: number): TeleopCommand => ({ op: 'move', direction: 'forward', speed });

describe('the gripper commands of the teleop controller (N19 E3)', () => {
  it('applies a claw and a lift command at the next tick as gripper.claw and gripper.lift on the role gripper, and logs each with its tick', () => {
    const teleop = createTeleopController();
    const { io, calls } = recorder();
    teleop.push(claw(80));
    teleop.push(lift(75));
    expect(teleop.pending()).toBe(2);
    expect(calls).toEqual([]);
    teleop.apply(3, io);
    expect(calls).toEqual([
      ['gripper', 'gripper.claw', [80]],
      ['gripper', 'gripper.lift', [75]],
    ]);
    expect(GRIPPER_ROLE).toBe('gripper');
    expect(teleop.log()).toEqual([
      { tick: 3, command: claw(80) },
      { tick: 3, command: lift(75) },
    ]);
    expect(Object.isFrozen(teleop.log()[0]!.command)).toBe(true);
  });

  it('skips a gripper command that repeats what that part was last told (a key held down), and logs nothing for it', () => {
    const teleop = createTeleopController();
    const { io, calls } = recorder();
    teleop.push(lift(60));
    teleop.push(lift(60));
    teleop.apply(0, io);
    teleop.push(lift(60));
    teleop.apply(1, io);
    teleop.push(lift(45));
    teleop.apply(2, io);
    expect(calls).toEqual([
      ['gripper', 'gripper.lift', [60]],
      ['gripper', 'gripper.lift', [45]],
    ]);
    expect(teleop.log().map((entry) => entry.tick)).toEqual([0, 2]);
  });

  it('keeps the claw, the lift and the drive apart: a command for one never makes another a repeat', () => {
    const teleop = createTeleopController();
    const { io, calls } = recorder();
    teleop.push(claw(80));
    teleop.push(lift(80));
    teleop.push(forward(50));
    // The claw was last told 80, the lift 80, the drive forward at 50: each of these is a repeat of its own.
    teleop.push(claw(80));
    teleop.push(lift(80));
    teleop.push(forward(50));
    teleop.push(claw(0));
    teleop.apply(0, io);
    expect(calls).toEqual([
      ['gripper', 'gripper.claw', [80]],
      ['gripper', 'gripper.lift', [80]],
      ['drive', 'drive.move', [0, 50]],
      ['gripper', 'gripper.claw', [0]],
    ]);
  });

  it('refuses a gripper command that is none: another part, an angle outside 0..90 or not whole', () => {
    const teleop = createTeleopController();
    expect(() => teleop.push({ op: 'gripper', part: 'wrist' as 'claw', deg: 10 })).toThrow('A teleop gripper command moves the claw or the lift, not wrist.');
    expect(() => teleop.push(claw(91))).toThrow('A teleop gripper angle is a whole number from 0 to 90, not 91.');
    expect(() => teleop.push(lift(-1))).toThrow(RangeError);
    expect(() => teleop.push(lift(12.5))).toThrow(RangeError);
    expect(() => teleop.push(claw(Number.NaN))).toThrow(RangeError);
    expect(() => teleop.push(lift(Number.POSITIVE_INFINITY))).toThrow(RangeError);
    expect(teleop.pending()).toBe(0);
    // The ends are angles.
    teleop.push(claw(0));
    teleop.push(lift(90));
    expect(teleop.pending()).toBe(2);
  });
});

describe('teleopUses and canTeleopGripper (N19 E3)', () => {
  it('a kit without a gripper sets up the drive only: the very same uses as before', () => {
    expect(teleopUses(rover, unoR3Board)).toBe(TELEOP_USES);
    expect(canTeleopGripper(rover, unoR3Board)).toBe(false);
  });

  it('the gripper car sets up the drive, the gripper’s two ops and color.is: both servos attach (claw 0°, lift 90°) and colorBegin runs', () => {
    const uses = teleopUses(gripperKit, unoR3Board);
    expect(uses).toEqual({
      modules: [
        { role: 'drive', op: 'drive.move' },
        { role: 'drive', op: 'drive.stop' },
        { role: 'gripper', op: 'gripper.claw' },
        { role: 'gripper', op: 'gripper.lift' },
        { role: 'color1', op: 'color.is' },
      ],
      inputPins: [],
      outputPins: [],
    });
    expect(Object.isFrozen(uses) && Object.isFrozen(uses.modules) && Object.isFrozen(uses.modules[2]) && Object.isFrozen(uses.modules[4])).toBe(true);
    expect(canTeleopGripper(gripperKit, unoR3Board)).toBe(true);
    expect(canTeleop(gripperKit, unoR3Board)).toBe(true);
  });

  it('a kit without the lift or the claw offers no gripper keys, and one without the colour sensor sets up no colorBegin', () => {
    const noGripper = { ...gripperKit, modules: gripperKit.modules.filter((module) => module.kind !== 'gripper') } as Kit;
    expect(canTeleopGripper(noGripper, unoR3Board)).toBe(false);
    // The colour sensor alone still begins: colours show while driving by hand.
    expect(teleopUses(noGripper, unoR3Board).modules).toEqual([...TELEOP_USES.modules, { role: 'color1', op: 'color.is' }]);
    const noColor = { ...gripperKit, modules: gripperKit.modules.filter((module) => module.kind !== 'color-sensor') } as Kit;
    expect(teleopUses(noColor, unoR3Board).modules.map((use) => use.op)).toEqual(['drive.move', 'drive.stop', 'gripper.claw', 'gripper.lift']);
    const bare = { ...noGripper, modules: noGripper.modules.filter((module) => module.kind !== 'color-sensor') } as Kit;
    expect(teleopUses(bare, unoR3Board)).toBe(TELEOP_USES);
  });
});
