import { describe, expect, it } from 'vitest';
import { kitBoardTarget, unoR3Board } from '../hardware';
import { claw, clawAngle, colorIs, colorRaw, compileRobot, gripperKit, irDetect, lift, liftAngle, onGripper, rover } from './__fixtures__/uno-blocks';
import { num, print, setVar } from './__fixtures__/ybc-blocks';

// N19 A4 (plan §4.3, D-G3, D-G11): the gripper car's blocks in the compiler of the uno family, against ref-uno-gripper@0.

const compiledOk = (result: ReturnType<typeof compileRobot>) => {
  if (!result.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

describe('the claw and the arm (U-35, U-36)', () => {
  it('mở compiles to 0, đóng to 80, nâng to 90, hạ to 0', () => {
    const compiled = compiledOk(compileRobot([claw('OPEN', 'open'), claw('CLOSE', 'close'), lift('UP', 'up'), lift('DOWN', 'down')], undefined, { kit: onGripper, profile: 'uno-basic' }));
    expect(compiled.ir.onStart).toEqual([
      { kind: 'call', op: 'gripper.claw', operand: { kind: 'role', role: 'gripper' }, args: [{ blockId: 'open', type: 'int', kind: 'int', value: 0 }], blockId: 'open' },
      { kind: 'call', op: 'gripper.claw', operand: { kind: 'role', role: 'gripper' }, args: [{ blockId: 'close', type: 'int', kind: 'int', value: 80 }], blockId: 'close' },
      { kind: 'call', op: 'gripper.lift', operand: { kind: 'role', role: 'gripper' }, args: [{ blockId: 'up', type: 'int', kind: 'int', value: 90 }], blockId: 'up' },
      { kind: 'call', op: 'gripper.lift', operand: { kind: 'role', role: 'gripper' }, args: [{ blockId: 'down', type: 'int', kind: 'int', value: 0 }], blockId: 'down' },
    ]);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.uses.usage).toEqual({ servo: true, tone: false, serial: false });
  });

  it('writes a typed-in angle clamped to 0..90 with a value-clamped warning on its block, and keeps a computed one for the run', () => {
    const compiled = compiledOk(compileRobot([clawAngle(num(120), 'wide'), liftAngle(num(-5), 'low'), setVar('x', num(45)), clawAngle(num(45), 'mid')], undefined, { kit: onGripper }));
    const angles = compiled.ir.onStart.map((statement) => (statement.kind === 'call' && 'args' in statement ? statement.args[0] : undefined)).flatMap((arg) => (arg?.kind === 'int' ? [arg.value] : []));
    expect(angles).toEqual([90, 0, 45]);
    expect(compiled.diagnostics).toEqual([
      { severity: 'warning', code: 'value-clamped', message: 'The angle 120 for the gripper is outside 0 to 90, so it is clamped to 90.', blockId: 'wide' },
      { severity: 'warning', code: 'value-clamped', message: 'The angle -5 for the gripper is outside 0 to 90, so it is clamped to 0.', blockId: 'low' },
    ]);
  });

  it('refuses a claw on the rover: capability-unavailable, the kit has no gripper', () => {
    const compiled = compileRobot([claw('CLOSE', 'grab')], undefined, { profile: 'uno-basic' });
    expect(compiled).toMatchObject({
      ok: false,
      diagnostics: [{ severity: 'error', code: 'capability-unavailable', message: '"uno_gripper_claw" needs the gripper, which the kit ref-uno-rover@0 does not have.', blockId: 'grab' }],
    });
  });

  it('refuses a position the block does not have', () => {
    const wrong = compileRobot([{ type: 'uno_gripper_claw', id: 'odd', fields: { STATE: 'HALF' } }], undefined, { kit: onGripper });
    expect(wrong).toMatchObject({ ok: false, diagnostics: [{ severity: 'error', code: 'value-out-of-range', message: 'A claw is open or closed.', blockId: 'odd' }] });
    const missing = compileRobot([{ type: 'uno_gripper_lift', id: 'none' }], undefined, { kit: onGripper });
    expect(missing).toMatchObject({ ok: false, diagnostics: [{ severity: 'error', code: 'malformed-program', message: 'An arm block needs up or down.', blockId: 'none' }] });
  });

  it('takes the claims of the kit’s drivers: the gripper’s two ops take the servo’s timer, the rover’s servo and tone theirs', () => {
    expect(kitBoardTarget(gripperKit, unoR3Board).opClaims).toEqual({ gripper: { 'gripper.claw': 'servo', 'gripper.lift': 'servo' } });
    expect(kitBoardTarget(rover, unoR3Board).opClaims).toEqual({ servo1: { 'servo.set': 'servo' }, buzzer: { 'buzzer.tone': 'tone' } });
  });
});

describe('the IR sensor and the colour sensor (U-37…U-39)', () => {
  it('reads the IR sensor, a colour by its name and a channel by its name', () => {
    const compiled = compiledOk(compileRobot([print(irDetect('ir')), print(colorIs('yellow', 'is')), setVar('x', colorRaw('clear', 'raw'))], undefined, { kit: onGripper }));
    const values = compiled.ir.onStart.map((statement) => (statement.kind === 'print' || statement.kind === 'set' ? statement.value : null));
    expect(values).toEqual([
      { blockId: 'ir', type: 'bool', kind: 'read', op: 'ir.detect', operand: { kind: 'role', role: 'irClaw' } },
      { blockId: 'is', type: 'bool', kind: 'read', op: 'color.is', operand: { kind: 'role', role: 'color1' }, color: 'yellow' },
      { blockId: 'raw', type: 'int', kind: 'read', op: 'color.raw', operand: { kind: 'role', role: 'color1' }, channel: 'clear' },
    ]);
    expect(compiled.uses.modules).toEqual([
      { role: 'irClaw', op: 'ir.detect' },
      { role: 'color1', op: 'color.is' },
      { role: 'color1', op: 'color.raw' },
    ]);
  });

  it('refuses a colour or a channel the sensor does not have', () => {
    expect(compileRobot([print(colorIs('purple', 'odd'))], undefined, { kit: onGripper })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'value-out-of-range', message: 'That is not a colour the colour sensor knows.', blockId: 'odd' }],
    });
    expect(compileRobot([print(colorRaw('alpha', 'odd'))], undefined, { kit: onGripper })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'value-out-of-range', message: 'A channel is red, green, blue or clear.', blockId: 'odd' }],
    });
  });

  it('color.raw is Advanced only', () => {
    expect(compileRobot([print(colorRaw('red', 'raw'))], undefined, { kit: onGripper, profile: 'uno-advanced' }).ok).toBe(true);
    const basic = compileRobot([print(colorRaw('red', 'raw'))], undefined, { kit: onGripper, profile: 'uno-basic' });
    expect(basic.ok).toBe(false);
    expect(basic.diagnostics.map((diagnostic) => [diagnostic.code, 'blockId' in diagnostic ? diagnostic.blockId : undefined])).toEqual([['not-in-profile', 'raw']]);
    // The colour itself is a Basic block.
    expect(compileRobot([print(colorIs('red', 'is'))], undefined, { kit: onGripper, profile: 'uno-basic' }).ok).toBe(true);
  });
});
