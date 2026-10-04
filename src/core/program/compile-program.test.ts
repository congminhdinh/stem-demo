import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import buttonLedSample from '../../samples/button-led.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import disabledHat from './__fixtures__/disabled-hat.json';
import disabledStatement from './__fixtures__/disabled-statement.json';
import duplicateOnStart from './__fixtures__/duplicate-on-start.json';
import ifElseIf from './__fixtures__/if-else-if.json';
import missingCondition from './__fixtures__/missing-condition.json';
import orphanBlock from './__fixtures__/orphan-block.json';
import { compileProgram } from './compile-program';

const boardPins = createDeviceRegistry(localDeviceDefinitions).get('board').board?.pins.map((pin) => pin.name) ?? [];
const ledOnProgram = ledOnSample.program.blocks;
const blink = blinkSample.program.blocks;

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

  describe('if and conditions (M3)', () => {
    const read = (pin: string, id = `read-${pin}`) => ({ type: 'stem_digital_read', id, fields: { PIN: pin } });
    const writeHigh = (pin: string, id = `write-${pin}`) => ({
      type: 'stem_digital_write',
      id,
      fields: { PIN: pin, LEVEL: 'HIGH' },
    });
    /** A forever whose body is one "if" block with these inputs and mutator state. */
    const foreverIf = (inputs: Record<string, unknown>, extraState?: unknown) => ({
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'stem_forever',
            id: 'forever',
            inputs: {
              DO: {
                block: { type: 'controls_if', id: 'if', ...(extraState === undefined ? {} : { extraState }), inputs },
              },
            },
          },
        ],
      },
    });
    const irOf = (program: unknown) => {
      const result = compileProgram(program, boardPins);
      return result.ok ? result.ir : result.diagnostics;
    };

    it('compiles the button-led program: forever, if digital read D2, else (JSON from Blockly)', () => {
      expect(compileProgram(buttonLedSample.program.blocks, boardPins)).toEqual({
        ok: true,
        ir: {
          onStart: [],
          forever: [
            {
              kind: 'if',
              branches: [
                {
                  condition: { kind: 'digitalRead', pin: 'D2', blockId: 'read-d2' },
                  body: [{ kind: 'digitalWrite', pin: 'D13', level: 1, blockId: 'write-high' }],
                },
              ],
              else: [{ kind: 'digitalWrite', pin: 'D13', level: 0, blockId: 'write-low' }],
              blockId: 'if-pressed',
            },
          ],
        },
        diagnostics: [],
      });
    });

    it('compiles else-if branches in order, and not, from extraState elseIfCount and hasElse', () => {
      const notD2 = { kind: 'not', value: { kind: 'digitalRead', pin: 'D2', blockId: 'read-d2' }, blockId: 'not-d2' };

      expect(irOf(ifElseIf)).toEqual({
        onStart: [
          {
            kind: 'if',
            branches: [
              { condition: notD2, body: [{ kind: 'digitalWrite', pin: 'D13', level: 1, blockId: 'write-d13' }] },
              {
                condition: { kind: 'digitalRead', pin: 'D3', blockId: 'read-d3' },
                body: [{ kind: 'digitalWrite', pin: 'D12', level: 1, blockId: 'write-d12' }],
              },
            ],
            else: [{ kind: 'digitalWrite', pin: 'D11', level: 1, blockId: 'write-d11' }],
            blockId: 'if-else-if',
          },
        ],
        forever: null,
      });
    });

    it('reads an "if" without extraState as no else-if and no else; an absent body is empty', () => {
      expect(irOf(foreverIf({ IF0: { block: read('D2') }, ELSE: { block: writeHigh('D13') } }))).toEqual({
        onStart: [],
        forever: [
          {
            kind: 'if',
            branches: [{ condition: { kind: 'digitalRead', pin: 'D2', blockId: 'read-D2' }, body: [] }],
            // Without hasElse a stray ELSE input is not part of the block.
            else: [],
            blockId: 'if',
          },
        ],
      });
    });

    it('nests an "if" inside a branch', () => {
      const inner = {
        type: 'controls_if',
        id: 'inner',
        inputs: { IF0: { block: read('D3') }, DO0: { block: writeHigh('D13') } },
      };

      expect(irOf(foreverIf({ IF0: { block: read('D2') }, DO0: { block: inner } }))).toMatchObject({
        forever: [{ branches: [{ body: [{ kind: 'if', blockId: 'inner' }] }] }],
      });
    });

    it('uses a shadow block as the condition until a real block covers it, as Blockly does', () => {
      const shadowOnly = foreverIf({ IF0: { shadow: read('D2', 'shadow') } });
      const covered = foreverIf({ IF0: { shadow: read('D2', 'shadow'), block: read('D3', 'real') } });

      expect(irOf(shadowOnly)).toMatchObject({ forever: [{ branches: [{ condition: { blockId: 'shadow' } }] }] });
      expect(irOf(covered)).toMatchObject({ forever: [{ branches: [{ condition: { blockId: 'real' } }] }] });
    });

    it.each<[string, unknown, string]>([
      ['an "if" with an empty condition (as Blockly saves it)', missingCondition, 'empty-if'],
      ['an empty else-if condition', foreverIf({ IF0: { block: read('D2') } }, { elseIfCount: 1 }), 'if'],
      ['a not with nothing in it', foreverIf({ IF0: { block: { type: 'logic_negate', id: 'not' } } }), 'not'],
      [
        'a disabled condition block',
        foreverIf({ IF0: { block: { ...read('D2'), disabledReasons: ['MANUALLY_DISABLED'] } } }),
        'if',
      ],
    ])('refuses %s: a missing condition is an error, never a silent false (C8)', (_, program, blockId) => {
      expect(compileProgram(program, boardPins)).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ severity: 'error', code: 'missing-condition', blockId })],
      });
    });

    const withState = (extraState: unknown) => foreverIf({ IF0: { block: read('D2') } }, extraState);

    it.each<[string, unknown, string, string]>([
      ['a digital read of a pin the board lacks', foreverIf({ IF0: { block: read('D99') } }), 'unknown-pin', 'read-D99'],
      [
        'a condition block the compiler does not know',
        foreverIf({ IF0: { block: { type: 'logic_boolean', id: 'true', fields: { BOOL: 'TRUE' } } } }),
        'unknown-block',
        'true',
      ],
      [
        'a digital read without a pin',
        foreverIf({ IF0: { block: { type: 'stem_digital_read', id: 'read', fields: {} } } }),
        'malformed-program',
        'read',
      ],
      ['a condition input that is not an object', foreverIf({ IF0: 7 }), 'malformed-program', 'if'],
      ['an extraState that is not an object', withState(7), 'malformed-program', 'if'],
      ['a negative else-if count', withState({ elseIfCount: -1 }), 'malformed-program', 'if'],
      ['a fractional else-if count', withState({ elseIfCount: 0.5 }), 'malformed-program', 'if'],
      ['a hasElse that is not a boolean', withState({ hasElse: 'yes' }), 'malformed-program', 'if'],
    ])('reports %s on that block', (_, program, code, blockId) => {
      expect(compileProgram(program, boardPins)).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ severity: 'error', code, blockId })],
      });
    });

    it('stops at the inputs there are for a huge else-if count, instead of looping on', () => {
      expect(compileProgram(withState({ elseIfCount: 1e9 }), boardPins)).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'missing-condition', blockId: 'if' })],
      });
    });

    it('reports a program nested too deeply instead of overflowing the stack (C4)', () => {
      let condition: Record<string, unknown> = read('D2');
      for (let depth = 0; depth < 100_000; depth++) {
        condition = { type: 'logic_negate', id: `not-${depth}`, inputs: { BOOL: { block: condition } } };
      }
      const compile = () => compileProgram(foreverIf({ IF0: { block: condition } }), boardPins);

      expect(compile).not.toThrow();
      expect(compile()).toEqual({
        ok: false,
        diagnostics: [
          expect.objectContaining({ code: 'malformed-program', message: 'The program is nested too deeply.' }),
        ],
      });
    });
  });
});
