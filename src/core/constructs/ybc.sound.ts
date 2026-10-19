import type { BlockDefinitionJson } from '../program/blocks';
import type { HardwareConstruct } from './ybc';

// The sound constructs of YB-3b (contract §8): one blocking note or rest at a time.
//   C-50 note  music.play(['C4:4'], wait=True)   15 natural notes C3…C5, 1, 2 or 4 ticks
//   C-51 rest  music.play(['R:4'], wait=True)    1, 2 or 4 ticks
// The generator fixes the tempo (`music.set_tempo(4, 120)`, IM-4), so a tick lasts 125 ms in the
// simulator (a vendor public simulator observation, NOT a physical timing verification). A tempo of the
// learner's and ticks beyond 4 are EXCLUDED (C-52, C-60).
//
// N17 B3 opens the rest of the buzzer for the Advanced board, in a pack of its own (`ybc.music`, Advanced only):
//   C-20 built-in melody  music.play(music.BIRTHDAY, wait=False)   20 names (N17 B4: the block offers the editor's 14); until done
//                                                                  (wait=True) or in the background
//   C-21 tone             music.pitch(440, 500)                     20..20000 Hz, 0..60000 ms; does not wait (EVD-06)
//   C-22 stop             music.stop()                              silences the buzzer at once
// The buzzer plays one sound at a time: any of these, a note or a rest ends the one that plays.

export const playNoteType = 'ybc_sound_note';
export const restType = 'ybc_sound_rest';
export const melodyType = 'ybc_sound_melody';
export const pitchType = 'ybc_sound_pitch';
export const soundStopType = 'ybc_sound_stop';

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

// --- N17 B3: built-in melodies, the tone and stop (the Advanced board) -------------------------------------------

/**
 * The built-in melodies of the block (contract C-20), in the order of its dropdown: the names of the micro:bit `music` module.
 * DADADADUM … POWER_DOWN but FUNK, BLUES, FUNERAL, PUNCHLINE, BADDY and BA_DING are the 14 the vendor's editor lists (contract
 * §14); those six are micro:bit names it did not show (an UNVERIFIED form). The notes the simulator plays are in
 * `simulation/peripherals/melodies.ts`.
 */
export const melodyNames = [
  'DADADADUM', 'ENTERTAINER', 'PRELUDE', 'ODE', 'NYAN', 'RINGTONE', 'FUNK', 'BLUES', 'BIRTHDAY', 'WEDDING',
  'FUNERAL', 'PUNCHLINE', 'PYTHON', 'BADDY', 'CHASE', 'BA_DING', 'JUMP_UP', 'JUMP_DOWN', 'POWER_UP', 'POWER_DOWN',
] as const;
export type MelodyName = (typeof melodyNames)[number];
export const isMelodyName = (value: unknown): value is MelodyName => melodyNames.some((name) => name === value);

/**
 * N17 B4 (the B3 ruling): the micro:bit names the vendor's editor does not show (contract §14). The block no longer offers them, so
 * a new program never writes a melody a board may not have; a program saved with one (B3 offered them) still opens, runs and
 * writes it, as an UNVERIFIED form of C-20.
 */
export const extraMelodyNames = ['FUNK', 'BLUES', 'FUNERAL', 'PUNCHLINE', 'BADDY', 'BA_DING'] as const satisfies readonly MelodyName[];
export const isExtraMelodyName = (value: unknown): boolean => extraMelodyNames.some((name) => name === value);
/** The 14 melodies of the vendor's editor (contract §14, VERIFIED in §25): what the block offers, in the order of `melodyNames`. */
export const editorMelodyNames: readonly MelodyName[] = melodyNames.filter((name) => !isExtraMelodyName(name));

/** How a melody plays: the program waits until it is done (`wait=True`), or goes on while it plays (`wait=False`). */
export const melodyModes = ['wait', 'background'] as const;
export type MelodyMode = (typeof melodyModes)[number];
export const isMelodyMode = (value: unknown): value is MelodyMode => melodyModes.some((mode) => mode === value);

