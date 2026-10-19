import { missingCapabilities } from '../capabilities/compose';
import type { HexColour } from '../capabilities/frame';
import { arithType, countUpType, intDivideType, langConstructs, randomIntType, runningTimeType, waitType, whileType } from '../constructs/lang';
import { hardwareConstructOf } from '../constructs/ybc';
import {
  clearDisplayType,
  clearPixelType,
  COLOUR_NAME,
  colourType,
  DEFAULT_COLOUR,
  ICON_NAME,
  IMAGE_SIZE,
  isDisplayText,
  paletteColourOf,
  pixelFieldName,
  scrollNumberType,
  scrollTextType,
  setAllType,
  setPixelType,
  showIconType,
  showImageType,
} from '../constructs/ybc.display';
import { isBuiltinImageName } from '../constructs/ybc.images';
import {
  accelerationType,
  BOTH_BUTTONS,
  buttonPressedType,
  buttonPressesType,
  gestureIsType,
  isAxisName,
  isButtonName,
  isGestureName,
  isPressedButtonName,
  lightLevelType,
  temperatureType,
  type AxisName,
  type ButtonName,
  type GestureName,
  type PressedButtonName,
} from '../constructs/ybc.input';
import {
  PIN_LEVELS,
  PIN_NUMBERS,
  pinAnalogType,
  pinCapabilityOfBlock,
  pinNumberOf,
  pinReadType,
  pinWriteType,
} from '../constructs/ybc.pins';
import {
  isMelodyMode,
  isMelodyName,
  isNoteName,
  melodyType,
  PITCH_MAX_HZ,
  PITCH_MAX_MS,
  PITCH_MIN_HZ,
  pitchType,
  playNoteType,
  restType,
  soundStopType,
  ticksOfOption,
  type MelodyName,
  type NoteName,
  type NoteTicks,
} from '../constructs/ybc.sound';
import { noBoardTarget, type BoardTarget, type HeaderPinCapability } from '../devices/board-pins';
import { exceedsBlockLimit } from './block-walk';
import { blockTypes } from './blocks';
import {
  MAX_PROGRAM_BLOCKS,
  MAX_RANDOM_ABS,
  MAX_RANDOM_SPAN,
  MAX_RANGE_VALUE,
  MAX_REPEAT_ABS,
  MAX_SAFE_INT,
  MAX_TEXT_CHARS,
  MAX_TEXT_JOIN_PARTS,
  MAX_WAIT_MS,
} from './limits';
import type { ArithOp, ColourOperand, CompareOp, Expr, Type, YbcProgramIR, YbcStatement } from './ybc-ir';

// The YBC compiler (YB plan §9.4): Blockly serialization JSON to `YbcProgramIR`,
// with the static types the dialect is defined by (§6.4). Types are known at
// compile time, so the interpreter only meets arithmetic and domain faults.
// Like the legacy compiler it never throws and never imports Blockly: what it
// cannot understand becomes a diagnostic with the block's id. The legacy
// `compileProgram` is not involved and stays as it is.
//
// Literals, integer variables, + − × // %, comparisons, and/or/not, `if` /
// `elif` / `else`, `repeat`, `while`, `count up`, `wait`, text `join`, `print`,
// the onboard hardware of YB-3 (the display, the two buttons, the light sensor
// and the sound), the sensors of N17 B2 (temperature, acceleration, gesture) and
// the header pins of YB-4. A hardware block is compiled
// against the contract domain of its row (notes, ticks, buttons, the display's
// characters, the pins), and a construct that needs a capability the board does
// not have is refused here (`capability-unavailable`, plan §10), so the runtime
// never meets an absent one. It says what the program means; when the
// interpreter yields to the browser is not in the IR.
//
// N17 B1 adds the RGB display (colours, one pixel, all pixels, built-in pictures). A colour is never an error:
// what is not a colour of the palette is shown red, with a warning (`invalid-colour`), so a stored program with
// 'red' or '#ff00' in it still runs (Review Focus 3). A block saved before N17 has no colour and stays red.
//
// N17 B3 adds the built-in melodies, the tone and stop of the Advanced board: the melody and whether the program waits for it
// are fields (an operand); the Hz and the ms of a tone are int expressions, refused here when typed in outside 20..20000 Hz and
// 0..60000 ms, and checked by the interpreter when computed.
//
// N17 B4: "button A+B is pressed" is the `and` of the reads of A and B, so it means exactly what the generator writes for it; the
// running time is a read; a random number has two int ends, each typed-in one checked against ±1000000 and two typed-in ones
// against being more than 1000000 apart (contract C-40). The ends may come in either order: no descending error.

export type YbcDiagnosticCode =
  | 'malformed-program'
  | 'unknown-block'
  | 'duplicate-hat'
  | 'ignored-block'
  | 'capability-unavailable'
  | 'not-eligible'
  | 'unsupported-construct'
  | 'descending-range-not-supported'
  | 'missing-input'
  | 'type-mismatch'
  | 'invalid-condition'
  | 'undefined-variable'
  | 'float-not-supported'
  | 'value-out-of-range'
  | 'limit-exceeded'
  | 'program-too-large'
  | 'capability-unavailable'
  | 'display-char-unsupported'
  | 'invalid-colour';

export type YbcDiagnostic = {
  severity: 'error' | 'warning';
  code: YbcDiagnosticCode;
  message: string;
  blockId?: string;
};

export type YbcCompileResult =
  | { ok: true; ir: YbcProgramIR; diagnostics: YbcDiagnostic[] }
  | { ok: false; diagnostics: YbcDiagnostic[] };

type RawBlock = {
  type: string;
  id: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  next?: Record<string, unknown>;
  disabledReasons?: unknown[];
  extraState?: unknown;
};

/** Blocks nested deeper than this are reported instead of followed, so no stored program can overflow the stack. */
const maxNesting = 100;
/** Statements in one chain; a loop in `next` links is reported, not followed. */
const maxChain = 10_000;

/** Blocks Blockly has that this dialect refuses on purpose, and the contract row that excludes them. None since N17 B4 opened C-40. */
const notEligible: Readonly<Record<string, string>> = {};
/** Blockly's own blocks the dialect has a block of its own for (N17 B4: random, whose ends it takes in either order). */
const replacedBy: Readonly<Record<string, string>> = { math_random_int: randomIntType };

