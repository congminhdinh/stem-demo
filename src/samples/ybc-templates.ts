// The Yolo:Bit-compatible labs an embedding page can launch by key (N6a S1). Like the generic keys of
// templates.ts they are a public contract: CourseService stores them (LabTemplateCatalog.DefaultYolobit), so a
// key is never renamed or reused. Each template is a STARTER: the board, the program around the idea of the
// lesson, and one prepared block left loose (disabled, so it does not run) that the learner drags into place.
// The challenge of the template (challenges.ts) fails on the starter and passes once that block is in place
// (ybc-solutions.ts holds the finished programs the tests and the E2E use).
//
// No template reads a header pin: the onboard parts are enough for every lesson. The labs of N17 B6 use the full board: the RGB
// display and A's presses (rainbow), the temperature (thermometer), a shake and a random number (dice), and a servo on P0 driven
// by the light (servo gate). The last three need the Advanced board, which `ybcTemplateProfiles` records.

type Json = Record<string, unknown>;

export const ybcTemplateKeys = [
  'ybc-heart',
  'ybc-button-ab',
  'ybc-night-light',
  'ybc-melody',
  'ybc-empty',
  // N17 B6: the labs of the full board.
  'ybc-rainbow',
  'ybc-thermometer',
  'ybc-dice',
  'ybc-servo-gate',
] as const;

export type YbcTemplateKey = (typeof ybcTemplateKeys)[number];

/** The board profiles a Yolo:Bit lab can be launched with (`profile=`), from the Basic board up: each one has all of the one before. */
export const ybcLabProfiles = ['ybc-basic', 'ybc-advanced'] as const;

export type YbcLabProfile = (typeof ybcLabProfiles)[number];

/**
 * The profile each template needs (N17 B6), which it opens with when the launch names none: the lowest board that has every block
 * and part of its program. A launch with a lower profile is refused (launch.ts), since the program would not run there.
 */
export const ybcTemplateProfiles: Readonly<Record<YbcTemplateKey, YbcLabProfile>> = {
  'ybc-heart': 'ybc-basic',
  'ybc-button-ab': 'ybc-basic',
  'ybc-night-light': 'ybc-basic',
  'ybc-melody': 'ybc-basic',
  'ybc-empty': 'ybc-basic',
  'ybc-rainbow': 'ybc-basic',
  'ybc-thermometer': 'ybc-advanced',
  'ybc-dice': 'ybc-advanced',
  'ybc-servo-gate': 'ybc-advanced',
};

/** Why `profile` cannot open `key` (English, for the page that built the launch URL), or null when it can: it has all the template needs. */
export function templateProfileProblem(key: YbcTemplateKey, profile: YbcLabProfile): string | null {
  const needed = ybcTemplateProfiles[key];
  return ybcLabProfiles.indexOf(profile) >= ybcLabProfiles.indexOf(needed)
    ? null
    : `The template "${key}" needs profile=${needed}: it uses blocks or parts that ${profile} does not have.`;
}

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

/** A number typed into a block. */
const numberBlock = (id: string, value: number): Json => ({ type: 'math_number', id, fields: { NUM: value } });

/** "<a> <op> <b>", Blockly's comparison. */
const compare = (id: string, op: 'EQ' | 'GT' | 'LT', a: Json, b: Json): Json => ({ type: 'logic_compare', id, fields: { OP: op }, inputs: { A: { block: a }, B: { block: b } } });

/** The variable of a template program (N17 B6): Blockly saves a variable field by the variable's id. */
const getVariable = (id: string, variableId: string): Json => ({ type: 'variables_get', id, fields: { VAR: { id: variableId } } });
const setVariable = (id: string, variableId: string, value: Json): Json => ({ type: 'variables_set', id, fields: { VAR: { id: variableId } }, inputs: { VALUE: { block: value } } });
const plus = (id: string, a: Json, b: Json): Json => ({ type: 'ybc_arith', id, fields: { OP: 'ADD' }, inputs: { A: { block: a }, B: { block: b } } });
const remainder = (id: string, a: Json, b: Json): Json => ({ type: 'math_modulo', id, inputs: { DIVIDEND: { block: a }, DIVISOR: { block: b } } });

/** "number of presses of <button>" (C-13): the presses since it was last asked. */
const buttonPresses = (id: string, button: 'A' | 'B'): Json => ({ type: 'ybc_button_presses', id, fields: { BUTTON: button } });

/** "fill the display with <colour>" (C-43, N17 B1), the colour block inside it; `colour` is one of the palette's lower-case codes. */
const fillDisplay = (id: string, colour: string): Json => ({
  type: 'ybc_display_set_all',
  id,
  inputs: { COLOUR: { block: { type: 'ybc_colour', id: `${id}-colour`, fields: { COLOUR: colour } } } },
});

