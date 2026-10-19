import { describe, expect, it } from 'vitest';
import { melodyNames } from '../../constructs/ybc.sound';
import { melodySteps, melodyTunes, parseTune, type ToneStep } from './melodies';
import { noteHz } from './sound';

// N17 B3: the built-in melodies of the simulator are note strings in the notation of the micro:bit `music` module ('c4:4', 'eb',
// 'r:2'), written by hand in a table, and read the way that module reads them: an octave and a length, once given, hold for the
// notes after them, and every melody starts again from octave 4 and 4 ticks. A note sounds at its 12-TET frequency (A4 = 440 Hz),
// rounded to a whole Hz, as the contract's table of §8.1 does.

const ticksOf = (steps: readonly ToneStep[]) => steps.reduce((total, step) => total + step.ticks, 0);

describe('the table of melodies', () => {
  it('has the twenty melodies of the block, in its order, and no other', () => {
    expect([...melodyNames]).toEqual([
      'DADADADUM', 'ENTERTAINER', 'PRELUDE', 'ODE', 'NYAN', 'RINGTONE', 'FUNK', 'BLUES', 'BIRTHDAY', 'WEDDING',
      'FUNERAL', 'PUNCHLINE', 'PYTHON', 'BADDY', 'CHASE', 'BA_DING', 'JUMP_UP', 'JUMP_DOWN', 'POWER_UP', 'POWER_DOWN',
    ]);
    expect(Object.keys(melodyTunes)).toEqual([...melodyNames]);
  });

  it.each([...melodyNames])('%s reads as notes and rests: whole Hz from 20 to 20000, whole ticks from 1, at least two steps', (name) => {
    const steps = melodySteps(name);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    for (const step of steps) {
      expect(Number.isInteger(step.ticks) && step.ticks >= 1, `${name} ticks ${step.ticks}`).toBe(true);
      if (step.hz !== null) {
        expect(Number.isInteger(step.hz) && step.hz >= 20 && step.hz <= 20000, `${name} ${step.hz} Hz`).toBe(true);
      }
    }
    expect(steps.some((step) => step.hz !== null)).toBe(true);
    // No melody takes longer than a wait may (60 s), so a blocking one cannot freeze a check.
    expect(ticksOf(steps) * 125).toBeLessThanOrEqual(60_000);
  });

  it('opens each melody the way the micro:bit plays it', () => {
    const opening = (name: (typeof melodyNames)[number], count: number) => melodySteps(name).slice(0, count);
    // Beethoven's fifth: a rest of 2 ticks, three G4, then E flat for 8 ticks.
    expect(opening('DADADADUM', 5)).toEqual([{ hz: null, ticks: 2 }, { hz: 392, ticks: 2 }, { hz: 392, ticks: 2 }, { hz: 392, ticks: 2 }, { hz: 311, ticks: 8 }]);
    // Happy birthday, in F: C4 dotted, C4, D4, C4, F4, E4.
    expect(opening('BIRTHDAY', 6)).toEqual([
      { hz: 262, ticks: 3 }, { hz: 262, ticks: 1 }, { hz: 294, ticks: 4 }, { hz: 262, ticks: 4 }, { hz: 349, ticks: 4 }, { hz: 330, ticks: 8 },
    ]);
    // Ode to joy: E E F G G F E D.
    expect(opening('ODE', 8).map((step) => step.hz)).toEqual([330, 330, 349, 392, 392, 349, 330, 294]);
    expect(melodySteps('JUMP_UP')).toEqual([523, 587, 659, 698, 784].map((hz) => ({ hz, ticks: 1 })));
    expect(melodySteps('JUMP_DOWN')).toEqual([784, 698, 659, 587, 523].map((hz) => ({ hz, ticks: 1 })));
    expect(melodySteps('BA_DING')).toEqual([{ hz: 988, ticks: 1 }, { hz: 1319, ticks: 3 }]);
    expect(melodySteps('POWER_UP')).toEqual([{ hz: 392, ticks: 1 }, { hz: 523, ticks: 1 }, { hz: 659, ticks: 1 }, { hz: 784, ticks: 2 }, { hz: 659, ticks: 1 }, { hz: 784, ticks: 3 }]);
    expect(melodySteps('POWER_DOWN')).toEqual([{ hz: 784, ticks: 1 }, { hz: 622, ticks: 1 }, { hz: 523, ticks: 1 }, { hz: 392, ticks: 2 }, { hz: 494, ticks: 1 }, { hz: 523, ticks: 3 }]);
  });

  it('lasts as many ticks as its notes and rests add up to', () => {
    expect(ticksOf(melodySteps('DADADADUM'))).toBe(32);
    expect(ticksOf(melodySteps('JUMP_UP'))).toBe(5);
    expect(ticksOf(melodySteps('POWER_UP'))).toBe(9);
    expect(ticksOf(melodySteps('BA_DING'))).toBe(4);
    expect(ticksOf(melodySteps('BIRTHDAY'))).toBe(96);
  });
});

describe('reading a tune', () => {
  it('gives the 15 natural notes C3…C5 the frequencies of the contract table (§8.1)', () => {
    for (const [note, hz] of Object.entries(noteHz)) {
      expect(parseTune([`${note.toLowerCase()}:1`]), note).toEqual([{ hz, ticks: 1 }]);
    }
  });

  it('keeps the octave and the length of the last note that gave them', () => {
    expect(parseTune(['c4:2', 'd', 'e:1', 'f5', 'g'])).toEqual([
      { hz: 262, ticks: 2 }, { hz: 294, ticks: 2 }, { hz: 330, ticks: 1 }, { hz: 698, ticks: 1 }, { hz: 784, ticks: 1 },
    ]);
  });

  it('starts every tune at octave 4 and 4 ticks', () => {
    expect(parseTune(['a'])).toEqual([{ hz: 440, ticks: 4 }]);
    parseTune(['c3:8']);
    expect(parseTune(['c'])).toEqual([{ hz: 262, ticks: 4 }]);
  });

  it('reads sharps (#) and flats (b), and tells a flat from the note b', () => {
    expect(parseTune(['c#4:1', 'db', 'eb', 'a#3', 'bb3', 'b4', 'b', 'f#2']).map((step) => step.hz)).toEqual([277, 277, 311, 233, 233, 494, 494, 92]);
  });

  it('reads a rest as silence, with its own length, and an octave on a rest as the octave of the notes after it', () => {
    expect(parseTune(['r4:2', 'g', 'r:1', 'a'])).toEqual([{ hz: null, ticks: 2 }, { hz: 392, ticks: 2 }, { hz: null, ticks: 1 }, { hz: 440, ticks: 1 }]);
    expect(parseTune(['r5:1', 'c'])).toEqual([{ hz: null, ticks: 1 }, { hz: 523, ticks: 1 }]);
  });

  it('reads upper case as the module does', () => {
    expect(parseTune(['C4:4', 'R:2', 'EB5'])).toEqual([{ hz: 262, ticks: 4 }, { hz: null, ticks: 2 }, { hz: 622, ticks: 2 }]);
  });

  it.each([[''], ['h'], ['c:'], ['c4:x'], ['c4:0'], ['c#b'], ['c44'], ['440:4']])('refuses %j: it is not a note', (text) => {
    expect(() => parseTune([text])).toThrow(RangeError);
  });
});
