// The Yolo:Bit-compatible labs an embedding page can launch by key (N6a S1). Like the generic keys of
// templates.ts they are a public contract: CourseService stores them (LabTemplateCatalog.DefaultYolobit), so a
// key is never renamed or reused. Each template is a STARTER: the board, the program around the idea of the
// lesson, and one prepared block left loose (disabled, so it does not run) that the learner drags into place.
// The challenge of the template (challenges.ts) fails on the starter and passes once that block is in place
// (ybc-solutions.ts holds the finished programs the tests and the E2E use).
//
// Only the 5×5 display, buttons A/B, the light sensor and the buzzer are used: reading a header pin that is
// not driven stops the program (`out-of-domain`, YB plan §14 B9), so no template reads a pin.

type Json = Record<string, unknown>;

export const ybcTemplateKeys = ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody', 'ybc-empty'] as const;

export type YbcTemplateKey = (typeof ybcTemplateKeys)[number];

/** The board profiles a Yolo:Bit lab can be launched with (`profile=`); a template opens with the first one. */
export const ybcLabProfiles = ['ybc-basic', 'ybc-advanced'] as const;

export type YbcLabProfile = (typeof ybcLabProfiles)[number];

/** The board of every Yolo:Bit template; challenges address its parts as `<board id>/<part>`. */
export const ybcTemplateBoardId = 'ybc-board-1';

/** Pictures as the contract writes `Image("…")`: five rows of five digits, top to bottom, 1 lit. */
export const ybcImages = {
  heart: '01010:11111:11111:01110:00100',
  check: '00000:00001:00010:10100:01000',
  cross: '10001:01010:00100:01010:10001',
  full: '11111:11111:11111:11111:11111',
} as const;

/** Blockly's reason for a block that is not attached to a hat; the editor keeps it until the block is attached. */
const orphaned = { disabledReasons: ['ORPHANED_BLOCK'] };

/** Statements linked by `next`, as Blockly saves a stack. */
function chain(statements: Json[]): Json | undefined {
  const [first, ...rest] = statements;
  if (!first) {
    return undefined;
  }
  const next = chain(rest);
  return next ? { ...first, next: { block: next } } : first;
}

const statementInput = (statements: Json[]) => {
  const first = chain(statements);
  return first ? { block: first } : undefined;
};

const hat = (type: 'stem_on_start' | 'stem_forever', id: string, y: number, body: Json[]): Json => {
  const DO = statementInput(body);
  return { type, id, x: 40, y, ...(DO ? { inputs: { DO } } : {}) };
};

/**
 * "show image" as the editor saves it: the colour field of N17 B1 first (red), then the 25 squares. Written so, opening a lab
 * changes nothing in the program, and the lab sends no project-changed.
 */
export const showImage = (id: string, picture: string, extra: Json = {}): Json => ({
  type: 'ybc_display_show_image',
  id,
  ...extra,
  fields: {
    COLOUR: '#ff0000',
    ...Object.fromEntries(picture.split(':').flatMap((row, rowIndex) => [...row].map((digit, column) => [`R${rowIndex}C${column}`, digit === '1']))),
  },
});

export const clearDisplay = (id: string): Json => ({ type: 'ybc_display_clear', id });

export const buttonPressed = (id: string, button: 'A' | 'B'): Json => ({ type: 'ybc_button_pressed', id, fields: { BUTTON: button } });

export const playNote = (id: string, note: string, ticks: 1 | 2 | 4): Json => ({
  type: 'ybc_sound_note',
  id,
  fields: { NOTE: note, TICKS: String(ticks) },
});

/** if / else if … / else, as Blockly saves it: `branches` are [condition, statements]. */
export function ifBlock(id: string, branches: [Json, Json[]][], otherwise?: Json[]): Json {
  const extraState = {
    ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}),
    ...(otherwise ? { hasElse: true } : {}),
  };
  const inputs: Json = {};
  branches.forEach(([condition, statements], index) => {
    inputs[`IF${index}`] = { block: condition };
    const body = statementInput(statements);
    if (body) {
      inputs[`DO${index}`] = body;
    }
  });
  const elseBody = otherwise ? statementInput(otherwise) : undefined;
  if (elseBody) {
    inputs.ELSE = elseBody;
  }
  return { type: 'controls_if', id, ...(Object.keys(extraState).length > 0 ? { extraState } : {}), inputs };
}