/**
 * "scroll the number <value>" in red. The colour input holds a red colour block as a shadow, as the toolbox gives it, so the block
 * never shows an empty socket; red is the colour without one too, so the program and its Python are the same as before.
 */
const scrollNumber = (id: string, value: Json): Json => ({
  type: 'ybc_display_scroll_number',
  id,
  inputs: { NUM: { block: value }, COLOUR: { shadow: { type: 'ybc_colour', id: `${id}-colour`, fields: { COLOUR: '#ff0000' } } } },
});

/** The Advanced board's temperature (C-16), a shake (C-18), a random number (C-40) and the servo (C-27). */
const temperatureBlock = (id: string): Json => ({ type: 'ybc_temperature', id });
export const shaken = (id: string): Json => ({ type: 'ybc_gesture_is', id, fields: { GESTURE: 'shake' } });
const randomNumber = (id: string, from: number, to: number): Json => ({
  type: 'ybc_random_int',
  id,
  inputs: { FROM: { block: numberBlock(`${id}-from`, from) }, TO: { block: numberBlock(`${id}-to`, to) } },
});
const turnServo = (id: string, pin: 'P0' | 'P1' | 'P2', angle: number): Json => ({
  type: 'ybc_servo_write',
  id,
  fields: { PIN: pin },
  inputs: { ANGLE: { block: numberBlock(`${id}-angle`, angle) } },
});

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

/** Where a loose block sits unless its template says otherwise: right of the empty "on start", above "forever". */
const besideOnStart = { x: 230, y: 40 };

/**
 * A loose block or stack beside the program, disabled until the learner attaches it; keys in the order Blockly
 * saves them. It sits right of the empty "on start" (`besideOnStart`), where a lesson frame (1100×640) still shows it. A tall one
 * (a picture) would lie on a wide "forever" there, so its template puts it right of the program instead (Fix 6, N17 m3):
 * `at` clears the widest "forever" of either language by about 30 units, as the editor draws it (e2e/lab-layout.spec.ts checks
 * that no two blocks overlap in a lesson's frame).
 */
export const loose = ({ type, id, ...rest }: Json, at: { x: number; y: number } = besideOnStart): Json => ({ type, id, x: at.x, y: at.y, ...orphaned, ...rest });

/**
 * The parts of a Yolo:Bit program: what `on start` and `forever` hold, the loose blocks beside them and its variables. `foreverY`
 * moves "forever" down (220 otherwise), under a loose stack beside "on start" that reaches lower than 220 (the melody's notes).
 */
export type YbcProgramParts = { onStart: Json[]; forever: Json[]; loose?: Json[]; variables?: { name: string; id: string }[]; foreverY?: number };

/** The blocks of a program, as Blockly saves a workspace: its variables after the blocks, when it has any. */
export function ybcProgram(parts: YbcProgramParts): Json {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [hat('stem_on_start', 'on-start', 40, parts.onStart), hat('stem_forever', 'forever', parts.foreverY ?? 220, parts.forever), ...(parts.loose ?? [])],
    },
    ...(parts.variables && parts.variables.length > 0 ? { variables: parts.variables } : {}),
  };
}

type Circuit = { components: Json[]; wires: Json[] };

/** The board alone, where every template puts it. */
const boardOnly = (): Circuit => ({ components: [{ id: ybcTemplateBoardId, deviceType: 'ybc-board', position: { x: 300, y: 220 } }], wires: [] });

const wire = (id: string, from: [string, string], to: [string, string]): Json => ({
  id,
  from: { componentId: from[0], portId: from[1] },
  to: { componentId: to[0], portId: to[1] },
});

/** The servo gate's circuit (N17 B6): the board and a servo above its header pins, its signal on P0, powered from 3V3 and GND. */
const boardAndServo = (): Circuit => ({
  components: [...boardOnly().components, { id: 'servo-1', deviceType: 'servo', position: { x: 520, y: 100 } }],
  wires: [
    wire('wire-servo-signal', ['servo-1', 'signal'], [ybcTemplateBoardId, 'p0']),
    wire('wire-servo-power', ['servo-1', 'vcc'], [ybcTemplateBoardId, '3v3']),
    wire('wire-servo-ground', ['servo-1', 'gnd'], [ybcTemplateBoardId, 'gnd']),
  ],
});

/** A project of one Yolo:Bit-compatible board (and the parts of `circuit`) and `program`, with the profile the template needs. */
export function ybcProject(key: YbcTemplateKey, name: string, program: Json, circuit: Circuit = boardOnly()): Json {
  return {
    schemaVersion: 1,
    id: `template-${key}`,
    name,
    profile: ybcTemplateProfiles[key],
    circuit,
    program: { blocks: program },
  };
}

/**
 * N17 B6: the rainbow's variable, the colour it is on: red, green, blue, red… by the remainder of a division by 3. A variable starts
 * at 0 (the Python declares it so), so "on start" stays empty.
 */
