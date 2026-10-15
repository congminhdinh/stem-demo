import type { SoundIO } from '../../capabilities/io';
import type { NoteName } from '../../constructs/ybc.sound';
import type { ToneState } from '../simulate-circuit';

// The virtual buzzer (contract §8, plan §11.5): the core knows the frequency of the tone and when it
// sounds; playing it is a renderer's business (the audio adapter of the UI reads the snapshot). A tone
// is state of the run, reported while it sounds and removed when it ends.

/**
 * Contract C-50: the generator sets the tempo to (4, 120) (IM-4), and a tick then lasts 125 ms. A vendor
 * public simulator observation, NOT a physical timing verification (contract §0.4, EVD-20).
 */
export const NOTE_TICK_MS = 125;

/** Contract §8.1 (EVD-21): the frequency in Hz of the 15 natural notes, 12-TET with A4 = 440 Hz, as the contract writes them. */
export const noteHz: Readonly<Record<NoteName, number>> = {
  C3: 131,
  D3: 147,
  E3: 165,
  F3: 175,
  G3: 196,
  A3: 220,
  B3: 247,
  C4: 262,
  D4: 294,
  E4: 330,
  F4: 349,
  G4: 392,
  A4: 440,
  B4: 494,
  C5: 523,
};

/**
 * The sound capability: `startTone` reports `{ hz }` as the state of the buzzer and `stopTone` removes it.
 * What a note lasts is the interpreter's (a blocking statement), so nothing here waits or keeps a timer.
 */
export function createSoundIO(report: (state: ToneState | null) => void): SoundIO {
  return {
    startTone(hz) {
      if (!Number.isFinite(hz) || hz <= 0) {
        throw new RangeError('A tone needs a positive frequency.');
      }
      report({ hz });
    },
    stopTone() {
      report(null);
    },
  };
}
