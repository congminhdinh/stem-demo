import { describe, expect, it } from 'vitest';
import { productionKits } from '../hardware';
import { productionProfiles } from '../profiles';
import { unoDocument } from '../profiles/__fixtures__/uno-document';
import {
  analogRead,
  buttonPressed,
  buzzerStop,
  buzzerTone,
  compileRobot,
  derivedKit,
  digitalRead,
  digitalWrite,
  driveMove,
  driveStop,
  kitWithout,
  led,
  lineDark,
  lineRaw,
  millis,
  motorSet,
  packs,
  pwmWrite,
  registry,
  servoSet,
  ultrasonic,
} from './__fixtures__/uno-blocks';
import { add, getVar, num, print, setVar, text, type Json } from './__fixtures__/ybc-blocks';
import { compileYbcProgram } from './compile-ybc-program';
import { compileUnoProject } from './compile-uno-program';
import type { Expr, YbcStatement } from './ybc-ir';

// N18 R2.2 (robot plan §4.4): the robot's blocks compile to the module ops of a uno IR, against the kit's board target
// (kitBoardContext(resolveBoardContext(…), kit)): a role the kit lacks is capability-unavailable on its block, a raw pin is checked
// by the pin rules of the kit (contract UNO §9), and a typed-in number outside its range is written clamped, with a warning.

const n = (value: number, id: string): Json => ({ type: 'math_number', id, fields: { NUM: value } });
const int = (value: number, blockId: string): Expr => ({ blockId, type: 'int', kind: 'int', value });