/** Contract C-21: a tone is 20..20000 Hz, for 0..60000 ms (the longest wait, C-04). */
export const PITCH_MIN_HZ = 20;
export const PITCH_MAX_HZ = 20_000;
export const PITCH_MAX_MS = 60_000;

/** English labels of the melodies; the values are the names the Python writes. Vietnamese labels are the UI's (i18n/blocks.ts). */
export const melodyLabels: Readonly<Record<MelodyName, string>> = {
  DADADADUM: 'da da da dum',
  ENTERTAINER: 'The Entertainer',
  PRELUDE: 'prelude',
  ODE: 'Ode to Joy',
  NYAN: 'Nyan Cat',
  RINGTONE: 'ringtone',
  FUNK: 'funk',
  BLUES: 'blues',
  BIRTHDAY: 'Happy Birthday',
  WEDDING: 'wedding march',
  FUNERAL: 'funeral march',
  PUNCHLINE: 'punchline',
  PYTHON: 'Python',
  BADDY: 'baddy',
  CHASE: 'chase',
  BA_DING: 'ba-ding',
  JUMP_UP: 'jump up',
  JUMP_DOWN: 'jump down',
  POWER_UP: 'power up',
  POWER_DOWN: 'power down',
};

export const melodyDefinition: BlockDefinitionJson = {
  type: melodyType,
  message0: 'play melody %1 %2',
  args0: [
    // The editor's 14 (N17 B4); the editor's registration keeps a saved one of the six others (src/ui/blockly/editor-blocks.ts).
    { type: 'field_dropdown', name: 'MELODY', options: editorMelodyNames.map((name) => [melodyLabels[name], name]) },
    { type: 'field_dropdown', name: 'MODE', options: [['until done', 'wait'], ['in the background', 'background']] },
  ],
  previousStatement: null,
  nextStatement: null,
  colour: 180,
  tooltip: 'Plays a built-in melody. "until done" waits for its last note; "in the background" lets the program go on while it plays. Any new sound replaces it.',
};

export const pitchDefinition: BlockDefinitionJson = {
  type: pitchType,
  message0: 'start tone %1 Hz for %2 ms',
  args0: [
    { type: 'input_value', name: 'HZ', check: 'Number' },
    { type: 'input_value', name: 'MS', check: 'Number' },
  ],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: 180,
  tooltip: 'Starts a tone (20 to 20000 Hz) that sounds for the given time (0 to 60000 ms). The program goes on at once, as on the board: add a wait to hear the whole tone before the next sound.',
};

export const soundStopDefinition: BlockDefinitionJson = {
  type: soundStopType,
  message0: 'stop sound',
  previousStatement: null,
  nextStatement: null,
  colour: 180,
  tooltip: 'Silences the buzzer at once: a melody in the background or a tone.',
};

/** The rows N17 B3 opens, in the Advanced-only pack `ybc.music`. */
export const musicConstructs: readonly HardwareConstruct[] = [
  { contractId: 'C-20', pack: 'ybc.music', blockTypes: [melodyType], capability: 'sound' },
  { contractId: 'C-21', pack: 'ybc.music', blockTypes: [pitchType], capability: 'sound' },
  { contractId: 'C-22', pack: 'ybc.music', blockTypes: [soundStopType], capability: 'sound' },
];

export const musicDefinitions: readonly BlockDefinitionJson[] = [melodyDefinition, pitchDefinition, soundStopDefinition];

export const soundConstructs: readonly HardwareConstruct[] = [
  { contractId: 'C-50', pack: 'ybc.sound', blockTypes: [playNoteType], capability: 'sound' },
  { contractId: 'C-51', pack: 'ybc.sound', blockTypes: [restType], capability: 'sound' },
];

export const soundDefinitions: readonly BlockDefinitionJson[] = [playNoteDefinition, restDefinition];
