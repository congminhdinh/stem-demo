import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import type { RunWarning } from '../capabilities/services';
import { evaluatePred, isExposable, exposureViolations } from '../compat/contract-validation';
import { yolobitContract } from '../compat/yolobit-contract';
import {
  PWM_MAX,
  SERVO_MAX_ANGLE,
  pinCapabilityOfBlock,
  pinOutputConstructs,
  pinWriteAnalogType,
  pwmPackId,
  servoWriteType,
} from '../constructs/ybc.pins';
import { boardTargetOf, noBoardTarget } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import { add, getVar, num, program, setVar, text, type Json } from './__fixtures__/ybc-blocks';
import { pinWriteAnalog, servoWrite } from './__fixtures__/ybc-pin-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import { buildToolbox, createBlockPackCatalog } from './block-packs';
import { createRunConsole } from './console';
import { compileYbcProgram, type YbcCompileResult } from './compile-ybc-program';
import type { YbcProgramIR } from './ybc-ir';

// N17 B5: "analog write" (PWM, C-26) and "servo" (C-27) on P0–P2, the Advanced board's own pack. From the JSON Blockly saves to
// the IR, and what the interpreter asks of the board: the pin and the value are evaluated in that order, each once; a value
// outside 0..1023 (PWM) or 0..180 (servo) is clamped, and the run is warned once per pin and kind, never stopped.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const profile = (id: string) => {
  const found = productionProfiles.get(id);
  if (!found) {
    throw new Error(`No profile ${id}`);
  }
  return found;
};
const advanced = packs.typesOf(profile('ybc-advanced').blockPacks);
const basic = packs.typesOf(profile('ybc-basic').blockPacks);
const board = registry.get('ybc-board');
const target = boardTargetOf(board, capabilitiesOf(board));
const compile = (statements: Json[], exposed = advanced, onBoard = target): YbcCompileResult =>
  compileYbcProgram(program(statements, undefined, ['x']), exposed, undefined, onBoard);
const codes = (result: YbcCompileResult) => result.diagnostics.map((diagnostic) => diagnostic.code);

function compiled(statements: Json[]): YbcProgramIR {
  const result = compile(statements);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }
  return result.ir;
}

const row = (id: string) => {
  const found = yolobitContract.constructs.find((construct) => construct.id === id);
  if (!found) {
    throw new Error(`No contract row ${id}`);
  }
  return found;
};