const arithOps: Readonly<Record<string, ArithOp>> = { ADD: '+', MINUS: '-', MULTIPLY: '*' };
const floatOps = new Set(['DIVIDE', 'POWER']);
/** Blockly's own arithmetic block: structurally loadable, but not the dialect's (it has ÷ and power); never read as ybc_arith. */
const foreignArithmetic = 'math_arithmetic';
const compareOps: Readonly<Record<string, CompareOp>> = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
const languageBlockTypes = new Set(langConstructs.flatMap((construct) => construct.blockTypes));
/** The hardware blocks that give a value: one of these cannot be a statement. The colour block only fills a colour input. */
const hardwareValueBlockTypes = new Set([buttonPressedType, buttonPressesType, lightLevelType, colourType, temperatureType, accelerationType, gestureIsType]);
/** C0 and C1 control characters (plan §6.4: print text allows Unicode except these). */
const hasControlCharacter = (text: string) => [...text].some((char) => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
});

/**
 * @param exposedBlockTypes the block types the profile exposes (from its packs); the hats always compile.
 * @param noopBlockTypes block types that compile to a `noop`: only the test-only marker of the profile
 *   fixtures. Any other exposed block type without a handler here is an `unsupported-construct`, never a silent no-op.
 * @param target the board the program is for (`BoardContext.readiness`): its capabilities and the pins usable for
 *   each. A hardware block whose capability is not in it is `capability-unavailable` (plan §10). Left out, a header
 *   pin block is `capability-unavailable` (a board with nothing: no made-up success) and an onboard block is not
 *   checked: only the unit tests of the language and of single blocks leave it out; every caller that has a board
 *   passes it.
 */
