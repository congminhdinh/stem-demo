import { describe, expect, it } from 'vitest';
import ledOnSample from '../../samples/led-on.project.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import blink from './__fixtures__/blink.json';
import disabledHat from './__fixtures__/disabled-hat.json';
import disabledStatement from './__fixtures__/disabled-statement.json';
import duplicateOnStart from './__fixtures__/duplicate-on-start.json';
import orphanBlock from './__fixtures__/orphan-block.json';
import { compileProgram } from './compile-program';

const boardPins = createDeviceRegistry(localDeviceDefinitions).get('board').board?.pins.map((pin) => pin.name) ?? [];
const ledOnProgram = ledOnSample.program.blocks;

/** Programs Blockly itself would not produce, but stored or imported data can contain. */
const edited = (program: unknown, from: string, to: string): unknown =>
  JSON.parse(JSON.stringify(program).replace(from, to));

describe('compileProgram', () => {
  it('compiles "on start: digital write D13 HIGH" (Minimum Proof)', () => {
    expect(compileProgram(ledOnProgram, boardPins)).toEqual({
      ok: true,
      ir: {
        onStart: [{ kind: 'digitalWrite', pin: 'D13', level: 1, blockId: 'write-d13-high' }],
        forever: null,
      },
      diagnostics: [],
    });
  });

  it('compiles a blink loop of writes and waits', () => {
    expect(compileProgram(blink, boardPins)).toEqual({
      ok: true,
      ir: {
        onStart: [],
        forever: [
          { kind: 'digitalWrite', pin: 'D13', level: 1, blockId: 'write-high' },
          { kind: 'wait', ms: 1000, blockId: 'wait-on' },
          { kind: 'digitalWrite', pin: 'D13', level: 0, blockId: 'write-low' },
          { kind: 'wait', ms: 1000, blockId: 'wait-off' },
        ],
      },
      diagnostics: [],
    });
  });

  it('treats an empty workspace as an empty program', () => {
    expect(compileProgram({}, boardPins)).toEqual({
      ok: true,
      ir: { onStart: [], forever: null },
      diagnostics: [],
    });
  });

  it('ignores blocks outside on start and forever, with a warning', () => {
    const result = compileProgram(orphanBlock, boardPins);

    expect(result.ok && result.ir.onStart.map((statement) => statement.blockId)).toEqual(['write-d13-high']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'ignored-block', blockId: 'orphan-write' }),
    ]);
  });

  it.each([
    ['a second on start', duplicateOnStart, 'duplicate-hat', 'second-on-start'],
    ['a pin the board does not have', edited(ledOnProgram, '"D13"', '"D99"'), 'unknown-pin', 'write-d13-high'],
    ['an unknown block type', edited(ledOnProgram, 'stem_digital_write', 'stem_servo'), 'unknown-block', 'write-d13-high'],
  ])('rejects %s with an error on that block', (_, program, code, blockId) => {
    const result = compileProgram(program, boardPins);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code, blockId })]);
  });

  it('treats a negative wait as 0 ms', () => {
    const result = compileProgram(edited(blink, '"SECONDS":1', '"SECONDS":-2'), boardPins);

    expect(result.ok && result.ir.forever?.[1]).toEqual({ kind: 'wait', ms: 0, blockId: 'wait-on' });
  });

  it('skips a disabled statement but still runs the blocks after it', () => {
    expect(compileProgram(disabledStatement, boardPins)).toEqual({
      ok: true,
      ir: { onStart: [], forever: [{ kind: 'wait', ms: 1000, blockId: 'wait-after' }] },
      diagnostics: [],
    });
  });

  it('drops the whole stack of a disabled hat, without any diagnostic', () => {
    expect(compileProgram(disabledHat, boardPins)).toEqual({
      ok: true,
      ir: { onStart: [], forever: [{ kind: 'wait', ms: 1000, blockId: 'wait-in-forever' }] },
      diagnostics: [],
    });
  });

  it('treats an absent statement input as an empty body', () => {
    expect(compileProgram({ blocks: { blocks: [{ type: 'stem_on_start', id: 'hat' }] } }, boardPins)).toEqual({
      ok: true,
      ir: { onStart: [], forever: null },
      diagnostics: [],
    });
  });

  const onStartWith = (input: unknown) => ({
    blocks: { blocks: [{ type: 'stem_on_start', id: 'hat', inputs: { DO: input } }] },
  });

  it.each<[string, unknown, string]>([
    [
      'a PIN that is an object',
      onStartWith({ block: { type: 'stem_digital_write', id: 'write', fields: { PIN: { toString: 0 }, LEVEL: 'HIGH' } } }),
      'write',
    ],
    ['a statement input that is not an object', onStartWith(7), 'hat'],
    ['a wait without its SECONDS field', onStartWith({ block: { type: 'stem_wait', id: 'wait', fields: {} } }), 'wait'],
    [
      'a wait whose SECONDS is not a number',
      onStartWith({ block: { type: 'stem_wait', id: 'wait', fields: { SECONDS: '1' } } }),
      'wait',
    ],
    [
      'disabledReasons that are not a list',
      onStartWith({ block: { type: 'stem_wait', id: 'wait', disabledReasons: 'MANUALLY_DISABLED', fields: { SECONDS: 1 } } }),
      'wait',
    ],
  ])('reports %s as malformed on that block instead of throwing or ignoring it', (_, program, blockId) => {
    const compile = () => compileProgram(program, boardPins);

    expect(compile).not.toThrow();
    expect(compile()).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ severity: 'error', code: 'malformed-program', blockId })],
    });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'on start'],
    ['an array', []],
    ['blocks that are not a list', { blocks: 'nope' }],
    ['a block without a type', { blocks: { blocks: [{ id: 'no-type' }] } }],
    ['inputs that are not an object', { blocks: { blocks: [{ type: 'stem_on_start', id: 'hat', inputs: 'nope' }] } }],
    [
      'a broken next link',
      {
        blocks: {
          blocks: [
            {
              type: 'stem_on_start',
              id: 'hat',
              inputs: {
                DO: { block: { type: 'stem_digital_write', id: 'write', fields: { PIN: 'D13', LEVEL: 'HIGH' }, next: 7 } },
              },
            },
          ],
        },
      },
    ],
  ])('reports %s as a malformed program without throwing', (_, program) => {
    const result = compileProgram(program, boardPins);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'malformed-program' }));
  });
});
