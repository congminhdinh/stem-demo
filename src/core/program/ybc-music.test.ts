import { describe, expect, it } from 'vitest';
import type { Capabilities } from '../capabilities/io';
import { melodyModes, melodyNames, melodyType, pitchType, soundStopType } from '../constructs/ybc.sound';
import { boardTargetOf } from '../devices/board-pins';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { capabilitiesOf } from '../profiles/board-context';
import { add, num, playMelody, playNote, playPitch, program, stopSound, text, type Json } from './__fixtures__/ybc-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram, type YbcCompileResult } from './compile-ybc-program';
import type { YbcProgramIR } from './ybc-ir';

// N17 B3: the melody, tone and stop blocks of the Advanced board, from the JSON Blockly saves to the IR, and what the interpreter
// asks of the buzzer. The melody and its mode are fields of the block, so they are an operand the compiler checks; the Hz and the
// ms of a tone are int expressions, checked against 20..20000 and 0..60000 when typed in and when the program runs.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const advanced = packs.typesOf(productionProfiles.get('ybc-advanced')?.blockPacks ?? []);
const basic = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
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

describe('the music blocks', () => {
  it('are the three of the brief, named as it names them', () => {
    expect([melodyType, pitchType, soundStopType]).toEqual(['ybc_sound_melody', 'ybc_sound_pitch', 'ybc_sound_stop']);
    expect([...melodyModes]).toEqual(['wait', 'background']);
    expect(melodyNames).toHaveLength(20);
  });
});

describe('compiling them (C-20, C-21, C-22)', () => {
  it.each([
    ['wait', true],
    ['background', false],
  ] as const)('turns "play melody BIRTHDAY" %s into a call whose operand is the melody and wait=%s', (mode, wait) => {
    const block = playMelody('BIRTHDAY', mode);
    expect(compiled([block]).onStart).toEqual([{ kind: 'call', op: 'sound.playMelody', operand: { kind: 'melody', melody: 'BIRTHDAY', wait }, blockId: block.id }]);
  });

  it('accepts every melody of the dropdown', () => {
    const statements = compiled(melodyNames.map((name) => playMelody(name, 'background'))).onStart;
    expect(statements.map((statement) => (statement.kind === 'call' && statement.op === 'sound.playMelody' ? statement.operand.melody : null))).toEqual([...melodyNames]);
  });

  it('turns "start tone" into a call with the Hz and the ms as arguments, in that order', () => {
    const hz = num(440);
    const ms = num(500);
    const block = playPitch(hz, ms);
    expect(compiled([block]).onStart).toEqual([
      {
        kind: 'call',
        op: 'sound.pitch',
        args: [{ blockId: hz.id, type: 'int', kind: 'int', value: 440 }, { blockId: ms.id, type: 'int', kind: 'int', value: 500 }],
        blockId: block.id,
      },
    ]);
  });

  it('turns "stop sound" into a call with nothing', () => {
    const block = stopSound();
    expect(compiled([block]).onStart).toEqual([{ kind: 'call', op: 'sound.stop', blockId: block.id }]);
  });

  it('accepts the bounds of a tone: 20 and 20000 Hz, 0 and 60000 ms', () => {
    expect(compile([playPitch(num(20), num(0)), playPitch(num(20000), num(60000))]).ok).toBe(true);
  });

  it.each([
    [19, 100, 'The frequency must be between 20 and 20000.'],
    [20001, 100, 'The frequency must be between 20 and 20000.'],
    [440, -1, 'The length of a tone must be between 0 and 60000.'],
    [440, 60001, 'The length of a tone must be between 0 and 60000.'],
  ])('refuses a typed-in %i Hz for %i ms: value-out-of-range', (hz, ms, message) => {
    const result = compile([playPitch(num(hz), num(ms))]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message])).toEqual([['value-out-of-range', message]]);
  });

  it('needs whole numbers: a text in the Hz input is a type mismatch, an empty input a missing one', () => {
    expect(codes(compile([playPitch(text('440'), num(100))]))).toEqual(['type-mismatch']);
    expect(codes(compile([{ ...playPitch(num(440), num(100)), inputs: { HZ: { block: num(440) } } }]))).toEqual(['missing-input']);
  });

  it.each([
    ['a melody that is not one of the twenty', playMelody('GREENSLEEVES', 'wait')],
    ['a name in lower case', playMelody('birthday', 'wait')],
    ['a mode that is neither', playMelody('ODE', 'loop')],
  ])('refuses %s: value-out-of-range', (_name, block) => {
    expect(codes(compile([block]))).toEqual(['value-out-of-range']);
  });

  it.each([
    ['without its melody', { type: melodyType, id: 'm', fields: { MODE: 'wait' } }],
    ['without its mode', { type: melodyType, id: 'm', fields: { MELODY: 'ODE' } }],
  ])('refuses a melody block %s: malformed-program', (_name, block) => {
    expect(codes(compile([block]))).toEqual(['malformed-program']);
  });

  it('refuses them on a board without a buzzer: capability-unavailable', () => {
    const silent = { ...target, capabilities: target.capabilities.filter((capability) => capability !== 'sound') };
    for (const block of [playMelody('ODE', 'wait'), playPitch(num(440), num(100)), stopSound()]) {
      expect(codes(compile([block], advanced, silent)), String(block.type)).toEqual(['capability-unavailable']);
    }
  });

  it('are not Basic blocks: a Basic program with one does not compile', () => {
    for (const block of [playMelody('ODE', 'wait'), playPitch(num(440), num(100)), stopSound()]) {
      expect(codes(compile([block], basic)), String(block.type)).toEqual(['unknown-block']);
    }
  });
});

