import type { MelodyName } from '../../constructs/ybc.sound';

// The built-in melodies the simulator plays (N17 B3, contract C-20). Each is a tune in the notation of the micro:bit MicroPython
// `music` module: NOTE[#|b][OCTAVE][:TICKS], R for a rest; an octave and a length, once given, hold for the notes after them, and
// every tune starts again from octave 4 and 4 ticks ("so tunes always play the same", as that module resets them at each play).
//
// Provenance (contract §14): the tunes are those of the micro:bit MicroPython port (`musictunes.c`, MIT License, Damien P. George
// and the micro:bit Educational Foundation), typed by hand from memory, not read from that file in this session. NYAN, PRELUDE and
// PYTHON are long there; only their opening phrases are kept here (recognisable, a few seconds). They are never the vendor's
// (OhStem's) assets: the real board plays its own melody of the same name, so the simulator's is an approximation (UNVERIFIED
// content), and the Python always names the melody (`music.BIRTHDAY`), never these notes.

/** One note (`hz`) or rest (`hz` null) of a tune, for whole ticks of the tempo (125 ms at the tempo the generator fixes). */
export type ToneStep = { hz: number | null; ticks: number };

export const melodyTunes: Readonly<Record<MelodyName, readonly string[]>> = {
  DADADADUM: ['r4:2', 'g', 'g', 'g', 'eb:8', 'r:2', 'f', 'f', 'f', 'd:8'],
  ENTERTAINER: ['d4:1', 'd#', 'e', 'c5:2', 'e4:1', 'c5:2', 'e4:1', 'c5:3', 'c:1', 'd', 'd#', 'e', 'c', 'd', 'e:2', 'b4:1', 'd5:2', 'c:4'],
  // Opening phrase only: the first two bars of Bach's prelude in C.
  PRELUDE: [
    'c4:1', 'e', 'g', 'c5', 'e', 'g4', 'c5', 'e', 'c4', 'e', 'g', 'c5', 'e', 'g4', 'c5', 'e',
    'c4', 'd', 'g', 'd5', 'f', 'g4', 'd5', 'f', 'c4', 'd', 'g', 'd5', 'f', 'g4', 'd5', 'f',
  ],
  ODE: [
    'e4', 'e', 'f', 'g', 'g', 'f', 'e', 'd', 'c', 'c', 'd', 'e', 'e:6', 'd:2', 'd:8',
    'e:4', 'e', 'f', 'g', 'g', 'f', 'e', 'd', 'c', 'c', 'd', 'e', 'd:6', 'c:2', 'c:8',
  ],
  // Opening phrase only.
  NYAN: [
    'f#5:2', 'g#', 'c#:1', 'd#:2', 'b4:1', 'd5:1', 'c#', 'b4:2', 'b', 'c#5', 'd', 'd:1', 'c#', 'b4:1', 'c#5:1', 'd#', 'f#', 'g#',
    'd#', 'f#', 'c#', 'd', 'b4', 'c#5', 'b4', 'd#5:2', 'f#', 'g#:1', 'd#', 'f#', 'c#', 'd#', 'b4', 'd5', 'd#', 'd', 'c#', 'b4',
    'c#5', 'd:2', 'b4:1', 'c#5', 'd#', 'f#', 'c#', 'd', 'c#', 'b4', 'c#5:2', 'b4', 'c#5', 'b4',
  ],
  RINGTONE: ['c4:1', 'd', 'e:2', 'g', 'd:1', 'e', 'f:2', 'a', 'e:1', 'f', 'g:2', 'b', 'c5:4'],
  FUNK: ['c2:2', 'c', 'd#', 'c:1', 'f:2', 'c:1', 'f:2', 'f#', 'g', 'c', 'c', 'g', 'c:1', 'f#:2', 'c:1', 'f#:2', 'f', 'd#'],
  BLUES: [
    'c2:2', 'e', 'g', 'a', 'a#', 'a', 'g', 'e', 'c2:2', 'e', 'g', 'a', 'a#', 'a', 'g', 'e', 'f', 'a', 'c3', 'd', 'd#', 'd', 'c', 'a2',
    'c2:2', 'e', 'g', 'a', 'a#', 'a', 'g', 'e', 'g', 'b', 'd3', 'f', 'f2', 'a', 'c3', 'd#', 'c2:2', 'e', 'g', 'e', 'g', 'f', 'e', 'd',
  ],
  BIRTHDAY: [
    'c4:3', 'c:1', 'd:4', 'c:4', 'f', 'e:8', 'c:3', 'c:1', 'd:4', 'c:4', 'g', 'f:8',
    'c:3', 'c:1', 'c5:4', 'a4', 'f', 'e', 'd', 'a#:3', 'a#:1', 'a:4', 'f', 'g', 'f:8',
  ],
  WEDDING: ['c4:4', 'f:3', 'f:1', 'f:8', 'c:4', 'g:3', 'e:1', 'f:8', 'c:4', 'f:3', 'a:1', 'c5:4', 'a4:3', 'f:1', 'f:4', 'e:3', 'f:1', 'g:8'],
  FUNERAL: ['c3:4', 'c:3', 'c:1', 'c:4', 'd#:3', 'd:1', 'd:3', 'c:1', 'c:3', 'b2:1', 'c3:4'],
  PUNCHLINE: ['c4:3', 'g3:1', 'f#', 'g', 'g#:3', 'g', 'r', 'b', 'c4'],
  // Opening phrase only: the first two phrases of the Liberty Bell march.
  PYTHON: [
    'd5:1', 'b4', 'r', 'b', 'b', 'a#', 'b', 'g5', 'r', 'd', 'd', 'r', 'b4', 'c5', 'r', 'c', 'c', 'r', 'd', 'e:5',
    'c:1', 'a4', 'r', 'a', 'a', 'g#', 'a', 'f#5', 'r', 'e', 'e', 'r', 'c', 'b4', 'r', 'b', 'b', 'r', 'c5', 'd:5',
  ],
  BADDY: ['c3:3', 'r', 'd:2', 'd#', 'r', 'c', 'r', 'f#:8'],
  CHASE: [
    'a4:1', 'b', 'c5', 'b4', 'a:2', 'r', 'a:1', 'b', 'c5', 'b4', 'a:2', 'r', 'a:2', 'e5', 'd#', 'e', 'f', 'e', 'd#', 'e',
    'b4:1', 'c5', 'd', 'c', 'b4:2', 'r', 'b:1', 'c5', 'd', 'c', 'b4:2', 'r', 'b:2', 'e5', 'd#', 'e', 'f', 'e', 'd#', 'e',
  ],
  BA_DING: ['b5:1', 'e6:3'],
  JUMP_UP: ['c5:1', 'd', 'e', 'f', 'g'],
  JUMP_DOWN: ['g5:1', 'f', 'e', 'd', 'c'],
  POWER_UP: ['g4:1', 'c5', 'e', 'g:2', 'e:1', 'g:3'],
  POWER_DOWN: ['g5:1', 'd#', 'c', 'g4:2', 'b:1', 'c5:3'],
};

