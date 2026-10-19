import { describe, expect, it } from 'vitest';
import { melodyNames } from '../../constructs/ybc.sound';
import { add, getVar, mul, num, playMelody, playNote, playPitch, program, stopSound } from '../../program/__fixtures__/ybc-blocks';
import type { YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
import { compileBlocks } from './__fixtures__/compile-case';
import { generateYbcMicroPython } from './generate';

// N17 B3: the Python of the built-in melodies, the tone and stop. The forms (docs/yolobit-compatibility-contract.md §25):
//   music.play(music.DADADADUM, wait=False)     VERIFIED (V·G, investigation §5.3 verbatim); the other 13 names of the editor's
//                                               list (contract §14) in the same form likewise
//   music.play(music.BIRTHDAY, wait=True)       UNVERIFIED: wait=True was seen for a note (C-50), not with a melody
//   music.play(music.FUNK, wait=False)          UNVERIFIED for FUNK, BLUES, FUNERAL, PUNCHLINE, BADDY, BA_DING: micro:bit names that
//                                               the editor's list did not show
//   music.pitch(440, 500)                       call V·G (EVD-03, C-21's observed Python); does not wait (V·S EVD-06)
//   music.stop()                                call V·G (EVD-03, C-22's observed Python)
// They need `import music` and the tempo line, as a note does (IM-3, IM-4).

const source = (blocks: unknown): string => {
  const generated = generateYbcMicroPython(compileBlocks(blocks));
  if (!generated.ok) {
    throw new Error(JSON.stringify(generated.diagnostics));
  }
  return generated.source;
};
const musicLines = (blocks: unknown) => source(blocks).split('\n').filter((line) => /^\s*music\.(play|pitch|stop)/.test(line));

describe('a built-in melody', () => {
  it.each([...melodyNames])('%s is written by its name, wait=False in the background and wait=True until done', (name) => {
    expect(musicLines(program([playMelody(name, 'background'), playMelody(name, 'wait')]))).toEqual([
      `music.play(music.${name}, wait=False)`,
      `music.play(music.${name}, wait=True)`,
    ]);
  });

  it('writes the verified line of the investigation exactly', () => {
    expect(musicLines(program([playMelody('DADADADUM', 'background')]))).toEqual(['music.play(music.DADADADUM, wait=False)']);
  });
});

describe('a tone and stop', () => {
  it('writes music.pitch(hz, ms) with the numbers as typed, Hz first', () => {
    expect(musicLines(program([playPitch(num(440), num(500))]))).toEqual(['music.pitch(440, 500)']);
    expect(musicLines(program([playPitch(num(20), num(0)), playPitch(num(20000), num(60000))]))).toEqual(['music.pitch(20, 0)', 'music.pitch(20000, 60000)']);
  });

  it('writes a computed pitch as its expression; the simulator checks its domain when it runs', () => {
    expect(musicLines(program([playPitch(add(mul(getVar('x'), num(10)), num(200)), getVar('y'))]))).toEqual(['music.pitch(x * 10 + 200, y)']);
  });

  it('writes music.stop()', () => {
    expect(musicLines(program([stopSound()]))).toEqual(['music.stop()']);
  });
});

describe('the modules', () => {
  it.each([
    ['a melody', playMelody('ODE', 'wait')],
    ['a tone', playPitch(num(440), num(100))],
    ['stop', stopSound()],
  ])('%s alone imports music and fixes the tempo, and needs nothing of yolobit', (_name, block) => {
    const lines = source(program([block])).split('\n');
    expect(lines.slice(1, 4)).toEqual(['import time', 'import music', 'music.set_tempo(4, 120)']);
    expect(lines).not.toContain('from yolobit import *');
  });

  it('a note and a melody share the one header', () => {
    const lines = source(program([playNote('C4', 1), playMelody('ODE', 'wait')])).split('\n');
    expect(lines.filter((line) => line === 'import music')).toHaveLength(1);
    expect(lines.filter((line) => line === 'music.set_tempo(4, 120)')).toHaveLength(1);
  });
});

describe('IR that is not the compiler’s own is refused, never written half', () => {
  const forged = (statement: unknown): YbcProgramIR => ({ onStart: [statement as YbcStatement], forever: null, variables: [] });
  const int = (value: number) => ({ kind: 'int', type: 'int', value, blockId: 'n' });

  it.each([
    ['an unknown melody', { kind: 'call', op: 'sound.playMelody', operand: { kind: 'melody', melody: 'GREENSLEEVES', wait: true }, blockId: 'm' }],
    ['a melody without its mode', { kind: 'call', op: 'sound.playMelody', operand: { kind: 'melody', melody: 'ODE' }, blockId: 'm' }],
    ['a tone of 19 Hz', { kind: 'call', op: 'sound.pitch', args: [int(19), int(100)], blockId: 'p' }],
    ['a tone of 20001 Hz', { kind: 'call', op: 'sound.pitch', args: [int(20001), int(100)], blockId: 'p' }],
    ['a tone of 60001 ms', { kind: 'call', op: 'sound.pitch', args: [int(440), int(60001)], blockId: 'p' }],
    ['a tone of -1 ms', { kind: 'call', op: 'sound.pitch', args: [int(440), int(-1)], blockId: 'p' }],
    ['a tone with one number', { kind: 'call', op: 'sound.pitch', args: [int(440)], blockId: 'p' }],
  ])('%s', (_name, statement) => {
    const generated = generateYbcMicroPython(forged(statement));
    expect(generated.ok).toBe(false);
    if (!generated.ok) {
      expect(generated.diagnostics[0]?.code).toMatch(/value-out-of-range|unsupported-node/);
    }
  });
});
