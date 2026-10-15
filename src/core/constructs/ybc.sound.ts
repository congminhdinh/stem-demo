import type { BlockDefinitionJson } from '../program/blocks';
import type { HardwareConstruct } from './ybc';

// The sound constructs of YB-3b (contract §8): one blocking note or rest at a time.
//   C-50 note  music.play(['C4:4'], wait=True)   15 natural notes C3…C5, 1, 2 or 4 ticks
//   C-51 rest  music.play(['R:4'], wait=True)    1, 2 or 4 ticks
// The generator fixes the tempo (`music.set_tempo(4, 120)`, IM-4), so a tick lasts 125 ms in the
// simulator (a vendor public simulator observation, NOT a physical timing verification). Built-in
// melodies, pitch, stop, a tempo of the learner's and ticks beyond 4 are EXCLUDED (C-20, C-21, C-22, C-52).

export const playNoteType = 'ybc_sound_note';
export const restType = 'ybc_sound_rest';

/** The natural notes C3…C5 of contract C-50: `oneOf` the domain, nothing else is offered or accepted. */
export const noteNames = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'] as const;
export type NoteName = (typeof noteNames)[number];

/** The lengths of contract C-50 and C-51, in ticks: `oneOf [1, 2, 4]`. */
export const noteTicks = [1, 2, 4] as const;
export type NoteTicks = (typeof noteTicks)[number];

export const isNoteName = (value: unknown): value is NoteName => noteNames.some((name) => name === value);

/** Blockly saves a dropdown as the text of the option, so the ticks come back as '1', '2' or '4'. */
export function ticksOfOption(value: unknown): NoteTicks | null {
  return noteTicks.find((ticks) => String(ticks) === value) ?? null;
}

const ticksDropdown = { type: 'field_dropdown', name: 'TICKS', options: noteTicks.map((ticks) => [String(ticks), String(ticks)]) };

export const playNoteDefinition: BlockDefinitionJson = {
  type: playNoteType,
  message0: 'play note %1 for %2 ticks',
  args0: [{ type: 'field_dropdown', name: 'NOTE', options: noteNames.map((note) => [note, note]) }, ticksDropdown],
  previousStatement: null,
  nextStatement: null,
  colour: 180,
  tooltip: 'Plays a note and waits until it has ended. One tick is 125 milliseconds.',
};

export const restDefinition: BlockDefinitionJson = {
  type: restType,
  message0: 'rest for %1 ticks',
  args0: [ticksDropdown],
  previousStatement: null,
  nextStatement: null,
  colour: 180,
  tooltip: 'Stays silent and waits. One tick is 125 milliseconds.',
};

export const soundConstructs: readonly HardwareConstruct[] = [
  { contractId: 'C-50', pack: 'ybc.sound', blockTypes: [playNoteType], capability: 'sound' },
  { contractId: 'C-51', pack: 'ybc.sound', blockTypes: [restType], capability: 'sound' },
];

export const soundDefinitions: readonly BlockDefinitionJson[] = [playNoteDefinition, restDefinition];