describe('the buzzer they drive (one sound at a time)', () => {
  /** Runs with a buzzer that logs; the fake sleep does not wait, so only what a blocking statement asks is seen. */
  async function sounds(statements: Json[]) {
    const log: string[] = [];
    let on = false;
    const capabilities: Capabilities = {
      sound: {
        startTone(hz) {
          // A tone never starts over another: the one that plays is stopped first.
          log.push(on ? `start ${hz} OVER ANOTHER` : `start ${hz}`);
          on = true;
        },
        stopTone() {
          log.push(on ? 'stop' : 'stop NOTHING');
          on = false;
        },
      },
    };
    // No timers: what plays in the background is the session tests' (run-session.music); here only what the statements ask.
    const scheduler = { schedule: () => () => undefined, dispose: () => undefined, disposed: false };
    const run = runYbc(compiled(statements), { sleep: () => Promise.resolve(), console: { write: () => undefined }, yieldNow: () => Promise.resolve(), scheduler }, capabilities);
    const outcome = await run.done;
    run.stop();
    return { log, outcome };
  }

  it('plays a melody that waits note by note, each note stopped before the next starts, and silent at the end', async () => {
    const { log, outcome } = await sounds([playMelody('JUMP_UP', 'wait')]);
    expect(outcome.status).toBe('finished');
    expect(log).toEqual(['start 523', 'stop', 'start 587', 'stop', 'start 659', 'stop', 'start 698', 'stop', 'start 784', 'stop']);
  });

  it('stops a tone before a note, and stop only stops what plays', async () => {
    const { log } = await sounds([stopSound(), playPitch(num(440), num(100)), playNote('C4', 1), stopSound()]);
    expect(log).toEqual(['start 440', 'stop', 'start 262', 'stop']);
  });

  it('runs a computed tone inside the domain', async () => {
    const { log, outcome } = await sounds([playPitch(add(num(400), num(40)), add(num(100), num(0)))]);
    expect(outcome.status).toBe('finished');
    expect(log[0]).toBe('start 440');
  });

  it('a tone of 0 ms starts nothing', async () => {
    const { log } = await sounds([playPitch(num(440), num(0))]);
    expect(log).toEqual([]);
  });

  it.each([
    [add(num(19), num(0)), num(10), 'The frequency must be between 20 and 20000, not 19.'],
    [num(440), add(num(60001), num(0)), 'The length of a tone must be between 0 and 60000, not 60001.'],
  ])('ends with out-of-domain for a computed value outside the domain, at the block of the value', async (hz, ms, message) => {
    const { outcome, log } = await sounds([playPitch(hz, ms)]);
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', message });
    expect(log).toEqual([]);
  });
});