function irOf(result: ReturnType<typeof compileRobot>) {
  if (!result.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.ir;
}
type AnyDiagnostic = { severity: string; code: string; message: string; blockId?: string };
const diagnosticsOf = (result: ReturnType<typeof compileRobot>): AnyDiagnostic[] => result.diagnostics;
const codes = (result: ReturnType<typeof compileRobot>) => diagnosticsOf(result).map((d) => `${d.severity} ${d.code} ${String(d.blockId)}`);

describe('the module ops of plan §4.4, with their operands and typed arguments', () => {
  it('compiles the Basic blocks: drive, stop, motor, servo, LED, buzzer tone, and the three sensor reads', () => {
    const ir = irOf(
      compileRobot(
        [
          driveMove('spinLeft', n(40, 's1'), 'drive'),
          driveStop('stop'),
          motorSet('motorRight', n(-30, 's2'), 'motor'),
          servoSet('servo1', n(45, 'a'), 'servo'),
          led('ON', 'led-on'),
          led('OFF', 'led-off'),
          buzzerTone(n(440, 'hz'), n(200, 'ms'), 'tone'),
          setVar('x', ultrasonic('cm')),
          print(lineDark('lineCenter', 'dark')),
          print(buttonPressed('pressed')),
        ],
        undefined,
        { profile: 'uno-basic' },
      ),
    );
    expect(ir.onStart).toEqual([
      { kind: 'call', op: 'drive.move', operand: { kind: 'drive', direction: 'spinLeft' }, args: [int(40, 's1')], blockId: 'drive' },
      { kind: 'call', op: 'drive.stop', blockId: 'stop' },
      { kind: 'call', op: 'motor.set', operand: { kind: 'role', role: 'motorRight' }, args: [int(-30, 's2')], blockId: 'motor' },
      { kind: 'call', op: 'servo.set', operand: { kind: 'role', role: 'servo1' }, args: [int(45, 'a')], blockId: 'servo' },
      { kind: 'call', op: 'led.set', operand: { kind: 'role', role: 'led1' }, args: [{ blockId: 'led-on', type: 'bool', kind: 'bool', value: true }], blockId: 'led-on' },
      { kind: 'call', op: 'led.set', operand: { kind: 'role', role: 'led1' }, args: [{ blockId: 'led-off', type: 'bool', kind: 'bool', value: false }], blockId: 'led-off' },
      { kind: 'call', op: 'buzzer.tone', operand: { kind: 'role', role: 'buzzer' }, args: [int(440, 'hz'), int(200, 'ms')], blockId: 'tone' },
      expect.objectContaining({ kind: 'set', value: { blockId: 'cm', type: 'int', kind: 'read', op: 'ultrasonic.cm', operand: { kind: 'role', role: 'ultrasonic' } } }),
      expect.objectContaining({ kind: 'print', value: { blockId: 'dark', type: 'bool', kind: 'read', op: 'line.dark', operand: { kind: 'role', role: 'lineCenter' } } }),
      expect.objectContaining({ kind: 'print', value: { blockId: 'pressed', type: 'bool', kind: 'read', op: 'button.pressed', operand: { kind: 'role', role: 'button1' } } }),
    ]);
    expect(ir).toMatchObject({ numeric: 'cxx-int32', loopPauseUs: 0 });
  });

  it('compiles the Advanced blocks: raw line value, buzzer stop, millis and the raw pins, each pin an operand', () => {
    const ir = irOf(
      compileRobot([
        print(lineRaw('lineLeft', 'raw')),
        buzzerStop('quiet'),
        print(millis('ms')),
        digitalWrite('A3', 'HIGH', 'write'),
        print(digitalRead('D3', 'read')),
        print(analogRead('A2', 'analog')),
      ]),
    );
    const value = (index: number) => (ir.onStart[index] as { value: Expr }).value;
    expect(value(0)).toEqual({ blockId: 'raw', type: 'int', kind: 'read', op: 'line.raw', operand: { kind: 'role', role: 'lineLeft' } });
    expect(ir.onStart[1]).toEqual({ kind: 'call', op: 'buzzer.stop', operand: { kind: 'role', role: 'buzzer' }, blockId: 'quiet' });
    expect(value(2)).toEqual({ blockId: 'ms', type: 'int', kind: 'read', op: 'time.millis' });
    expect(ir.onStart[3]).toEqual({ kind: 'call', op: 'digital.write', operand: { kind: 'pin', pin: 'A3' }, args: [{ blockId: 'write', type: 'bool', kind: 'bool', value: true }], blockId: 'write' });
    expect(value(4)).toEqual({ blockId: 'read', type: 'bool', kind: 'read', op: 'digital.read', operand: { kind: 'pin', pin: 'D3' }, args: [] });
    expect(value(5)).toEqual({ blockId: 'analog', type: 'int', kind: 'read', op: 'analogIn.read', operand: { kind: 'pin', pin: 'A2' }, args: [] });
  });

  it('compiles a PWM write on a free PWM pin with its value: a kit without the buzzer leaves D10 free', () => {
    const ir = irOf(compileRobot([pwmWrite('D10', n(200, 'v'), 'pwm')], undefined, { kit: kitWithout('buzzer') }));
    expect(ir.onStart).toEqual([{ kind: 'call', op: 'pwm.write', operand: { kind: 'pin', pin: 'D10' }, args: [int(200, 'v')], blockId: 'pwm' }]);
  });

  it('takes a computed argument as it is: the run clamps it', () => {
    const ir = irOf(compileRobot([motorSet('motorLeft', add(getVar('x'), n(150, 'k')), 'motor')]));
    expect(ir.onStart[0]).toMatchObject({ op: 'motor.set', args: [{ kind: 'arith', right: int(150, 'k') }] });
    expect(compileRobot([motorSet('motorLeft', add(getVar('x'), n(150, 'k')))]).diagnostics).toEqual([]);
  });

  it('types the arguments: a speed, an angle, Hz, ms and a PWM value are whole numbers', () => {
    const flag: Json = { type: 'logic_boolean', id: 'flag', fields: { BOOL: 'TRUE' } };
    const word: Json = { type: 'text', id: 'word', fields: { TEXT: 'long' } };
    expect(compileRobot([motorSet('motorLeft', flag, 'm'), buzzerTone(n(440, 'h'), word, 't')]).diagnostics).toEqual([
      { severity: 'error', code: 'type-mismatch', message: 'The speed needs a whole number, not a true / false value.', blockId: 'flag' },
      { severity: 'error', code: 'type-mismatch', message: 'The length of a tone needs a whole number, not a text.', blockId: 'word' },
    ]);
    expect(codes(compileRobot([{ type: 'uno_servo_set', id: 'empty', fields: { ROLE: 'servo1' } }]))).toEqual(['error missing-input empty']);
  });
});

describe('pre-clamped literals (contract UNO §0.5): the IR holds what the generator writes as it is', () => {
  it('clamps a typed-in speed, angle, Hz, ms and PWM value into their range and warns on the block', () => {
    const result = compileRobot(
      [
        motorSet('motorLeft', n(150, 'speed'), 'motor'),
        servoSet('servo1', n(600, 'angle'), 'servo'),
        buzzerTone(n(10, 'hz'), n(0, 'ms'), 'tone'),
        driveMove('forward', n(-250, 'drive-speed'), 'drive'),
      ],
      undefined,
    );
    const ir = irOf(result);
    expect(ir.onStart.map((statement: YbcStatement) => ('args' in statement ? statement.args : []))).toEqual([
      [int(100, 'speed')],
      [int(180, 'angle')],
      [int(31, 'hz'), int(1, 'ms')],
      [int(-100, 'drive-speed')],
    ]);
    expect(result.diagnostics).toEqual([
      { severity: 'warning', code: 'value-clamped', message: 'The speed 150 for the left motor is outside -100 to 100, so it is clamped to 100.', blockId: 'motor' },
      { severity: 'warning', code: 'value-clamped', message: 'The angle 600 for servo 1 is outside 0 to 180, so it is clamped to 180.', blockId: 'servo' },
      { severity: 'warning', code: 'value-clamped', message: 'The frequency 10 for the buzzer is outside 31 to 4000, so it is clamped to 31.', blockId: 'tone' },
      { severity: 'warning', code: 'value-clamped', message: 'The length 0 for the buzzer is outside 1 to 60000, so it is clamped to 1.', blockId: 'tone' },
      { severity: 'warning', code: 'value-clamped', message: 'The speed -250 for the left and the right motor is outside -100 to 100, so it is clamped to -100.', blockId: 'drive' },
    ]);
  });

  it('clamps a typed-in PWM value to 0..255', () => {
    const result = compileRobot([pwmWrite('D10', n(300, 'v'), 'pwm')], undefined, { kit: kitWithout('buzzer') });
    expect(irOf(result).onStart).toEqual([{ kind: 'call', op: 'pwm.write', operand: { kind: 'pin', pin: 'D10' }, args: [int(255, 'v')], blockId: 'pwm' }]);
    expect(diagnosticsOf(result).map((d) => d.message)).toEqual(['The PWM value 300 for D10 is outside 0 to 255, so it is clamped to 255.']);
  });

  it('keeps a drive speed of INT32_MIN: neg32 leaves it as it is, so each motor clamps it to -100 when it runs (contract U-21)', () => {
    const result = compileRobot([driveMove('backward', n(-2147483648, 's'), 'drive')]);
    expect(irOf(result).onStart[0]).toMatchObject({ args: [int(-2147483648, 's')] });
    expect(result.diagnostics).toEqual([]);
  });

  it('leaves a number already in range alone', () => {
    expect(compileRobot([motorSet('motorLeft', n(100, 'a')), motorSet('motorRight', n(-100, 'b')), servoSet('servo1', n(0, 'c')), buzzerTone(n(4000, 'h'), n(60000, 'm'))]).diagnostics).toEqual([]);
  });
});

describe('role missing from kit → capability-unavailable on that block', () => {
  it('refuses the servo block when the kit has no servo1, and nothing else', () => {
    const result = compileRobot([led('ON', 'led'), servoSet('servo1', n(90, 'a'), 'servo')], undefined, { kit: kitWithout('servo1') });
    expect(result).toEqual({
      ok: false,
      reason: 'compile',
      diagnostics: [
        { severity: 'error', code: 'capability-unavailable', message: '"uno_servo_set" needs servo 1, which the kit test-rover-without-servo1@0 does not have.', blockId: 'servo' },
      ],
    });
  });

  it.each([
    ['motorLeft', 'uno_motor_set', motorSet('motorLeft', num(50), 'block'), 'the left motor'],
    ['ultrasonic', 'uno_ultrasonic_cm', setVar('x', ultrasonic('block')), 'the ultrasonic sensor'],
    ['lineRight', 'uno_line_dark', print(lineDark('lineRight', 'block')), 'the right line sensor'],
    ['button1', 'uno_button_pressed', print(buttonPressed('block')), 'the button'],
    ['led1', 'uno_led_set', led('OFF', 'block'), 'the LED'],
    ['buzzer', 'uno_buzzer_tone', buzzerTone(num(440), num(100), 'block'), 'the buzzer'],
  ])('refuses a block of %s on a kit without it', (role, type, block, name) => {
    expect(compileRobot([block], undefined, { kit: kitWithout(role) }).diagnostics).toEqual([
      { severity: 'error', code: 'capability-unavailable', message: `"${type}" needs ${name}, which the kit test-rover-without-${role}@0 does not have.`, blockId: 'block' },
    ]);
  });

  it('refuses the drive and stop on a kit without one of the motors, and keeps the other motor', () => {
    const result = compileRobot([driveMove('forward', num(50), 'drive'), driveStop('stop'), motorSet('motorRight', num(50), 'right')], undefined, { kit: kitWithout('motorLeft') });
    expect(diagnosticsOf(result).map((d) => [d.code, d.blockId, d.message])).toEqual([
      ['capability-unavailable', 'drive', '"uno_drive_move" needs the left and the right motor, which the kit test-rover-without-motorLeft@0 does not have.'],
      ['capability-unavailable', 'stop', '"uno_drive_stop" needs the left and the right motor, which the kit test-rover-without-motorLeft@0 does not have.'],
    ]);
  });

  it('refuses the raw line value of a line sensor the kit wires to a pin without analog input', () => {
    const kit = derivedKit('test-rover-digital-line', (raw) => {
      const port = raw.ports.find((candidate) => candidate.id === 'LN1');
      if (port) {
        port.pins = { PIN: 'D0' };
      }
    });
    const result = compileRobot([print(lineDark('lineLeft', 'dark')), print(lineRaw('lineLeft', 'raw'))], undefined, { kit });
    expect(result.diagnostics).toEqual([
      { severity: 'error', code: 'capability-unavailable', message: 'The kit test-rover-digital-line@0 has the left line sensor, but not for "uno_line_raw".', blockId: 'raw' },
    ]);
  });

  it('says so for every block when nothing tells the compiler the kit (a uno compile without a kit target)', () => {
    const exposed = packs.typesOf(productionProfiles.get('uno-advanced')?.blockPacks ?? []);
    const workspace = { blocks: { blocks: [{ type: 'stem_on_start', id: 'h', inputs: { DO: { block: led('ON', 'led') } } }] } };
    expect(compileYbcProgram(workspace, exposed, undefined, undefined, 'uno').diagnostics).toEqual([
      { severity: 'error', code: 'capability-unavailable', message: 'This board has no modules for "uno_led_set".', blockId: 'led' },
    ]);
    // A board target without the kit (no roles, no pin rules) has the UNO's pins but nothing to check them with.
    const board = { capabilities: ['digital', 'pwm', 'analogIn'], pins: { digital: [], analogIn: [], pwm: [], servo: [] } };
    const pins = { blocks: { blocks: [{ type: 'stem_on_start', id: 'h', inputs: { DO: { block: digitalWrite('A3', 'HIGH', 'write') } } }] } };
    expect(compileYbcProgram(pins, exposed, undefined, board, 'uno').diagnostics).toEqual([
      { severity: 'error', code: 'capability-unavailable', message: '"uno_digital_write" needs the robot\'s kit, to know which pins are free.', blockId: 'write' },
    ]);
  });
});

describe('raw pins (Advanced, contract UNO §9) through the pin rules of the kit', () => {
  it('finds no free PWM pin on ref-uno-rover@0: a PWM write is pin-unavailable on every PWM pin', () => {
    for (const pin of ['D3', 'D5', 'D6', 'D9', 'D10', 'D11']) {
      const result = compileRobot([pwmWrite(pin, num(100), 'pwm')]);
      expect(result.ok, pin).toBe(false);
      expect(diagnosticsOf(result).map((d) => [d.code, d.blockId]), pin).toEqual([['pin-unavailable', 'pwm']]);
    }
    expect(compileRobot([pwmWrite('D5', num(100))]).diagnostics[0]?.message).toBe('pwm.write cannot use D5: port M1 of the kit uses it.');
  });

  it('refuses a pin the kit uses, D0/D1 while the program prints, and a read of a pin no input module is wired to', () => {
    const cases: [Json[], string][] = [
      [[digitalWrite('D13', 'HIGH', 'b')], 'digital.write cannot use D13: port LED1 of the kit uses it.'],
      [[digitalWrite('D0', 'LOW', 'b'), print(text('hi'))], 'digital.write cannot use D0: the program prints, and Serial holds D0 and D1.'],
      [[print(digitalRead('A3', 'b'))], 'digital.read cannot use A3: no input module is wired to it, and a floating pin reads at random.'],
      [[print(analogRead('A4', 'b'))], 'analogIn.read cannot use A4: no module read as analog is wired to it.'],
      [[print(digitalRead('D99', 'b'))], 'digital.read cannot use D99: it is not a pin of uno-r3.'],
    ];
    for (const [blocks, message] of cases) {
      expect(compileRobot(blocks).diagnostics, message).toEqual([{ severity: 'error', code: 'pin-unavailable', message, blockId: 'b' }]);
    }
    // D0 without printing is free.
    expect(compileRobot([digitalWrite('D0', 'LOW')]).ok).toBe(true);
  });

  it('refuses a PWM write on a timer the program’s servo claims (timer-claimed, an error), and allows it without the servo', () => {
    const kit = kitWithout('buzzer');
    const claimed = compileRobot([servoSet('servo1', num(90)), pwmWrite('D10', num(100), 'pwm')], undefined, { kit });
    expect(claimed.diagnostics).toEqual([
      { severity: 'error', code: 'timer-claimed', message: 'PWM on D10 is not possible: the servo holds timer T1 there, so the pin would stay LOW (contract U-48).', blockId: 'pwm' },
    ]);
    expect(claimed.ok).toBe(false);
    expect(compileRobot([pwmWrite('D10', num(100))], undefined, { kit }).ok).toBe(true);
  });

  it('warns not-pwm for a PWM write on a free pin without PWM (a stored program; the dropdown offers PWM pins)', () => {
    const result = compileRobot([pwmWrite('A3', num(200), 'pwm')]);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([{ severity: 'warning', code: 'not-pwm', message: 'A3 has no PWM: pwm.write drives it HIGH from 128 up and LOW below.', blockId: 'pwm' }]);
  });
});

describe('the kit’s own pin rules for what the program uses (hardware/pin-rules.ts checkKit)', () => {
  // A vendor kit with the left motor's EN on D10 (Timer1) and the buzzer on D5: fine until the program uses the servo.
  const kit = derivedKit('test-rover-en-on-d10', (raw) => {
    for (const port of raw.ports) {
      if (port.id === 'M1') {
        port.pins = { ...port.pins, EN: 'D10' };
      } else if (port.id === 'BZ1') {
        port.pins = { PIN: 'D5' };
      }
    }
  });

  it('refuses the servo of a program whose motor needs PWM on the servo’s timer, on the first servo block', () => {
    const result = compileRobot([motorSet('motorLeft', num(50)), servoSet('servo1', num(10), 'servo'), servoSet('servo1', num(20))], undefined, { kit });
    expect(result).toEqual({
      ok: false,
      reason: 'compile',
      diagnostics: [
        { severity: 'error', code: 'timer-claimed', message: 'Port M1 needs PWM on D10, but the servo holds timer T1 there: the pin would stay LOW (contract U-48).', blockId: 'servo' },
      ],
    });
    expect(compileRobot([motorSet('motorLeft', num(50))], undefined, { kit }).ok).toBe(true);
  });
});

describe('the robot’s blocks in their place', () => {
  it('refuses a read as a statement, and a statement as a value', () => {
    expect(codes(compileRobot([ultrasonic('cm')]))).toEqual(['error unsupported-construct cm']);
    expect(codes(compileRobot([setVar('x', driveStop('stop'))]))).toEqual(['error unsupported-construct stop']);
  });

  it('refuses a role the block does not offer, a direction, an on / off and a level that are not its own, and missing fields', () => {
    const cases: [Json, string, string][] = [
      [motorSet('servo1', num(10), 'b'), 'value-out-of-range', '"servo1" is not one of the modules this block offers.'],
      [{ type: 'uno_motor_set', id: 'b', inputs: { SPEED: { block: num(1) } } }, 'malformed-program', 'A robot block needs its module.'],
      [driveMove('up', num(10), 'b'), 'value-out-of-range', 'A direction is forward, backward, spin left or spin right.'],
      [{ type: 'uno_drive_move', id: 'b', inputs: { SPEED: { block: num(1) } } }, 'malformed-program', 'A drive block needs its direction.'],
      [led('DIM', 'b'), 'value-out-of-range', 'An LED is on or off.'],
      [{ type: 'uno_led_set', id: 'b' }, 'malformed-program', 'An LED block needs on or off.'],
      [digitalWrite('A3', 'MAYBE', 'b'), 'value-out-of-range', 'A pin is written HIGH or LOW.'],
      [{ type: 'uno_digital_write', id: 'b', fields: { PIN: 'A3' } }, 'malformed-program', 'A digital write needs HIGH or LOW.'],
      [{ type: 'uno_digital_write', id: 'b', fields: { LEVEL: 'HIGH' } }, 'malformed-program', 'A pin block needs its pin.'],
    ];
    for (const [block, code, message] of cases) {
      expect(compileRobot([block]).diagnostics, message).toEqual([{ severity: 'error', code, message, blockId: 'b' }]);
    }
  });

  it('keeps the Advanced blocks out of Basic (L-2, not-in-profile)', () => {
    for (const block of [print(lineRaw('lineLeft', 'b')), buzzerStop('b'), print(millis('b')), digitalWrite('A3', 'HIGH', 'b')]) {
      const result = compileRobot([block], undefined, { profile: 'uno-basic' });
      expect(result).toMatchObject({ ok: false, reason: 'layer', diagnostics: [{ layer: 'L-2', code: 'not-in-profile', blockId: 'b' }] });
    }
  });
});

describe('compileUnoProject (kit-aware compile: kitBoardContext(resolveBoardContext(…), kit))', () => {
  it('compiles against the kit the project names, the reference kit when it names none, and says what the program uses', () => {
    const result = compileRobot([servoSet('servo1', num(90)), digitalWrite('A3', 'HIGH'), driveMove('forward', num(50)), print(ultrasonic())], [buzzerTone(num(440), num(100))]);
    expect(result.ok && result.kit.id).toBe('ref-uno-rover');
    expect(result.ok && result.uses).toEqual({
      modules: [
        { role: 'servo1', op: 'servo.set' },
        { role: 'drive', op: 'drive.move' },
        { role: 'ultrasonic', op: 'ultrasonic.cm' },
        { role: 'buzzer', op: 'buzzer.tone' },
      ],
      outputPins: ['A3'],
      usage: { servo: true, tone: true, serial: true },
    });
  });

  it('gives the board-context diagnostics of a project without its board', () => {
    const document = unoDocument('uno-basic', { circuit: { components: [], wires: [] } });
    expect(compileUnoProject(document, { registry, profiles: productionProfiles, packs, kits: productionKits })).toEqual({
      ok: false,
      reason: 'layer',
      diagnostics: [{ layer: 'L-3', severity: 'error', code: 'no-board', message: 'The circuit needs a board.', componentIds: [] }],
    });
  });

  it('throws for a project of another family or with a kit the catalog does not know: such a document did not pass L-1', () => {
    expect(() => compileUnoProject(unoDocument('uno-basic', { kit: { id: 'nope', version: '1' } }), { registry, profiles: productionProfiles, packs, kits: productionKits })).toThrow(
      'Unknown kit nope@1',
    );
    expect(() => compileUnoProject({ ...unoDocument(), profile: 'ybc-basic' }, { registry, profiles: productionProfiles, packs, kits: productionKits })).toThrow(/not of the uno family/);
  });
});
