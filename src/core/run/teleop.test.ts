import { describe, expect, it } from 'vitest';
import type { ModuleIO } from '../capabilities/io';
import { productionKits, referenceKitRef, unoR3Board, type Kit } from '../hardware';
import { canTeleop, createTeleopController, TELEOP_USES, type TeleopCommand } from './teleop';

// N18 R4.8: the teleop controller ("Lái tay"), the pure part: commands queued between ticks, applied at the next tick through the module
// binding (drive.move / drive.stop on the role `drive`, never the physics), each logged with its tick.

const rover = productionKits.get(referenceKitRef) as Kit;

/** A ModuleIO that records every call. */
function recorder() {
  const calls: [string, string, number[]][] = [];
  const io: ModuleIO = {
    call: (role, op, args) => void calls.push([role, op, [...args]]),
    read: () => 0,
  };
  return { io, calls };
}

const forward = (speed: number): TeleopCommand => ({ op: 'move', direction: 'forward', speed });
const stop: TeleopCommand = { op: 'stop' };

describe('createTeleopController', () => {
  it('applies the commands queued since the last tick at the next one, in order, as drive.move (direction index, speed) and drive.stop', () => {
    const teleop = createTeleopController();
    const { io, calls } = recorder();
    teleop.push(forward(50));
    teleop.push({ op: 'move', direction: 'spinRight', speed: 70 });
    expect(teleop.pending()).toBe(2);
    expect(calls).toEqual([]);
    teleop.apply(0, io);
    expect(calls).toEqual([
      ['drive', 'drive.move', [0, 50]],
      ['drive', 'drive.move', [3, 70]],
    ]);
    expect(teleop.pending()).toBe(0);
    teleop.apply(1, io);
    expect(calls).toHaveLength(2);
    teleop.push({ op: 'move', direction: 'backward', speed: 30 });
    teleop.push({ op: 'move', direction: 'spinLeft', speed: 100 });
    teleop.push(stop);
    teleop.apply(7, io);
    expect(calls.slice(2)).toEqual([
      ['drive', 'drive.move', [1, 30]],
      ['drive', 'drive.move', [2, 100]],
      ['drive', 'drive.stop', []],
    ]);
    expect(teleop.log()).toEqual([
      { tick: 0, command: forward(50) },
      { tick: 0, command: { op: 'move', direction: 'spinRight', speed: 70 } },
      { tick: 7, command: { op: 'move', direction: 'backward', speed: 30 } },
      { tick: 7, command: { op: 'move', direction: 'spinLeft', speed: 100 } },
      { tick: 7, command: stop },
    ]);
  });

  it('skips a command that repeats what the drive was last told (a key held down), and logs nothing for it', () => {
    const teleop = createTeleopController();
    const { io, calls } = recorder();
    teleop.push(forward(50));
    teleop.apply(0, io);
    teleop.push(forward(50));
    teleop.push(forward(50));
    teleop.apply(1, io);
    teleop.push(forward(60));
    teleop.apply(2, io);
    teleop.push(stop);
    teleop.push(stop);
    teleop.apply(3, io);
    expect(calls).toEqual([
      ['drive', 'drive.move', [0, 50]],
      ['drive', 'drive.move', [0, 60]],
      ['drive', 'drive.stop', []],
    ]);
    expect(teleop.log().map((entry) => entry.tick)).toEqual([0, 2, 3]);
  });

  it('gives a frozen copy of its log: what is read never changes with later ticks', () => {
    const teleop = createTeleopController();
    const { io } = recorder();
    teleop.push(forward(40));
    teleop.apply(5, io);
    const log = teleop.log();
    teleop.push(stop);
    teleop.apply(9, io);
    expect(log).toEqual([{ tick: 5, command: forward(40) }]);
    expect(Object.isFrozen(log) && Object.isFrozen(log[0]) && Object.isFrozen(log[0]!.command)).toBe(true);
    expect(teleop.log()).toHaveLength(2);
  });

  it('refuses a command that is none: a direction the drive lacks, a speed outside 0..100 or not whole, an op it does not know', () => {
    const teleop = createTeleopController();
    expect(() => teleop.push({ op: 'move', direction: 'sideways' as 'forward', speed: 50 })).toThrow('A teleop move goes forward, backward, spinLeft or spinRight, not sideways.');
    expect(() => teleop.push(forward(101))).toThrow('A teleop speed is a whole number from 0 to 100, not 101.');
    expect(() => teleop.push(forward(-1))).toThrow(RangeError);
    expect(() => teleop.push(forward(50.5))).toThrow(RangeError);
    expect(() => teleop.push(forward(Number.NaN))).toThrow(RangeError);
    expect(() => teleop.push({ op: 'jump' } as unknown as TeleopCommand)).toThrow('A teleop command is a move or a stop, not jump.');
    expect(teleop.pending()).toBe(0);
  });

  it('refuses a tick that is not a whole number from 0, or one before the last it applied', () => {
    const teleop = createTeleopController();
    const { io } = recorder();
    expect(() => teleop.apply(-1, io)).toThrow(RangeError);
    expect(() => teleop.apply(1.5, io)).toThrow(RangeError);
    teleop.apply(4, io);
    expect(() => teleop.apply(3, io)).toThrow('Teleop ticks only go forward: 3 is before 4.');
  });
});

describe('TELEOP_USES and canTeleop', () => {
  it('sets up the drive and nothing else: both motors’ pins in setup(), as a program that uses only the drive', () => {
    expect(TELEOP_USES).toEqual({
      modules: [
        { role: 'drive', op: 'drive.move' },
        { role: 'drive', op: 'drive.stop' },
      ],
      inputPins: [],
      outputPins: [],
    });
  });

  it('teleop needs the drive: both motorLeft and motorRight', () => {
    expect(canTeleop(rover, unoR3Board)).toBe(true);
    const oneMotor = { ...rover, modules: rover.modules.filter((module) => module.role !== 'motorRight') } as Kit;
    expect(canTeleop(oneMotor, unoR3Board)).toBe(false);
  });
});