export function compileYbcProgram(
  blocksJson: unknown,
  exposedBlockTypes: ReadonlySet<string>,
  noopBlockTypes: ReadonlySet<string> = new Set(),
  target?: BoardTarget,
): YbcCompileResult {
  const diagnostics: YbcDiagnostic[] = [];
  const report = (severity: YbcDiagnostic['severity'], code: YbcDiagnosticCode, message: string, blockId?: string) => {
    diagnostics.push(blockId === undefined ? { severity, code, message } : { severity, code, message, blockId });
  };
  const fail = (): YbcCompileResult => ({ ok: false, diagnostics });

  const topBlocks = topLevelBlocks(blocksJson);
  if (!topBlocks) {
    report('error', 'malformed-program', 'The program is not a Blockly workspace.');
    return fail();
  }
  if (exceedsBlockLimit(blocksJson)) {
    report('error', 'program-too-large', `A program is limited to ${MAX_PROGRAM_BLOCKS} blocks.`);
    return fail();
  }

  // The workspace's variables, by id. In the Basic profile every variable is an int that starts at 0.
  const variables = new Map<string, string>();
  for (const raw of asArray(asRecord(blocksJson)?.variables)) {
    const variable = asRecord(raw);
    if (typeof variable?.id === 'string' && typeof variable.name === 'string') {
      variables.set(variable.id, variable.name);
    }
  }

  const isTooDeep = (depth: number, blockId: string | undefined) => {
    if (depth > maxNesting) {
      report('error', 'malformed-program', 'The program is nested too deeply.', blockId);
    }
    return depth > maxNesting;
  };

  /** Whether the profile shows this block type; says why not otherwise. */
  const isExposed = (block: RawBlock): boolean => {
    if (exposedBlockTypes.has(block.type)) {
      return true;
    }
    const row = Object.hasOwn(notEligible, block.type) ? notEligible[block.type] : undefined;
    const replacement = Object.hasOwn(replacedBy, block.type) ? replacedBy[block.type] : undefined;
    if (replacement !== undefined) {
      report('error', 'not-eligible', `"${block.type}" is not available here; use "${replacement}".`, block.id);
    } else if (block.type === foreignArithmetic) {
      const op = block.fields?.OP;
      if (typeof op === 'string' && floatOps.has(op)) {
        report('error', 'float-not-supported', 'Only +, − and × are supported; use // for whole-number division.', block.id);
      } else {
        report('error', 'unsupported-construct', 'This arithmetic block is not available here; use the + − × block of this profile.', block.id);
      }
    } else if (row !== undefined) {
      report('error', 'not-eligible', `"${block.type}" is not available: it is excluded (${row}).`, block.id);
    } else {
      report('error', 'unknown-block', `Unknown block "${block.type}".`, block.id);
    }
    return false;
  };

  /** The block plugged into a value input; reports a missing, malformed or disabled one. */
  const inputBlock = (owner: RawBlock, name: string, label: string): RawBlock | null => {
    const input = owner.inputs?.[name];
    const record = input === undefined ? null : asRecord(input);
    if (input !== undefined && !record) {
      report('error', 'malformed-program', `The "${name}" input is malformed.`, owner.id);
      return null;
    }
    // A shadow block counts until a real block covers it, as in Blockly.
    const raw = record?.block ?? record?.shadow;
    if (raw === undefined) {
      report('error', 'missing-input', `"${label}" needs a value.`, owner.id);
      return null;
    }
    const block = asBlock(raw);
    if (!block) {
      report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(raw));
      return null;
    }
    if (isDisabled(block)) {
      report('error', 'missing-input', `"${label}" needs a value; the one it has is disabled.`, owner.id);
      return null;
    }
    return block;
  };

  const requireType = (expr: Expr | null, wanted: Type, owner: RawBlock, what: string): Expr | null => {
    if (expr && expr.type !== wanted) {
      report('error', 'type-mismatch', `${what} needs ${describe(wanted)}, not ${describe(expr.type)}.`, expr.blockId || owner.id);
      return null;
    }
    return expr;
  };

  const operand = (owner: RawBlock, name: string, label: string, wanted: Type, what: string, depth: number) => {
    const block = inputBlock(owner, name, label);
    return block ? requireType(compileExpr(block, depth + 1), wanted, owner, what) : null;
  };

  /** Whether the board has the part a hardware block reaches; says so when it has not. */
  const boardHasPartFor = (block: RawBlock): boolean => {
    const construct = hardwareConstructOf(block.type);
    if (!construct || target === undefined || missingCapabilities(target.capabilities, [construct.capability]).length === 0) {
      return true;
    }
    report('error', 'capability-unavailable', `This board has no ${construct.capability} for "${block.type}".`, block.id);
    return false;
  };

  /** The button a press count names: A or B (contract C-13). */
  const buttonOf = (block: RawBlock): ButtonName | null => {
    const button = block.fields?.BUTTON;
    if (typeof button !== 'string') {
      report('error', 'malformed-program', 'A button block needs its button.', block.id);
      return null;
    }
    if (!isButtonName(button)) {
      report('error', 'value-out-of-range', 'A button is A or B.', block.id);
      return null;
    }
    return button;
  };

  /** The button "is pressed" names: A, B or (N17 B4) A+B (contract C-12). */
  const pressedButtonOf = (block: RawBlock): PressedButtonName | null => {
    const button = block.fields?.BUTTON;
    if (typeof button !== 'string') {
      report('error', 'malformed-program', 'A button block needs its button.', block.id);
      return null;
    }
    if (!isPressedButtonName(button)) {
      report('error', 'value-out-of-range', 'A button is A, B or A+B.', block.id);
      return null;
    }
    return button;
  };

  /** The axis an acceleration block names: x, y or z (contract C-17, N17 B2). */
  const axisOf = (block: RawBlock): AxisName | null => {
    const axis = block.fields?.AXIS;
    if (typeof axis !== 'string') {
      report('error', 'malformed-program', 'An acceleration block needs its axis.', block.id);
      return null;
    }
    if (!isAxisName(axis)) {
      report('error', 'value-out-of-range', 'An axis is x, y or z.', block.id);
      return null;
    }
    return axis;
  };

  /** The gesture a gesture block names: one of the seven of its dropdown (contract C-18, N17 B2). */
  const gestureOf = (block: RawBlock): GestureName | null => {
    const gesture = block.fields?.GESTURE;
    if (typeof gesture !== 'string') {
      report('error', 'malformed-program', 'A gesture block needs its gesture.', block.id);
      return null;
    }
    if (!isGestureName(gesture)) {
      report('error', 'value-out-of-range', 'A gesture is one of shake, tilted left or right, face up or down, logo up or down.', block.id);
      return null;
    }
    return gesture;
  };

  /** The length in ticks a note or rest block names: 1, 2 or 4 (contract C-50, C-51). */
  const ticksOf = (block: RawBlock): NoteTicks | null => {
    const ticks = block.fields?.TICKS;
    if (typeof ticks !== 'string') {
      report('error', 'malformed-program', 'A note or rest needs its length.', block.id);
      return null;
    }
    const known = ticksOfOption(ticks);
    if (known === null) {
      report('error', 'value-out-of-range', 'A length is 1, 2 or 4 ticks.', block.id);
    }
    return known;
  };

  /**
   * The pin a pin block names (contract C-23…C-25): the board must have the capability, the name must be
   * `P<N>` with N one of the pins the contract opens, and the board must offer that pin (not reserved) for
   * the capability. Reports and returns null otherwise. The dropdown only offers such pins; a program that
   * arrives from storage is checked all the same (R5).
   */
  const pinOf = (block: RawBlock): number | null => {
    const board = target ?? noBoardTarget;
    const capability: HeaderPinCapability = pinCapabilityOfBlock.get(block.type) ?? 'digital';
    if (!board.capabilities.includes(capability)) {
      report(
        'error',
        'capability-unavailable',
        `This board has no ${capability === 'analogIn' ? 'analog input' : 'digital pin'}, so this block cannot be used.`,
        block.id,
      );
      return null;
    }
    const name = block.fields?.PIN;
    if (typeof name !== 'string') {
      report('error', 'malformed-program', 'A pin block needs its pin.', block.id);
      return null;
    }
    const pin = pinNumberOf(name);
    if (pin === null || !PIN_NUMBERS.includes(pin)) {
      report('error', 'value-out-of-range', 'Only the pins P0, P1 and P2 can be used.', block.id);
      return null;
    }
    if (!board.pins[capability].includes(name)) {
      report('error', 'value-out-of-range', `Pin ${name} cannot be used on this board.`, block.id);
      return null;
    }
    return pin;
  };

  const intLiteral = (value: number, blockId: string): Expr => ({ blockId, type: 'int', kind: 'int', value });

  const compileExpr = (block: RawBlock, depth: number): Expr | null => {
    if (isTooDeep(depth, block.id) || !isExposed(block)) {
      return null;
    }
    const base = { blockId: block.id };
    switch (block.type) {
      case buttonPressedType: {
        const button = boardHasPartFor(block) ? pressedButtonOf(block) : null;
        if (button === null) {
          return null;
        }
        const isPressed = (one: ButtonName): Expr => ({ ...base, type: 'bool', kind: 'read', op: 'button.isPressed', operand: { kind: 'button', button: one } });
        // A+B (N17 B4): true while both are held, A read first and B only when A is held, as the Python's `and` does.
        return button === BOTH_BUTTONS ? { ...base, type: 'bool', kind: 'logic', op: 'and', left: isPressed('A'), right: isPressed('B') } : isPressed(button);
      }
      case buttonPressesType: {
        const button = boardHasPartFor(block) ? buttonOf(block) : null;
        return button === null ? null : { ...base, type: 'int', kind: 'read', op: 'button.getPresses', operand: { kind: 'button', button } };
      }
      case runningTimeType:
        return { ...base, type: 'int', kind: 'read', op: 'time.runningTime' };
      case randomIntType:
        return compileRandom(block, depth);
      case lightLevelType:
        return boardHasPartFor(block) ? { ...base, type: 'int', kind: 'read', op: 'light.level' } : null;
      case temperatureType:
        return boardHasPartFor(block) ? { ...base, type: 'int', kind: 'read', op: 'temperature.read' } : null;
      case accelerationType: {
        const axis = boardHasPartFor(block) ? axisOf(block) : null;
        return axis === null ? null : { ...base, type: 'int', kind: 'read', op: 'motion.acceleration', operand: { kind: 'axis', axis } };
      }
      case gestureIsType: {
        const gesture = boardHasPartFor(block) ? gestureOf(block) : null;
        return gesture === null ? null : { ...base, type: 'bool', kind: 'read', op: 'motion.isGesture', operand: { kind: 'gesture', gesture } };
      }
      case pinReadType:
      case pinAnalogType: {
        const pin = pinOf(block);
        if (pin === null) {
          return null;
        }
        return block.type === pinReadType
          ? { ...base, type: 'bool', kind: 'read', op: 'digital.read', args: [intLiteral(pin, block.id)] }
          : { ...base, type: 'int', kind: 'read', op: 'analogIn.read', args: [intLiteral(pin, block.id)] };
      }
      case 'math_number': {
        const value = block.fields?.NUM;
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
          report('error', 'float-not-supported', 'Only whole numbers are supported.', block.id);
          return null;
        }
        if (!Number.isSafeInteger(value)) {
          report('error', 'value-out-of-range', `A number must be between -${MAX_SAFE_INT} and ${MAX_SAFE_INT}.`, block.id);
          return null;
        }
        return { ...base, type: 'int', kind: 'int', value: value === 0 ? 0 : value };
      }
      case 'logic_boolean': {
        const value = block.fields?.BOOL;
        if (value !== 'TRUE' && value !== 'FALSE') {
          report('error', 'malformed-program', 'A true / false block needs its value.', block.id);
          return null;
        }
        return { ...base, type: 'bool', kind: 'bool', value: value === 'TRUE' };
      }
      case 'text': {
        const value = block.fields?.TEXT;
        if (typeof value !== 'string') {
          report('error', 'malformed-program', 'A text block needs its text.', block.id);
          return null;
        }
        if (value.length > MAX_TEXT_CHARS) {
          report('error', 'limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`, block.id);
          return null;
        }
        if (hasControlCharacter(value)) {
          report('error', 'value-out-of-range', 'A text cannot contain control characters.', block.id);
          return null;
        }
        return { ...base, type: 'str', kind: 'str', value };
      }
      case 'variables_get': {
        const id = variableId(block);
        if (id === null) {
          report('error', 'malformed-program', 'A variable block needs its variable.', block.id);
          return null;
        }
        if (!variables.has(id)) {
          report('error', 'undefined-variable', 'This variable does not exist.', block.id);
          return null;
        }
        return { ...base, type: 'int', kind: 'variable', variable: id };
      }
      case arithType: {
        const op = block.fields?.OP;
        const symbol = typeof op === 'string' ? arithOps[op] : undefined;
        if (!symbol) {
          report('error', 'malformed-program', 'An arithmetic block needs its operation.', block.id);
          return null;
        }
        return arithmetic(block, symbol, 'A', 'B', depth);
      }
      case 'math_modulo':
        return arithmetic(block, '%', 'DIVIDEND', 'DIVISOR', depth);
      case intDivideType:
        return arithmetic(block, '//', 'A', 'B', depth);
      case 'logic_compare': {
        const op = typeof block.fields?.OP === 'string' ? compareOps[block.fields.OP] : undefined;
        if (!op) {
          report('error', 'malformed-program', 'A comparison needs its operator.', block.id);
          return null;
        }
        const leftBlock = inputBlock(block, 'A', 'compare');
        const rightBlock = inputBlock(block, 'B', 'compare');
        const left = leftBlock && compileExpr(leftBlock, depth + 1);
        const right = rightBlock && compileExpr(rightBlock, depth + 1);
        if (!left || !right) {
          return null;
        }
        const ordering = op !== '==' && op !== '!=';
        if (left.type !== right.type || (ordering && left.type !== 'int')) {
          report(
            'error',
            'type-mismatch',
            ordering
              ? `"${op}" compares whole numbers, not ${describe(left.type)} and ${describe(right.type)}.`
              : `"${op}" compares two values of one type, not ${describe(left.type)} and ${describe(right.type)}.`,
            block.id,
          );
          return null;
        }
        return { ...base, type: 'bool', kind: 'compare', op, left, right };
      }
      case 'logic_operation': {
        const op = block.fields?.OP;
        if (op !== 'AND' && op !== 'OR') {
          report('error', 'malformed-program', 'A logic block needs "and" or "or".', block.id);
          return null;
        }
        const left = operand(block, 'A', op === 'AND' ? 'and' : 'or', 'bool', `"${op === 'AND' ? 'and' : 'or'}"`, depth);
        const right = operand(block, 'B', op === 'AND' ? 'and' : 'or', 'bool', `"${op === 'AND' ? 'and' : 'or'}"`, depth);
        return left && right ? { ...base, type: 'bool', kind: 'logic', op: op === 'AND' ? 'and' : 'or', left, right } : null;
      }
      case 'text_join': {
        const state = block.extraState === undefined ? {} : asRecord(block.extraState);
        const count = state?.itemCount ?? 2;
        if (!state || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
          report('error', 'malformed-program', 'The number of parts of "join" is malformed.', block.id);
          return null;
        }
        if (count > MAX_TEXT_JOIN_PARTS) {
          report('error', 'limit-exceeded', `"join" takes at most ${MAX_TEXT_JOIN_PARTS} parts.`, block.id);
          return null;
        }
        const parts: Expr[] = [];
        for (let index = 0; index < count; index++) {
          const part = inputBlock(block, `ADD${index}`, 'join');
          const compiled = part && compileExpr(part, depth + 1);
          if (compiled) {
            parts.push(compiled);
          }
        }
        return parts.length === count ? { ...base, type: 'str', kind: 'join', parts } : null;
      }
      case 'logic_negate': {
        const value = operand(block, 'BOOL', 'not', 'bool', '"not"', depth);
        return value ? { ...base, type: 'bool', kind: 'not', value } : null;
      }
      default:
        report('error', 'unsupported-construct', `"${block.type}" cannot be used as a value.`, block.id);
        return null;
    }
  };

  /**
   * C-40 (N17 B4): the two ends, each an int; a typed-in one outside ±MAX_RANDOM_ABS, and two typed-in ones more than
   * MAX_RANDOM_SPAN apart, are refused here. Computed ones are the interpreter's to check. The order of the ends does not matter.
   */
  const compileRandom = (block: RawBlock, depth: number): Expr | null => {
    const what = '"random number"';
    const from = operand(block, 'FROM', 'random number', 'int', what, depth);
    const to = operand(block, 'TO', 'random number', 'int', what, depth);
    const badFrom = outsideLiteral(from, -MAX_RANDOM_ABS, MAX_RANDOM_ABS, 'A bound of a random number');
    const badTo = outsideLiteral(to, -MAX_RANDOM_ABS, MAX_RANDOM_ABS, 'A bound of a random number');
    const low = literal(from);
    const high = literal(to);
    const apart = low !== null && high !== null && !badFrom && !badTo && Math.abs(high - low) > MAX_RANDOM_SPAN;
    if (apart) {
      report('error', 'value-out-of-range', `The bounds of a random number must be at most ${MAX_RANDOM_SPAN} apart.`, block.id);
    }
    return from && to && !badFrom && !badTo && !apart ? { blockId: block.id, type: 'int', kind: 'read', op: 'random.int', args: [from, to] } : null;
  };

  const arithmetic = (block: RawBlock, op: ArithOp, leftName: string, rightName: string, depth: number): Expr | null => {
    const what = `"${op}"`;
    const left = operand(block, leftName, what, 'int', what, depth);
    const right = operand(block, rightName, what, 'int', what, depth);
    return left && right ? { blockId: block.id, type: 'int', kind: 'arith', op, left, right } : null;
  };

  /** An absent statement input is an empty body; a present one must be an object. */
  const firstStatementIn = (block: RawBlock, inputName: string): unknown => {
    const input = block.inputs?.[inputName];
    if (input === undefined) {
      return undefined;
    }
    const record = asRecord(input);
    if (!record) {
      report('error', 'malformed-program', `The "${inputName}" input is malformed.`, block.id);
      return undefined;
    }
    return record.block;
  };

  const compileIf = (block: RawBlock, depth: number): YbcStatement | null => {
    const state = block.extraState === undefined ? {} : asRecord(block.extraState);
    const elseIfCount = state?.elseIfCount ?? 0;
    const hasElse = state?.hasElse ?? false;
    if (
      !state ||
      typeof elseIfCount !== 'number' ||
      !Number.isSafeInteger(elseIfCount) ||
      elseIfCount < 0 ||
      typeof hasElse !== 'boolean'
    ) {
      report('error', 'malformed-program', 'The else-if count or the else of "if" is malformed.', block.id);
      return null;
    }
    // Each branch needs its own condition input, so a count past the number of inputs is already an
    // error at the first missing one; never loop on to the count itself.
    const branchCount = Math.min(elseIfCount, Object.keys(block.inputs ?? {}).length) + 1;
    const branches: { condition: Expr; body: YbcStatement[] }[] = [];
    for (let index = 0; index < branchCount; index++) {
      const label = index === 0 ? 'if' : 'else if';
      const conditionBlock = inputBlock(block, `IF${index}`, label);
      const compiled = conditionBlock && compileExpr(conditionBlock, depth + 1);
      const body = compileChain(firstStatementIn(block, `DO${index}`), depth + 1);
      if (compiled?.type === 'bool') {
        branches.push({ condition: compiled, body });
      } else if (compiled) {
        report('error', 'invalid-condition', `"${label}" needs a true / false condition, not ${describe(compiled.type)}.`, block.id);
      }
    }
    const otherwise = hasElse ? compileChain(firstStatementIn(block, 'ELSE'), depth + 1) : [];
    // A branch that failed was reported, and an error keeps the program from running.
    return branches.length === branchCount ? { kind: 'if', branches, else: otherwise, blockId: block.id } : null;
  };

  /** The value of an int operand typed into the block; null for anything computed. */
  const literal = (expr: Expr | null): number | null => (expr?.kind === 'int' ? expr.value : null);

  /** Reports a typed-in number outside `low..high`. Computed values are guarded when the program runs. */
  const outsideLiteral = (expr: Expr | null, low: number, high: number, what: string): boolean => {
    const value = literal(expr);
    if (expr && value !== null && (value < low || value > high)) {
      report('error', 'value-out-of-range', `${what} must be between ${low} and ${high}.`, expr.blockId);
      return true;
    }
    return false;
  };

  const compileRepeat = (block: RawBlock, depth: number): YbcStatement | null => {
    const times = operand(block, 'TIMES', 'repeat', 'int', '"repeat"', depth);
    // Python's range: zero or less runs zero times; only the size is limited (contract section 3.2).
    const tooBig = outsideLiteral(times, -MAX_REPEAT_ABS, MAX_REPEAT_ABS, 'The number of repetitions');
    const body = compileChain(firstStatementIn(block, 'DO'), depth + 1);
    return times && !tooBig ? { kind: 'repeat', times, body, blockId: block.id } : null;
  };

  const compileWhile = (block: RawBlock, depth: number): YbcStatement | null => {
    const conditionBlock = inputBlock(block, 'COND', 'while');
    const compiled = conditionBlock && compileExpr(conditionBlock, depth + 1);
    let condition: Expr | null = null;
    if (compiled?.type === 'bool') {
      condition = compiled;
    } else if (compiled) {
      report('error', 'invalid-condition', `"while" needs a true / false condition, not ${describe(compiled.type)}.`, block.id);
    }
    const body = compileChain(firstStatementIn(block, 'DO'), depth + 1);
    return condition ? { kind: 'while', condition, body, blockId: block.id } : null;
  };

  const compileCountUp = (block: RawBlock, depth: number): YbcStatement | null => {
    const id = variableId(block);
    let variable: string | null = null;
    if (id === null) {
      report('error', 'malformed-program', '"count up" needs its variable.', block.id);
    } else if (!variables.has(id)) {
      report('error', 'undefined-variable', 'This variable does not exist.', block.id);
    } else {
      variable = id;
    }
    // The step is a number typed into the block, never a computed value (contract section 3.3).
    const step = block.fields?.STEP;
    let stepOk = false;
    if (typeof step !== 'number' || !Number.isInteger(step)) {
      report('error', 'malformed-program', '"count up" needs a whole-number step.', block.id);
    } else if (step < 1 || step > MAX_RANGE_VALUE) {
      report('error', 'value-out-of-range', `The step must be between 1 and ${MAX_RANGE_VALUE}.`, block.id);
    } else {
      stepOk = true;
    }
    const from = operand(block, 'FROM', 'count up from', 'int', '"count up" start', depth);
    const to = operand(block, 'TO', 'count up to', 'int', '"count up" end', depth);
    const badFrom = outsideLiteral(from, 0, MAX_RANGE_VALUE, 'The start');
    const badTo = outsideLiteral(to, 0, MAX_RANGE_VALUE, 'The end');
    // Both bounds typed in and counting down: a mistake we can name now. A computed bound that turns out
    // smaller just runs zero times, as Python's range does.
    const start = literal(from);
    const end = literal(to);
    const descending = start !== null && end !== null && start > end && !badFrom && !badTo;
    if (descending) {
      report('error', 'descending-range-not-supported', '"count up" cannot count down; use "repeat" and a variable.', block.id);
    }
    const body = compileChain(firstStatementIn(block, 'DO'), depth + 1);
    return variable !== null && stepOk && from && to && !badFrom && !badTo && !descending
      ? { kind: 'countUp', variable, from, to, step: step as number, body, blockId: block.id }
      : null;
  };

  const compileWait = (block: RawBlock, depth: number): YbcStatement | null => {
    const ms = operand(block, 'MS', 'wait', 'int', '"wait"', depth);
    return ms && !outsideLiteral(ms, 0, MAX_WAIT_MS, 'A wait') ? { kind: 'waitMs', ms, blockId: block.id } : null;
  };

  /** C-06: the picture the 25 checkboxes of the block make. A checkbox Blockly never saved is unticked, as Blockly loads it. */
  const compileShowImage = (block: RawBlock): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const pixels: boolean[] = [];
    let wellFormed = true;
    for (let row = 0; row < IMAGE_SIZE; row++) {
      for (let column = 0; column < IMAGE_SIZE; column++) {
        const lit = block.fields?.[pixelFieldName(row, column)];
        wellFormed &&= lit === undefined || typeof lit === 'boolean';
        pixels.push(lit === true);
      }
    }
    if (!wellFormed) {
      report('error', 'malformed-program', 'Every square of a picture is either lit or not.', block.id);
      return null;
    }
    // N17: the colour field. A picture saved before it has none and is red; red is left out of the IR, so both are the same program.
    const field = block.fields?.[COLOUR_NAME];
    const colour = field === undefined ? DEFAULT_COLOUR : colourValue(field, block.id);
    const image = { source: 'custom' as const, pixels, ...(colour === DEFAULT_COLOUR ? {} : { colour }) };
    return { kind: 'call', op: 'display.show', operand: { kind: 'image', image }, blockId: block.id };
  };

  /**
   * N17 B1: a colour as a frame holds it. What is not one of the palette's (a name, a short code, an empty text, a colour
   * outside the palette, nothing at all) is red, with a warning on `blockId`: never an error (Review Focus 3).
   */
  const colourValue = (value: unknown, blockId: string): HexColour => {
    const colour = paletteColourOf(value);
    if (colour !== null) {
      return colour;
    }
    if (value === undefined) {
      report('warning', 'invalid-colour', 'A colour block needs its colour, so it is shown red.', blockId);
    } else {
      report('warning', 'invalid-colour', `The colour "${String(value)}" is not one of the display's colours, so it is shown red.`, blockId);
    }
    return DEFAULT_COLOUR;
  };

  /**
   * The colour in the colour input of a block (N17 B1), or undefined when the input is empty: a block saved before N17 has
   * none, and an empty input is red, as the display always was. A shadow counts until a block that is not disabled covers it,
   * as in Blockly. The editor only fits the colour block there; a stored program may hold anything, and a typed-in text
   * is read as a colour code. Nothing here is ever an error.
   */
  const colourIn = (owner: RawBlock): HexColour | undefined => {
    const input = owner.inputs?.[COLOUR_NAME];
    if (input === undefined) {
      return undefined;
    }
    const record = asRecord(input);
    const real = asBlock(record?.block);
    const shadow = asBlock(record?.shadow);
    const plugged = real && !isDisabled(real) ? real : shadow && !isDisabled(shadow) ? shadow : null;
    if (!plugged) {
      if (!record || (record.block !== undefined && !real) || (record.shadow !== undefined && !shadow)) {
        return colourValue(undefined, owner.id);
      }
      return undefined;
    }
    switch (plugged.type) {
      case colourType:
        return colourValue(plugged.fields?.[COLOUR_NAME], plugged.id);
      case 'text':
        return colourValue(plugged.fields?.TEXT, plugged.id);
      default:
        report('warning', 'invalid-colour', `"${plugged.type}" is not a colour, so it is shown red.`, plugged.id);
        return DEFAULT_COLOUR;
    }
  };

  /** The colour operand of a scroll: none for red, so a scroll saved before N17 and a red one are the same IR. */
  const scrollColour = (block: RawBlock): { operand?: ColourOperand } => {
    const colour = colourIn(block);
    return colour === undefined || colour === DEFAULT_COLOUR ? {} : { operand: { kind: 'colour', colour } };
  };

  /** C-05: one of the built-in pictures, by the name the block's dropdown saves. */
  const compileShowIcon = (block: RawBlock): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const name = block.fields?.[ICON_NAME];
    if (typeof name !== 'string') {
      report('error', 'malformed-program', 'A picture block needs its picture.', block.id);
      return null;
    }
    if (!isBuiltinImageName(name)) {
      report('error', 'value-out-of-range', 'A picture is one of the built-in pictures of the display.', block.id);
      return null;
    }
    return { kind: 'call', op: 'display.show', operand: { kind: 'image', image: { source: 'builtin', name } }, blockId: block.id };
  };

  /**
   * The column and the row of a pixel block (C-10, C-42): whole numbers, each 0..4 when typed in (contract domain); a computed
   * one is checked when the program runs.
   */
  const pixelOf = (block: RawBlock, label: string, depth: number): [x: Expr, y: Expr] | null => {
    const x = operand(block, 'X', label, 'int', 'The column', depth);
    const y = operand(block, 'Y', label, 'int', 'The row', depth);
    const badX = outsideLiteral(x, 0, IMAGE_SIZE - 1, 'The column');
    const badY = outsideLiteral(y, 0, IMAGE_SIZE - 1, 'The row');
    return x && y && !badX && !badY ? [x, y] : null;
  };

  const compileSetPixel = (block: RawBlock, depth: number): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const cell = pixelOf(block, 'set light', depth);
    const colour = colourIn(block) ?? DEFAULT_COLOUR;
    return cell ? { kind: 'call', op: 'display.setPixel', args: cell, operand: { kind: 'colour', colour }, blockId: block.id } : null;
  };

  const compileClearPixel = (block: RawBlock, depth: number): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const cell = pixelOf(block, 'turn off light', depth);
    return cell ? { kind: 'call', op: 'display.clearPixel', args: cell, blockId: block.id } : null;
  };

  const compileSetAll = (block: RawBlock): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const colour = colourIn(block) ?? DEFAULT_COLOUR;
    return { kind: 'call', op: 'display.setAll', operand: { kind: 'colour', colour }, blockId: block.id };
  };

  /** The text typed into a `text` block plugged into an input, read without compiling it (and so without the language rules for print text). */
  const typedText = (owner: RawBlock, name: string): { value: string; blockId: string } | null => {
    const input = asRecord(owner.inputs?.[name]);
    const plugged = asBlock(input?.block ?? input?.shadow);
    const value = plugged?.fields?.TEXT;
    return plugged && plugged.type === 'text' && !isDisabled(plugged) && typeof value === 'string' ? { value, blockId: plugged.id } : null;
  };

  /**
   * C-07: a typed-in text must be made of the display's characters (ASCII 0x20–0x7E), and the contract names the diagnostic
   * for one that is not, whatever the character is, so this looks before the text block is compiled (a tab or a new line
   * would otherwise meet the language rule of `print` first). A computed text is checked when the program runs.
   */
  const compileScrollText = (block: RawBlock, depth: number): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const typed = typedText(block, 'TEXT');
    if (typed && !isDisplayText(typed.value)) {
      report('error', 'display-char-unsupported', 'The display shows only the characters from space to ~ (ASCII).', typed.blockId);
      return null;
    }
    const text = operand(block, 'TEXT', 'scroll text', 'str', '"scroll text"', depth);
    const colour = scrollColour(block);
    return text ? { kind: 'call', op: 'display.scrollText', args: [text], ...colour, blockId: block.id } : null;
  };

  const compileScrollNumber = (block: RawBlock, depth: number): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const value = operand(block, 'NUM', 'scroll number', 'int', '"scroll number"', depth);
    const colour = scrollColour(block);
    return value ? { kind: 'call', op: 'display.scrollNumber', args: [value], ...colour, blockId: block.id } : null;
  };

  /** C-50: one of the 15 natural notes C3…C5 for 1, 2 or 4 ticks. */
  const compilePlayNote = (block: RawBlock): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const note = block.fields?.NOTE;
    let named: NoteName | null = null;
    if (typeof note !== 'string') {
      report('error', 'malformed-program', 'A note block needs its note.', block.id);
    } else if (!isNoteName(note)) {
      report('error', 'value-out-of-range', 'A note is one of the natural notes from C3 to C5.', block.id);
    } else {
      named = note;
    }
    const ticks = ticksOf(block);
    return named !== null && ticks !== null ? { kind: 'call', op: 'sound.playNote', operand: { kind: 'note', note: named, ticks }, blockId: block.id } : null;
  };

  /** C-51: silence for 1, 2 or 4 ticks. */
  const compileRest = (block: RawBlock): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const ticks = ticksOf(block);
    return ticks !== null ? { kind: 'call', op: 'sound.rest', operand: { kind: 'rest', ticks }, blockId: block.id } : null;
  };

  /** C-20 (N17 B3): one of the twenty built-in melodies, until done or in the background. */
  const compileMelody = (block: RawBlock): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const melody = block.fields?.MELODY;
    const mode = block.fields?.MODE;
    let named: MelodyName | null = null;
    let wait: boolean | null = null;
    if (typeof melody !== 'string') {
      report('error', 'malformed-program', 'A melody block needs its melody.', block.id);
    } else if (!isMelodyName(melody)) {
      report('error', 'value-out-of-range', 'A melody is one of the built-in melodies.', block.id);
    } else {
      named = melody;
    }
    if (typeof mode !== 'string') {
      report('error', 'malformed-program', 'A melody block needs to say whether the program waits for it.', block.id);
    } else if (!isMelodyMode(mode)) {
      report('error', 'value-out-of-range', 'A melody plays until done or in the background.', block.id);
    } else {
      wait = mode === 'wait';
    }
    return named !== null && wait !== null ? { kind: 'call', op: 'sound.playMelody', operand: { kind: 'melody', melody: named, wait }, blockId: block.id } : null;
  };

  /** C-21 (N17 B3): a tone of 20..20000 Hz for 0..60000 ms, each a whole number; typed-in values are checked here. */
  const compilePitch = (block: RawBlock, depth: number): YbcStatement | null => {
    if (!boardHasPartFor(block)) {
      return null;
    }
    const hz = operand(block, 'HZ', 'start tone', 'int', 'The frequency', depth);
    const ms = operand(block, 'MS', 'start tone', 'int', 'The length of a tone', depth);
    const badHz = outsideLiteral(hz, PITCH_MIN_HZ, PITCH_MAX_HZ, 'The frequency');
    const badMs = outsideLiteral(ms, 0, PITCH_MAX_MS, 'The length of a tone');
    return hz && ms && !badHz && !badMs ? { kind: 'call', op: 'sound.pitch', args: [hz, ms], blockId: block.id } : null;
  };

  /** "set pin P to ON / OFF" (C-23): the pin and the level are chosen in the block, so both are literals of the IR. */
  const compilePinWrite = (block: RawBlock): YbcStatement | null => {
    const pin = pinOf(block);
    const level = block.fields?.LEVEL;
    let value: number | null = null;
    if (typeof level !== 'string') {
      report('error', 'malformed-program', 'A "set pin" block needs ON or OFF.', block.id);
    } else if (/^(0|[1-9]\d*)$/.test(level) && PIN_LEVELS.includes(Number(level))) {
      value = Number(level);
    } else {
      report('error', 'value-out-of-range', 'A pin is set ON or OFF.', block.id);
    }
    return pin !== null && value !== null
      ? { kind: 'call', op: 'digital.write', args: [intLiteral(pin, block.id), intLiteral(value, block.id)], blockId: block.id }
      : null;
  };

  const compileStatement = (block: RawBlock, depth: number): YbcStatement | null => {
    if (!isExposed(block)) {
      return null;
    }
    switch (block.type) {
      case showImageType:
        return compileShowImage(block);
      case scrollTextType:
        return compileScrollText(block, depth);
      case scrollNumberType:
        return compileScrollNumber(block, depth);
      case clearDisplayType:
        return boardHasPartFor(block) ? { kind: 'call', op: 'display.clear', blockId: block.id } : null;
      case showIconType:
        return compileShowIcon(block);
      case setPixelType:
        return compileSetPixel(block, depth);
      case clearPixelType:
        return compileClearPixel(block, depth);
      case setAllType:
        return compileSetAll(block);
      case playNoteType:
        return compilePlayNote(block);
      case restType:
        return compileRest(block);
      case melodyType:
        return compileMelody(block);
      case pitchType:
        return compilePitch(block, depth);
      case soundStopType:
        return boardHasPartFor(block) ? { kind: 'call', op: 'sound.stop', blockId: block.id } : null;
      case 'variables_set': {
        const id = variableId(block);
        if (id === null) {
          report('error', 'malformed-program', 'A "set" block needs its variable.', block.id);
          return null;
        }
        if (!variables.has(id)) {
          report('error', 'undefined-variable', 'This variable does not exist.', block.id);
          return null;
        }
        const value = operand(block, 'VALUE', `set ${variables.get(id)}`, 'int', `"${variables.get(id)}" (a whole-number variable)`, depth);
        return value ? { kind: 'set', variable: id, value, blockId: block.id } : null;
      }
      case 'text_print': {
        const valueBlock = inputBlock(block, 'TEXT', 'print');
        const value = valueBlock && compileExpr(valueBlock, depth + 1);
        return value ? { kind: 'print', value, blockId: block.id } : null;
      }
      case 'controls_if':
        return compileIf(block, depth);
      case 'controls_repeat_ext':
        return compileRepeat(block, depth);
      case whileType:
        return compileWhile(block, depth);
      case countUpType:
        return compileCountUp(block, depth);
      case waitType:
        return compileWait(block, depth);
      case pinWriteType:
        return compilePinWrite(block);
      default:
        if (languageBlockTypes.has(block.type) || hardwareValueBlockTypes.has(block.type)) {
          report('error', 'unsupported-construct', `"${block.type}" cannot be used as a statement.`, block.id);
          return null;
        }
        if (noopBlockTypes.has(block.type)) {
          return { kind: 'noop', blockId: block.id };
        }
        // Exposed by a profile but with no meaning here: refuse it, never run it as nothing.
        report('error', 'unsupported-construct', `"${block.type}" is not supported by the compiler.`, block.id);
        return null;
    }
  };

  const compileChain = (first: unknown, depth: number): YbcStatement[] => {
    const statements: YbcStatement[] = [];
    if (first !== undefined && isTooDeep(depth, blockIdOf(first))) {
      return statements;
    }
    let count = 0;
    for (let current = first; current !== undefined; ) {
      const block = asBlock(current);
      if (!block) {
        report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(current));
        break;
      }
      if (++count > maxChain) {
        report('error', 'malformed-program', 'The program is nested too deeply.', block.id);
        break;
      }
      // A disabled statement does not run, but the blocks after it still do.
      const statement = isDisabled(block) ? null : compileStatement(block, depth);
      if (statement) {
        statements.push(statement);
      }
      current = asRecord(block.next)?.block;
    }
    return statements;
  };

  let onStart: YbcStatement[] | null = null;
  let forever: YbcStatement[] | null = null;
  for (const raw of topBlocks) {
    const block = asBlock(raw);
    if (!block) {
      report('error', 'malformed-program', 'A block in the program is malformed.', blockIdOf(raw));
      continue;
    }
    if (isDisabled(block)) {
      continue;
    }
    if (block.type !== blockTypes.onStart && block.type !== blockTypes.forever) {
      report('warning', 'ignored-block', 'Blocks outside "on start" and "forever" do not run.', block.id);
      continue;
    }
    if ((block.type === blockTypes.onStart ? onStart : forever) !== null) {
      report('error', 'duplicate-hat', `Only one "${block.type}" block is allowed.`, block.id);
      continue;
    }
    const body = compileChain(firstStatementIn(block, 'DO'), 0);
    if (block.type === blockTypes.onStart) {
      onStart = body;
    } else {
      forever = body;
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return fail();
  }
  return {
    ok: true,
    ir: {
      onStart: onStart ?? [],
      forever,
      variables: [...variables].map(([id, name]) => ({ id, name, type: 'int' })),
    },
    diagnostics,
  };
}

