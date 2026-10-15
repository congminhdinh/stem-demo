import { describe, expect, it } from 'vitest';
import { yolobitContract } from '../../compat/yolobit-contract';
import { noteNames, noteTicks, type NoteName } from '../../constructs/ybc.sound';
import type { ToneState } from '../simulate-circuit';
import { createSoundIO, NOTE_TICK_MS, noteHz } from './sound';

// The virtual buzzer (contract §8): the frequency of each note and the length of a tick. The numbers are checked
// against the formula (12-TET with A4 = 440 Hz) and against the table of the contract written out here by hand.

/** Contract §8.1 (EVD-21): the 15 natural notes and their indicator frequencies, as the contract writes them. */
const contractTable = {
  C3: 131, D3: 147, E3: 165, F3: 175, G3: 196, A3: 220, B3: 247,
  C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494,
  C5: 523,
} as const;

const semitones: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** The MIDI number of a natural note: C4 is 60 and A4 is 69. */
const midiOf = (note: string) => 12 * (Number(note.slice(1)) + 1) + (semitones[note.slice(0, 1)] ?? NaN);

describe('the frequencies of the notes (C-50)', () => {
  it('has exactly the 15 natural notes C3 to C5 of the contract, and no other note', () => {
    expect(Object.keys(noteHz)).toEqual([...noteNames]);
    expect(Object.keys(noteHz)).toHaveLength(15);
    for (const other of ['DB4', 'C#4', 'C2', 'C6', 'c4', 'R']) {
      expect(Object.hasOwn(noteHz, other), other).toBe(false);
    }
  });

  it('equals 12-TET with A4 = 440 Hz, rounded to a whole number of Hz, for every note', () => {
    for (const note of noteNames) {
      expect(noteHz[note], note).toBe(Math.round(440 * 2 ** ((midiOf(note) - 69) / 12)));
    }
  });

  it('reads the notes right: C4 is MIDI 60, A4 is MIDI 69, and C3 is an octave under C4', () => {
    expect(midiOf('C4')).toBe(60);
    expect(midiOf('A4')).toBe(69);
    expect(midiOf('C3')).toBe(48);
    expect(midiOf('C5')).toBe(72);
  });

  it('equals the table of contract §8.1', () => {
    expect(noteHz).toEqual(contractTable);
  });

  it('rises with the note: every note is higher than the one before it', () => {
    const frequencies = noteNames.map((note: NoteName) => noteHz[note]);
    expect(frequencies).toEqual([...frequencies].sort((a, b) => a - b));
    expect(new Set(frequencies).size).toBe(15);
  });
});

describe('the length of a tick (C-50, C-51, IM-4)', () => {
  it('is 125 ms', () => {
    expect(NOTE_TICK_MS).toBe(125);
  });

  it('follows from the tempo the generator writes: music.set_tempo(4, 120) gives 60000 / (120 x 4) ms', () => {
    const preamble = yolobitContract.modules.find((module) => module.id === 'C-03c')?.preamble ?? [];
    expect(preamble).toEqual(['music.set_tempo(4, 120)']);
    const [, ticksPerBeat, beatsPerMinute] = /^music\.set_tempo\((\d+), (\d+)\)$/.exec(preamble[0] ?? '')?.map(Number) ?? [];
    expect(ticksPerBeat).toBe(4);
    expect(beatsPerMinute).toBe(120);
    expect(60_000 / ((beatsPerMinute ?? NaN) * (ticksPerBeat ?? NaN))).toBe(NOTE_TICK_MS);
  });

  it('gives 125 / 250 / 500 ms for 1 / 2 / 4 ticks, the times the contract writes for C-50 and C-51', () => {
    const lengths = noteTicks.map((ticks) => ticks * NOTE_TICK_MS);
    expect(lengths).toEqual([125, 250, 500]);
    const row = (id: string) => yolobitContract.constructs.find((construct) => construct.id === id);
    expect(row('C-50')?.restrictions.join(' ')).toContain(lengths.join(' / '));
    // Both rows state the length of a tick: "ticks x 125 at tempo (4, 120)".
    for (const id of ['C-50', 'C-51']) {
      expect(row(id)?.timing?.blocksMs, id).toContain(String(NOTE_TICK_MS));
    }
  });
});

describe('createSoundIO (the sound capability)', () => {
  const reportTo = (reported: (ToneState | null)[]) => (state: ToneState | null) => {
    reported.push(state);
  };

  it('reports { hz } when a tone starts and null when it stops', () => {
    const reported: (ToneState | null)[] = [];
    const sound = createSoundIO(reportTo(reported));
    sound.startTone(noteHz.C4);
    expect(reported).toEqual([{ hz: 262 }]);
    sound.stopTone();
    expect(reported).toEqual([{ hz: 262 }, null]);
  });

  it('reports each tone as it starts, whatever the one before was', () => {
    const reported: (ToneState | null)[] = [];
    const sound = createSoundIO(reportTo(reported));
    sound.startTone(noteHz.C3);
    sound.startTone(noteHz.C5);
    sound.stopTone();
    sound.stopTone();
    expect(reported).toEqual([{ hz: 131 }, { hz: 523 }, null, null]);
  });

  it('reports a state that holds the frequency and nothing else', () => {
    const reported: (ToneState | null)[] = [];
    createSoundIO(reportTo(reported)).startTone(440);
    expect(Object.keys(reported[0] ?? {})).toEqual(['hz']);
  });

  it.each([0, -1, -440, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects the frequency %d and reports nothing', (hz) => {
    const reported: (ToneState | null)[] = [];
    expect(() => createSoundIO(reportTo(reported)).startTone(hz)).toThrow(RangeError);
    expect(reported).toEqual([]);
  });
});
