import { describe, expect, it } from 'vitest';
import type { ProgramClock } from '../../capabilities/services';
import { unoUsesOf } from '../../program/uno-uses';
import type { YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
import { productionKits, referenceKitRef, unoR3Board as board } from '../catalog';
import type { Kit, KitPort } from '../kit';
import { createVirtualUno } from '../virtual-uno';
import { drivers, runSetup, setupLines, type SetupStep } from './index';

// N19 A3 (plan §4.2): what a driver's setup() steps can be (a servo of a two-servo module, a helper of the driver), and the timer an op
// claims, op by op: the generator's pin rules (`usage`) read it from the driver, not from the op's name.

const rover = productionKits.get(referenceKitRef) as Kit;

describe('setup steps', () => {
  it('writes a servo of a module with two by the role and the servo’s name, on the port pin’s macro', () => {
    const steps: SetupStep[] = [
      { kind: 'servoAttach', pin: 'CLAW', angle: 0, object: 'Claw' },
      { kind: 'servoAttach', pin: 'LIFT', angle: 90, object: 'Lift' },
    ];
    expect(setupLines(steps, 'gripper')).toEqual(['gripperClaw.attach(GRIPPER_CLAW);', 'gripperClaw.write(0);', 'gripperLift.attach(GRIPPER_LIFT);', 'gripperLift.write(90);']);
    expect(setupLines([{ kind: 'servoAttach', pin: 'PIN', angle: 90 }], 'servo1')).toEqual(['servo1.attach(SERVO1_PIN);', 'servo1.write(90);']);
  });

  it('writes a helper step as its call and runs the driver’s helper on the virtual UNO', () => {
    expect(setupLines([{ kind: 'helper', name: 'colorBegin' }], 'color1')).toEqual(['colorBegin();']);
    let us = 0;
    const uno = createVirtualUno(board, { now: () => us / 1000, charge: (by) => void (us += by) } satisfies ProgramClock);
    const port = rover.ports.find((candidate) => candidate.id === 'LED1') as KitPort;
    const ran: string[] = [];
    runSetup(uno.io, port, [{ kind: 'helper', name: 'colorBegin' }], { colorBegin: (_io, at) => void ran.push(at.id) });
    expect(ran).toEqual(['LED1']);
    expect(() => runSetup(uno.io, port, [{ kind: 'helper', name: 'colorBegin' }])).toThrow(/no setup helper colorBegin/);
  });
});

describe('the timer each op claims (DriverOp.claims)', () => {
  it('is the Servo library’s for servo.set, tone’s for buzzer.tone, and nothing for buzzer.stop or any other op of the rover', () => {
    const claims = Object.fromEntries(
      ['hbridge-en-in1-in2', 'servo-lib', 'hcsr04-pulsein', 'line-digital', 'line-analog', 'led-digital', 'buzzer-tone', 'button-pullup'].flatMap((id) =>
        Object.entries(drivers[id as keyof typeof drivers].ops).map(([op, definition]) => [op, definition.claims ?? null]),
      ),
    );
    expect(claims).toEqual({
      'motor.set': null,
      'servo.set': 'servo',
      'ultrasonic.cm': null,
      'line.dark': null,
      'line.raw': null,
      'led.set': null,
      'buzzer.tone': 'tone',
      'buzzer.stop': null,
      'button.pressed': null,
    });
  });

  it('decides the program’s usage: buzzer.stop alone claims nothing', () => {
    const call = (op: string, role: string, args: YbcStatement[] = []): YbcStatement =>
      ({ kind: 'call', op, operand: { kind: 'role', role }, args: args.length ? args : op === 'buzzer.stop' ? [] : [{ kind: 'number', value: 1 }], blockId: op }) as unknown as YbcStatement;
    const usage = (...statements: YbcStatement[]) => unoUsesOf({ onStart: statements, forever: null, variables: [] } as unknown as YbcProgramIR, rover).usage;
    expect(usage(call('buzzer.stop', 'buzzer'))).toEqual({ servo: false, tone: false, serial: false });
    expect(usage(call('servo.set', 'servo1'))).toEqual({ servo: true, tone: false, serial: false });
    expect(usage(call('buzzer.stop', 'buzzer'), { ...call('buzzer.tone', 'buzzer'), args: [{ kind: 'number', value: 440 }, { kind: 'number', value: 100 }] } as unknown as YbcStatement)).toEqual({
      servo: false,
      tone: true,
      serial: false,
    });
  });
});