export const lightBelow = (id: string, threshold: number): Json => ({
  type: 'logic_compare',
  id,
  fields: { OP: 'LT' },
  inputs: {
    A: { block: { type: 'ybc_light_level', id: `${id}-light` } },
    B: { block: { type: 'math_number', id: `${id}-threshold`, fields: { NUM: threshold } } },
  },
});

/** The melody the ybc-melody lab plays: four notes of two ticks (250 ms each). */
export const melodyNotes = (prefix: string): Json[] => [
  playNote(`${prefix}-c4`, 'C4', 2),
  playNote(`${prefix}-e4`, 'E4', 2),
  playNote(`${prefix}-g4`, 'G4', 2),
  playNote(`${prefix}-c5`, 'C5', 2),
];

/**
 * A loose block or stack beside the program, disabled until the learner attaches it; keys in the order Blockly
 * saves them. It sits right of the empty "on start", where a lesson frame (1100×640) still shows it.
 */
export const loose = ({ type, id, ...rest }: Json): Json => ({ type, id, x: 230, y: 40, ...orphaned, ...rest });

/** The parts of a Yolo:Bit program: what `on start` and `forever` hold, and the loose blocks beside them. */
export type YbcProgramParts = { onStart: Json[]; forever: Json[]; loose?: Json[] };

/** The blocks of a program, as Blockly saves a workspace (no variables: no template uses one). */
export function ybcProgram(parts: YbcProgramParts): Json {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [hat('stem_on_start', 'on-start', 40, parts.onStart), hat('stem_forever', 'forever', 220, parts.forever), ...(parts.loose ?? [])],
    },
  };
}

/** A project of one Yolo:Bit-compatible board and `program`, in the shape the schema parses. */
export function ybcProject(key: YbcTemplateKey, name: string, program: Json): Json {
  return {
    schemaVersion: 1,
    id: `template-${key}`,
    name,
    profile: ybcLabProfiles[0],
    circuit: {
      components: [{ id: ybcTemplateBoardId, deviceType: 'ybc-board', position: { x: 300, y: 220 } }],
      wires: [],
    },
    program: { blocks: program },
  };
}

const starters: Readonly<Record<YbcTemplateKey, () => Json>> = {
  // Drag "show image" (the heart) into "on start".
  'ybc-heart': () =>
    ybcProject('ybc-heart', 'Trái tim', ybcProgram({ onStart: [], forever: [], loose: [loose(showImage('heart', ybcImages.heart))] })),
  // A shows ✓ already; drag the ✗ picture into the "else if B" branch.
  'ybc-button-ab': () =>
    ybcProject(
      'ybc-button-ab',
      'Nút A/B',
      ybcProgram({
        onStart: [],
        forever: [
          ifBlock('if-buttons', [
            [buttonPressed('pressed-a', 'A'), [showImage('show-check', ybcImages.check)]],
            [buttonPressed('pressed-b', 'B'), []],
          ]),
        ],
        loose: [loose(showImage('show-cross', ybcImages.cross))],
      }),
    ),
  // Bright: clear. Drag the full picture into "if light level < 30".
  'ybc-night-light': () =>
    ybcProject(
      'ybc-night-light',
      'Đèn ngủ',
      ybcProgram({
        onStart: [],
        forever: [ifBlock('if-dark', [[lightBelow('dark', 30), []]], [clearDisplay('clear')])],
        loose: [loose(showImage('show-full', ybcImages.full))],
      }),
    ),
  // Drag the melody (four notes) into "if button A is pressed".
  'ybc-melody': () =>
    ybcProject(
      'ybc-melody',
      'Giai điệu',
      ybcProgram({
        onStart: [],
        forever: [ifBlock('if-a', [[buttonPressed('pressed-a', 'A'), []]])],
        loose: [loose(chain(melodyNotes('melody')) ?? {})],
      }),
    ),
  'ybc-empty': () => ybcProject('ybc-empty', 'Untitled', ybcProgram({ onStart: [], forever: [] })),
};

/** The starter of `key` as plain JSON, new on every call (templates.ts parses it). */
export const ybcStarterDocument = (key: YbcTemplateKey): Json => starters[key]();

/** Whether `key` is one of the Yolo:Bit keys (exact, case-sensitive). */
export const isYbcTemplateKey = (key: string): key is YbcTemplateKey => (ybcTemplateKeys as readonly string[]).includes(key);