/** Semitones above C of each note letter. */
const semitoneOf: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** One element of a tune: a note letter or R, a sharp or a flat, a one-digit octave, a length in ticks. Case does not matter. */
const element = /^([a-gr])([#b]?)([0-8]?)(?::([1-9]\d{0,2}))?$/;

/** The 12-TET frequency (A4 = 440 Hz) of the note `semitone` above C of `octave`, rounded to a whole Hz as the contract's table is (§8.1). */
const frequencyOf = (semitone: number, octave: number) => Math.round(440 * 2 ** ((12 * (octave + 1) + semitone - 69) / 12));

/**
 * Reads a tune: each element is a note or a rest, the octave and the length carried from the element before when it leaves them
 * out, from octave 4 and 4 ticks at the start. An element that is not one of the notation throws a RangeError.
 */
export function parseTune(tune: readonly string[]): ToneStep[] {
  let octave = 4;
  let ticks = 4;
  return tune.map((text) => {
    const match = element.exec(text.toLowerCase());
    if (!match) {
      throw new RangeError(`"${text}" is not a note.`);
    }
    const [, letter = '', accidental = '', octaveText = '', ticksText] = match;
    if (octaveText !== '') {
      octave = Number(octaveText);
    }
    if (ticksText !== undefined) {
      ticks = Number(ticksText);
    }
    if (letter === 'r') {
      if (accidental !== '') {
        throw new RangeError(`"${text}" is not a note.`);
      }
      return { hz: null, ticks };
    }
    const semitone = (semitoneOf[letter] ?? 0) + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
    return { hz: frequencyOf(semitone, octave), ticks };
  });
}

const stepsByName = new Map<MelodyName, readonly ToneStep[]>(
  (Object.keys(melodyTunes) as MelodyName[]).map((name) => [name, Object.freeze(parseTune(melodyTunes[name]))]),
);

/** The notes and rests of a built-in melody, in order. */
export function melodySteps(name: MelodyName): readonly ToneStep[] {
  const steps = stepsByName.get(name);
  if (steps === undefined) {
    throw new RangeError(`"${String(name)}" is not a built-in melody.`);
  }
  return steps;
}