const describe = (type: Type) => (type === 'int' ? 'a whole number' : type === 'bool' ? 'a true / false value' : 'a text');

/** The id of the variable a get / set block names (`fields.VAR` is `{ id }` in Blockly's serialization). */
function variableId(block: RawBlock): string | null {
  const id = asRecord(block.fields?.VAR)?.id;
  return typeof id === 'string' ? id : null;
}

function topLevelBlocks(json: unknown): unknown[] | null {
  const workspace = asRecord(json);
  if (!workspace) {
    return null;
  }
  if (workspace.blocks === undefined) {
    return [];
  }
  const blocks = asRecord(workspace.blocks)?.blocks;
  return Array.isArray(blocks) ? blocks : null;
}

function asBlock(value: unknown): RawBlock | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string' || typeof record.id !== 'string') {
    return null;
  }
  for (const key of ['fields', 'inputs', 'next'] as const) {
    if (record[key] !== undefined && !asRecord(record[key])) {
      return null;
    }
  }
  if (record.disabledReasons !== undefined && !Array.isArray(record.disabledReasons)) {
    return null;
  }
  return record as RawBlock;
}

function isDisabled(block: RawBlock): boolean {
  return (block.disabledReasons?.length ?? 0) > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function blockIdOf(value: unknown): string | undefined {
  const id = asRecord(value)?.id;
  return typeof id === 'string' ? id : undefined;
}