const colourVariable = { name: 'mau', id: 'var-mau' };

/** The rainbow without the step it lacks: the colour of the display follows the variable. */
export const rainbowProgram = (onPress: Json[]): YbcProgramParts => ({
  onStart: [],
  forever: [
    ifBlock('if-pressed', [[compare('pressed', 'GT', buttonPresses('presses-a', 'A'), numberBlock('pressed-zero', 0)), onPress]]),
    ifBlock(
      'if-colour',
      [
        [compare('is-red', 'EQ', remainder('red-left', getVariable('red-mau', colourVariable.id), numberBlock('red-three', 3)), numberBlock('red-zero', 0)), [fillDisplay('fill-red', '#ff0000')]],
        [compare('is-green', 'EQ', remainder('green-left', getVariable('green-mau', colourVariable.id), numberBlock('green-three', 3)), numberBlock('green-one', 1)), [fillDisplay('fill-green', '#00ff00')]],
      ],
      [fillDisplay('fill-blue', '#0000ff')],
    ),
  ],
  variables: [colourVariable],
});

/** The step the rainbow lacks: one more for every press of A. */
export const rainbowStep = (): Json => setVariable('next-colour', colourVariable.id, plus('next-sum', getVariable('next-mau', colourVariable.id), numberBlock('next-one', 1)));
/** The thermometer's step: the temperature, scrolled. */
export const thermometerShow = (): Json => scrollNumber('show-temperature', temperatureBlock('temperature'));
/** The dice's step: a number from 1 to 6, shown (one character stays still). */
export const diceRoll = (): Json => scrollNumber('show-number', randomNumber('dice', 1, 6));
/** The servo gate: in the dark (light below 30) what `dark` says, otherwise the servo on P0 turns to 90°. */
export const servoGateParts = (dark: Json[]): YbcProgramParts => ({
  onStart: [],
  forever: [ifBlock('if-dark', [[lightBelow('dark', 30), dark]], [turnServo('gate-open', 'P0', 90)])],
});
/** The servo gate's step: the servo on P0 turns to 0°. */
export const servoGateClose = (): Json => turnServo('gate-close', 'P0', 0);
/** The servo gate's circuit, for its solution. */
export const servoGateCircuit = (): Circuit => boardAndServo();

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
        // The picture beside "on start" reaches down to 302: "forever" starts under it. (Right of the "if A … else if B", 461 units
        // wide, the starter would be too wide for the program column of an 820 px frame.)
        loose: [loose(showImage('show-cross', ybcImages.cross))],
        foreverY: 332,
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
        // Right of the "if light level < 30 … else" (426 units wide in Vietnamese).
        loose: [loose(showImage('show-full', ybcImages.full), { x: 460, y: 40 })],
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
        // The four notes beside "on start" reach down to 244: "forever" starts under them, so the whole starter still fits a lesson's frame.
        loose: [loose(chain(melodyNotes('melody')) ?? {})],
        foreverY: 280,
      }),
    ),
  'ybc-empty': () => ybcProject('ybc-empty', 'Untitled', ybcProgram({ onStart: [], forever: [] })),
  // N17 B6. Each press of A turns the whole display to the next colour: drag "set mau to mau + 1" into "if presses of A > 0".
  'ybc-rainbow': () => ybcProject('ybc-rainbow', 'Cầu vồng', ybcProgram({ ...rainbowProgram([]), loose: [loose(rainbowStep())] })),
  // B shows the temperature: drag "scroll the number (temperature)" into "if B is pressed".
  'ybc-thermometer': () =>
    ybcProject(
      'ybc-thermometer',
      'Nhiệt kế',
      ybcProgram({ onStart: [], forever: [ifBlock('if-b', [[buttonPressed('pressed-b', 'B'), []]])], loose: [loose(thermometerShow())] }),
    ),
  // A shake shows a random number from 1 to 6: drag "scroll the number (random 1 to 6)" into "if shaken".
  'ybc-dice': () =>
    ybcProject('ybc-dice', 'Xúc xắc', ybcProgram({ onStart: [], forever: [ifBlock('if-shaken', [[shaken('shaken'), []]])], loose: [loose(diceRoll())] })),
  // Bright: the servo turns to 90°. Drag "servo P0 turn to 0" into "if light level < 30".
  'ybc-servo-gate': () =>
    ybcProject('ybc-servo-gate', 'Cổng servo', ybcProgram({ ...servoGateParts([]), loose: [loose(servoGateClose())] }), boardAndServo()),
};

/** The starter of `key` as plain JSON, new on every call (templates.ts parses it). */
export const ybcStarterDocument = (key: YbcTemplateKey): Json => starters[key]();

/** Whether `key` is one of the Yolo:Bit keys (exact, case-sensitive). */
export const isYbcTemplateKey = (key: string): key is YbcTemplateKey => (ybcTemplateKeys as readonly string[]).includes(key);