describe('the two blocks and their pack', () => {
  it('are named as the brief names them, with the contract\'s ranges', () => {
    expect([pinWriteAnalogType, servoWriteType]).toEqual(['ybc_pin_write_analog', 'ybc_servo_write']);
    expect([PWM_MAX, SERVO_MAX_ANGLE]).toEqual([1023, 180]);
    expect(pinOutputConstructs.map((construct) => [construct.contractId, construct.blockTypes, construct.requires])).toEqual([
      ['C-26', [pinWriteAnalogType], 'pwm'],
      ['C-27', [servoWriteType], 'servo'],
    ]);
    expect(pinCapabilityOfBlock.get(pinWriteAnalogType)).toBe('pwm');
    expect(pinCapabilityOfBlock.get(servoWriteType)).toBe('servo');
  });

  it('live in a pack of their own that only the Advanced profile lists; Basic is as it was', () => {
    expect(pwmPackId).toBe('ybc.pwm');
    expect(packs.get(pwmPackId)?.blockTypes).toEqual([pinWriteAnalogType, servoWriteType]);
    expect(profile('ybc-advanced').blockPacks).toContain(pwmPackId);
    expect(profile('ybc-basic').blockPacks).not.toContain(pwmPackId);
    expect(profile('ybc-advanced').constructs).toEqual(expect.arrayContaining(['C-26', 'C-27']));
    expect(profile('ybc-basic').constructs).not.toContain('C-26');
    expect(profile('ybc-basic').constructs).not.toContain('C-27');
  });

  it('join the Pins category of the Advanced toolbox, after the three of Basic, with 512 and 90 to start from', () => {
    const pins = buildToolbox(profile('ybc-advanced').blockPacks, packs).contents.find((category) => category.name === 'Pins');
    const types = (pins?.contents ?? []).map((item) => (item as { type: string }).type);
    expect(types).toEqual(['ybc_pin_write', 'ybc_pin_read', 'ybc_pin_analog', pinWriteAnalogType, servoWriteType]);
    expect(pins?.contents?.[3]).toMatchObject({ inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 512 } } } } });
    expect(pins?.contents?.[4]).toMatchObject({ inputs: { ANGLE: { shadow: { type: 'math_number', fields: { NUM: 90 } } } } });
    const basicPins = buildToolbox(profile('ybc-basic').blockPacks, packs).contents.find((category) => category.name === 'Pins');
    expect((basicPins?.contents ?? []).map((item) => (item as { type: string }).type)).toEqual(['ybc_pin_write', 'ybc_pin_read', 'ybc_pin_analog']);
  });

  it('offer the pins P0, P1 and P2, each with a whole-number input', () => {
    const definitions = packs.get(pwmPackId)?.blocks ?? [];
    expect(definitions.map((definition) => definition.type)).toEqual([pinWriteAnalogType, servoWriteType]);
    for (const definition of definitions) {
      const args = (definition as unknown as { args0: { type: string; name: string; options?: string[][]; check?: string }[] }).args0;
      expect(args.find((arg) => arg.name === 'PIN')?.options).toEqual([
        ['P0', 'P0'],
        ['P1', 'P1'],
        ['P2', 'P2'],
      ]);
      expect(args.find((arg) => arg.type === 'input_value')?.check).toBe('Number');
    }
  });

  it('are opened in the contract: C-26 RESTRICTED for Advanced with what is UNVERIFIED named, C-27 clamped by the generator', () => {
    const pwm = row('C-26');
    expect(pwm.eligibility).toBe('RESTRICTED');
    expect(pwm.profiles).toEqual(['ybc-advanced']);
    expect(pwm.python).toEqual({ form: 'pin<N>.write_analog(<value>)', builtins: ['min', 'max'] });
    expect(Object.keys(pwm.unverifiedFields ?? {}).sort()).toEqual(['block', 'content', 'range']);
    expect(exposureViolations(pwm, yolobitContract)).toEqual([]);
    expect(isExposable(pwm, yolobitContract)).toBe(true);
    const servo = row('C-27');
    expect(servo.python).toEqual({ form: 'pin<N>.servo_write(<angle>)', builtins: ['min', 'max'] });
    expect(servo.fields.clamp).toMatchObject({ label: 'n/a', reason: 'explicit-parameter' });
    expect(pwm.fields.clamp).toMatchObject({ label: 'n/a', reason: 'explicit-parameter' });
    expect(isExposable(servo, yolobitContract)).toBe(true);
  });

  it('have a domain of the pins only: a value outside its range is clamped, not refused', () => {
    for (const [id, name] of [['C-26', 'value'], ['C-27', 'angle']] as const) {
      const domain = row(id).domain;
      for (const pin of [-1, 0, 1, 2, 3]) {
        for (const value of [-5, 0, 90, 1023, 5000]) {
          expect(evaluatePred(domain?.runtime ?? { all: [] }, { values: { pin, [name]: value } }), `${id} pin ${pin} ${name} ${value}`).toBe(pin >= 0 && pin <= 2);
        }
      }
    }
  });
});

describe('compiling them (C-26, C-27)', () => {
  it('turns "analog write pin P0 value 512" into a pin call: the pin and the value, in that order', () => {
    const value = num(512);
    const block = pinWriteAnalog('P0', value);
    expect(compiled([block]).onStart).toEqual([
      {
        kind: 'call',
        op: 'pwm.write',
        args: [{ blockId: block.id, type: 'int', kind: 'int', value: 0 }, { blockId: value.id, type: 'int', kind: 'int', value: 512 }],
        blockId: block.id,
      },
    ]);
  });

  it('turns "servo pin P1 turn to 90" into a pin call: the pin and the angle, in that order', () => {
    const angle = num(90);
    const block = servoWrite('P1', angle);
    expect(compiled([block]).onStart).toEqual([
      {
        kind: 'call',
        op: 'servo.write',
        args: [{ blockId: block.id, type: 'int', kind: 'int', value: 1 }, { blockId: angle.id, type: 'int', kind: 'int', value: 90 }],
        blockId: block.id,
      },
    ]);
  });

  it('accepts a typed-in value outside the range, and a computed one: the run clamps it, with a warning', () => {
    expect(compile([pinWriteAnalog('P2', num(2000)), pinWriteAnalog('P2', num(-5)), servoWrite('P0', num(200)), servoWrite('P0', num(-1))]).ok).toBe(true);
    expect(compile([setVar('x', num(3)), pinWriteAnalog('P1', add(getVar('x'), num(1))), servoWrite('P2', getVar('x'))]).ok).toBe(true);
  });

  it('refuses a text, a missing value, a pin outside P0–P2 and a board without the capability', () => {
    expect(codes(compile([pinWriteAnalog('P0', text('a'))]))).toEqual(['type-mismatch']);
    expect(codes(compile([{ type: servoWriteType, id: 'no-angle', fields: { PIN: 'P0' } }]))).toEqual(['missing-input']);
    expect(codes(compile([pinWriteAnalog('P3', num(1))]))).toEqual(['value-out-of-range']);
    expect(codes(compile([servoWrite('P0', num(1))], advanced, noBoardTarget))).toEqual(['capability-unavailable']);
    const digitalOnly = { ...target, capabilities: target.capabilities.filter((id) => id !== 'pwm' && id !== 'servo') };
    expect(codes(compile([pinWriteAnalog('P0', num(1)), servoWrite('P0', num(1))], advanced, digitalOnly))).toEqual(['capability-unavailable', 'capability-unavailable']);
  });

  it('are not blocks of the Basic profile', () => {
    expect(basic.has(pinWriteAnalogType)).toBe(false);
    expect(basic.has(servoWriteType)).toBe(false);
    expect(codes(compile([pinWriteAnalog('P0', num(512)), servoWrite('P1', num(90))], basic))).toEqual(['unknown-block', 'unknown-block']);
  });
});

describe('running them', () => {
  function runWith(statements: Json[]) {
    const calls: string[] = [];
    const warnings: RunWarning[] = [];
    const capabilities: Capabilities = {
      pwm: { pwmWrite: (pin, duty) => void calls.push(`pwm ${pin} ${duty}`) },
      servo: { servoWrite: (pin, angle) => void calls.push(`servo ${pin} ${angle}`) },
    };
    const running = runYbc(
      compiled(statements),
      { sleep: () => Promise.resolve(), console: createRunConsole(), warn: (warning) => void warnings.push(warning) },
      capabilities,
    );
    return { done: running.done, calls, warnings };
  }

  it('asks the board for the duty and the angle the program wrote', async () => {
    const run = runWith([pinWriteAnalog('P0', num(512)), servoWrite('P1', num(90)), pinWriteAnalog('P2', num(0)), servoWrite('P2', num(180))]);
    expect(await run.done).toEqual({ status: 'finished' });
    expect(run.calls).toEqual(['pwm P0 512', 'servo P1 90', 'pwm P2 0', 'servo P2 180']);
    expect(run.warnings).toEqual([]);
  });

  it('clamps a value outside its range and warns once per pin and kind in the run; the program goes on', async () => {
    const run = runWith([
      pinWriteAnalog('P0', num(2000)),
      pinWriteAnalog('P0', num(-5)),
      pinWriteAnalog('P0', num(4000)),
      servoWrite('P1', num(200)),
      servoWrite('P1', num(-30)),
      pinWriteAnalog('P1', num(1024)),
    ]);
    expect(await run.done).toEqual({ status: 'finished' });
    expect(run.calls).toEqual(['pwm P0 1023', 'pwm P0 0', 'pwm P0 1023', 'servo P1 180', 'servo P1 0', 'pwm P1 1023']);
    expect(run.warnings).toEqual([
      { code: 'value-clamped', message: 'The analog value 2000 for P0 is outside 0 to 1023, so it is clamped to 1023.' },
      { code: 'value-clamped', message: 'The servo angle 200 for P1 is outside 0 to 180, so it is clamped to 180.' },
      { code: 'value-clamped', message: 'The analog value 1024 for P1 is outside 0 to 1023, so it is clamped to 1023.' },
    ]);
  });

  it('evaluates a computed value once, then clamps it', async () => {
    const run = runWith([setVar('x', num(250)), servoWrite('P2', add(getVar('x'), num(1))), pinWriteAnalog('P2', add(getVar('x'), getVar('x')))]);
    expect(await run.done).toEqual({ status: 'finished' });
    expect(run.calls).toEqual(['servo P2 180', 'pwm P2 500']);
    expect(run.warnings.map((warning) => warning.message)).toEqual(['The servo angle 251 for P2 is outside 0 to 180, so it is clamped to 180.']);
  });

  it('is an internal error, never a crash, on a board that does not offer the capability', async () => {
    const running = runYbc(compiled([servoWrite('P0', num(10))]), { sleep: () => Promise.resolve(), console: createRunConsole() }, {});
    expect(await running.done).toMatchObject({ status: 'error', code: 'internal-error' });
  });
});
