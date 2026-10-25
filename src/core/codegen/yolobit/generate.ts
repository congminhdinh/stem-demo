import { DEFAULT_COLOUR, IMAGE_SIZE, isDisplayText, paletteColourOf, paletteDigitOf } from '../../constructs/ybc.display';
import { builtinImageRows, isBuiltinImageName, vendorImageNames } from '../../constructs/ybc.images';
import { isAxisName, isButtonName, isGestureName } from '../../constructs/ybc.input';
import { PIN_LEVELS, PIN_NUMBERS, PWM_MAX, SERVO_MAX_ANGLE } from '../../constructs/ybc.pins';
import { isMelodyName, isNoteName, noteTicks, PITCH_MAX_HZ, PITCH_MAX_MS, PITCH_MIN_HZ } from '../../constructs/ybc.sound';
import { MAX_RANDOM_ABS, MAX_RANDOM_SPAN, MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_SAFE_INT, MAX_TEXT_CHARS, MAX_WAIT_MS } from '../../program/limits';
import { isModuleCall, isModuleRead, type ArithOp, type CallStatement, type ColourOperand, type Expr, type RandomExpr, type ReadExpr, type Type, type YbcProgramIR, type YbcStatement } from '../../program/ybc-ir';
import { MAX_EXPRESSION_DEPTH, MAX_GENERATED_BYTES, MAX_STATEMENT_DEPTH } from './limits';
import { moduleOfOp, yolobitModuleLines } from './modules';
import { assignNames } from './names';
import { defaultTarget, type GenTarget } from './target';

// The Yolo:Bit MicroPython generator (YB plan §13): `YbcProgramIR` to source text.
// It is the second consumer of the IR, next to the simulator's interpreter; it
// never sees Blockly and never runs anything. It emits what the learner program
// MEANS: no execution-budget housekeeping, no console limits, no simulator
// helpers. Anything it cannot say faithfully is a diagnostic, never a half
// program (K4): the result has either source or diagnostics.

/**
 * The contract rows the generator can emit: the language layer (YB-5A), the onboard hardware of YB-3 (display C-06…C-09,
 * buttons C-12 and C-13, light C-15, sound C-50 and C-51), the header pins of YB-4 (C-23, C-24, C-25), the RGB display
 * of N17 B1 (built-in pictures C-05, set pixel C-10, clear pixel C-42, set all C-43), the sensors of N17 B2 (temperature
 * C-16, acceleration C-17, gesture C-18), the buzzer of N17 B3 (melody C-20, tone C-21, stop C-22), N17 B4's running time
 * (C-19) and random number (C-40), and N17 B5's analog write (C-26) and servo (C-27); A+B is C-12 twice with C-35's `and`. The
 * other hardware rows arrive with their phases.
 */
export const generatedConstructs = [
  'C-01', 'C-02', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08', 'C-09', 'C-10', 'C-12', 'C-13', 'C-15', 'C-16', 'C-17', 'C-18', 'C-19', 'C-20', 'C-21', 'C-22', 'C-23',
  'C-24', 'C-25', 'C-26', 'C-27', 'C-29', 'C-30', 'C-31', 'C-32', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-40', 'C-42', 'C-43', 'C-50', 'C-51', 'C-56',
] as const;

export type GenDiagnosticCode =
  | 'unsupported-node'
  | 'invalid-literal'
  | 'invalid-identifier'
  | 'unknown-variable'
  | 'type-mismatch'
  | 'value-out-of-range'
  | 'descending-range-not-supported'
  | 'limit-exceeded'
  | 'program-too-large';

export type GenDiagnostic = { severity: 'error'; code: GenDiagnosticCode; message: string; blockId?: string };

export type GenerateResult =
  | {
      ok: true;
      source: string;
      /** 1-based line of the first line each block produced. */
      lineMap: { line: number; blockId: string }[];
      /** Blockly variable id to the Python name. */
      names: Record<string, string>;
      diagnostics: [];
    }
  | { ok: false; diagnostics: GenDiagnostic[] };

const indentUnit = '    ';

// Python precedence, low to high. A negative literal has precedence 0 so that it is always
// parenthesised inside an operation: `a - (-5)`, never `a - -5`.
const precOr = 1;
const precAnd = 2;
const precNot = 3;
const precCompare = 4;
const precAdd = 5;
const precMul = 6;
const precAtom = 8;
const precNegative = 0;

const arithPrecedence: Record<ArithOp, number> = { '+': precAdd, '-': precAdd, '*': precMul, '//': precMul, '%': precMul };

/** A Python string literal in single quotes (plan §13.4). Null for text that has no UTF-8 form (a lone surrogate). */
export function pythonString(text: string): string | null {
  let out = "'";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) {
      return null;
    }
    if (char === '\\') {
      out += '\\\\';
    } else if (char === "'") {
      out += "\\'";
    } else if (char === '\n') {
      out += '\\n';
    } else if (char === '\r') {
      out += '\\r';
    } else if (char === '\t') {
      out += '\\t';
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else {
      out += char;
    }
  }
  return `${out}'`;
}

type Rendered = { text: string; prec: number };

// The modules of the hardware (contract §2.3). IM-2: `from yolobit import *` and exactly three lines of preamble,
// right after `import time` (`yolobitModuleLines`). IM-3 / IM-4: `import music` and, because the generator fixes the
// tempo, `music.set_tempo(4, 120)`. The order is fixed: time, yolobit with its preamble, music, then (N17 B4) `import random` once
// when a random number is used. They are written here
// and in modules.ts, not read from the contract data, so that the large contract stays out of the app bundle;
// generate.constructs.test.ts keeps them equal to the contract.
const musicHeader = ['import music', 'music.set_tempo(4, 120)'] as const;

/**
 * Which modules the program needs. An explicit stack, not recursion: the IR may be nested as deep as a hostile document
 * asks, and the generator never throws (it reports the depth later, when it writes the nesting).
 */
function modulesUsed(ir: YbcProgramIR): { yolobit: boolean; music: boolean; random: boolean } {
  const used = { yolobit: false, music: false, random: false };
  const pending: unknown[] = [ir.onStart, ir.forever];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node !== 'object' || node === null) {
      continue;
    }
    const { kind, op } = node as { kind?: unknown; op?: unknown };
    if ((kind === 'call' || kind === 'read') && typeof op === 'string' && Object.hasOwn(moduleOfOp, op)) {
      used[moduleOfOp[op as keyof typeof moduleOfOp]] = true;
    }
    pending.push(...Object.values(node));
  }
  return used;
}

/** A literal int is a whole number inside the safe range (plan §6.4); NaN, Infinity and 1.5 are not. */
const isValidIntLiteral = (value: number) => Number.isSafeInteger(value) && Math.abs(value) <= MAX_SAFE_INT;

/**
 * Whether an int expression reads nothing (N17 B4): literals, variables and arithmetic of them, whose value is the same however
 * often it is evaluated. A read of the board, the running time or another random number is not. An explicit stack, never recursion.
 */
function readsNothing(expr: Expr): boolean {
  const pending: Expr[] = [expr];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.kind === 'arith') {
      pending.push(node.left, node.right);
    } else if (node.kind !== 'int' && node.kind !== 'variable') {
      return false;
    }
  }
  return true;
}

/** The size of the file as written: UTF-8 bytes, not the UTF-16 units of a JavaScript string. */
const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

export function generateYbcMicroPython(ir: YbcProgramIR, target: GenTarget = defaultTarget): GenerateResult {
  const diagnostics: GenDiagnostic[] = [];
  const report = (code: GenDiagnosticCode, message: string, blockId?: string) => {
    diagnostics.push(blockId === undefined ? { severity: 'error', code, message } : { severity: 'error', code, message, blockId });
  };

  const assigned = assignNames(ir.variables);
  if (!assigned.ok) {
    report('invalid-identifier', assigned.message);
    return { ok: false, diagnostics };
  }
  const names = assigned.names;

  const lines: string[] = [];
  const lineMap: { line: number; blockId: string }[] = [];
  const emit = (depth: number, text: string, blockId?: string) => {
    lines.push(`${indentUnit.repeat(depth)}${text}`);
    if (blockId !== undefined) {
      lineMap.push({ line: lines.length, blockId });
    }
  };

  // Numbers of the generator's own names, in the order the nodes are met (IM-10).
  let repeatCount = 0;
  let countUpCount = 0;

  const isLiteralInt = (expr: Expr): expr is Expr & { kind: 'int' } => expr.kind === 'int';

  /**
   * The pin of a pin operation (contract C-23…C-25). The Python name is `pinN`, so the pin has to be a number
   * known now, inside the pins the contract opens; anything else cannot be said faithfully (K4).
   */
  const pinOf = (args: readonly Expr[], expectedArgs: number, blockId: string): number | null => {
    const pin = args[0];
    if (args.length !== expectedArgs || pin === undefined || !isLiteralInt(pin)) {
      report('unsupported-node', 'A pin operation needs the pin as a number known before the program runs.', blockId);
      return null;
    }
    if (!PIN_NUMBERS.includes(pin.value)) {
      report('value-out-of-range', 'Only the pins P0, P1 and P2 can be used.', blockId);
      return null;
    }
    return pin.value;
  };

  const wrap = (rendered: Rendered, minimum: number) => (rendered.prec < minimum ? `(${rendered.text})` : rendered.text);

  const expectType = (expr: Expr, expected: Type, what: string) => {
    if (expr.type !== expected) {
      const wanted = expected === 'int' ? 'a whole number' : expected === 'bool' ? 'true or false' : 'text';
      report('type-mismatch', `${what} must be ${wanted}, not ${expr.type}.`, expr.blockId);
    }
  };

  const renderExpr = (expr: Expr, depth: number): Rendered => {
    if (depth > MAX_EXPRESSION_DEPTH) {
      report('limit-exceeded', `An expression can be nested at most ${MAX_EXPRESSION_DEPTH} levels deep.`, expr.blockId);
      return { text: '', prec: precAtom };
    }
    switch (expr.kind) {
      case 'int': {
        if (expr.type !== 'int' || !isValidIntLiteral(expr.value)) {
          report('invalid-literal', 'A number must be a whole number inside the safe range.', expr.blockId);
          return { text: '', prec: precAtom };
        }
        const value = expr.value === 0 ? 0 : expr.value;
        return { text: String(value), prec: value < 0 ? precNegative : precAtom };
      }
      case 'bool':
        expectType(expr, 'bool', 'A true/false value');
        return { text: expr.value ? 'True' : 'False', prec: precAtom };
      case 'str': {
        expectType(expr, 'str', 'A text');
        if (expr.value.length > MAX_TEXT_CHARS) {
          report('limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`, expr.blockId);
          return { text: '', prec: precAtom };
        }
        const literal = pythonString(expr.value);
        if (literal === null) {
          report('invalid-literal', 'A text contains a character that cannot be written to a program file (a lone surrogate).', expr.blockId);
          return { text: '', prec: precAtom };
        }
        return { text: literal, prec: precAtom };
      }
      case 'variable': {
        const name = names.get(expr.variable);
        if (name === undefined) {
          report('unknown-variable', `The variable "${expr.variable}" is not declared.`, expr.blockId);
          return { text: '', prec: precAtom };
        }
        expectType(expr, 'int', 'A variable');
        return { text: name, prec: precAtom };
      }
      case 'arith': {
        expectType(expr, 'int', 'An arithmetic result');
        expectType(expr.left, 'int', `The left side of ${expr.op}`);
        expectType(expr.right, 'int', `The right side of ${expr.op}`);
        const prec = arithPrecedence[expr.op];
        const left = renderExpr(expr.left, depth + 1);
        const right = renderExpr(expr.right, depth + 1);
        // Left-associative: an equal-precedence operand on the right keeps its parentheses.
        return { text: `${wrap(left, prec)} ${expr.op} ${wrap(right, prec + 1)}`, prec };
      }
      case 'compare': {
        expectType(expr, 'bool', 'A comparison');
        if (expr.op === '==' || expr.op === '!=') {
          if (expr.left.type !== expr.right.type) {
            report('type-mismatch', `"${expr.op}" compares two values of one type.`, expr.blockId);
          }
        } else {
          expectType(expr.left, 'int', `The left side of ${expr.op}`);
          expectType(expr.right, 'int', `The right side of ${expr.op}`);
        }
        const left = renderExpr(expr.left, depth + 1);
        const right = renderExpr(expr.right, depth + 1);
        // Python chains comparisons (`a < b == c`), so an operand that is itself a comparison, `not` or logic is parenthesised.
        return { text: `${wrap(left, precAdd)} ${expr.op} ${wrap(right, precAdd)}`, prec: precCompare };
      }
      case 'logic': {
        expectType(expr, 'bool', 'A logic result');
        expectType(expr.left, 'bool', `The left side of ${expr.op}`);
        expectType(expr.right, 'bool', `The right side of ${expr.op}`);
        const prec = expr.op === 'and' ? precAnd : precOr;
        const left = renderExpr(expr.left, depth + 1);
        const right = renderExpr(expr.right, depth + 1);
        // A comparison or `not` operand is parenthesised too: `(a < b) and (c != d)` cannot be misread.
        const operand = (side: Rendered, minimum: number) => (side.prec <= precCompare ? `(${side.text})` : wrap(side, minimum));
        return { text: `${operand(left, prec)} ${expr.op} ${operand(right, prec + 1)}`, prec };
      }
      case 'not': {
        expectType(expr, 'bool', 'A "not" result');
        expectType(expr.value, 'bool', 'The value of "not"');
        const value = renderExpr(expr.value, depth + 1);
        const inner = value.prec < precAtom && value.prec !== precNot ? `(${value.text})` : value.text;
        return { text: `not ${inner}`, prec: precNot };
      }
      case 'read': {
        if (isModuleRead(expr)) {
          // N18 R2.2: a module read is a uno program's, whose code is C++ (C1), never Python.
          report('unsupported-node', 'The generator does not know this kind of value.', expr.blockId);
          return { text: '', prec: precAtom };
        }
        if (expr.op === 'digital.read' || expr.op === 'analogIn.read') {
          // A header pin (YB-4, C-24, C-25): the pin is a literal of the block.
          const pin = pinOf(expr.args, 1, expr.blockId);
          if (pin === null) {
            return { text: '', prec: precAtom };
          }
          if (expr.op === 'digital.read') {
            expectType(expr, 'bool', 'A digital read');
            // The comparison is the generator's: the value is a bool whether the API returns an int or a bool (C-24).
            // The text carries its own parentheses, so it is an atom wherever it stands.
            return { text: `(pin${pin}.read_digital() == 1)`, prec: precAtom };
          }
          expectType(expr, 'int', 'An analog read');
          return { text: `int(pin${pin}.read_analog())`, prec: precAtom };
        }
        if (expr.op === 'random.int') {
          return { text: renderRandom(expr, depth), prec: precAtom };
        }
        return { text: renderRead(expr), prec: precAtom };
      }
      case 'join': {
        expectType(expr, 'str', 'A join');
        const parts = expr.parts.map((part): Rendered => {
          const rendered = renderExpr(part, depth + 1);
          // Python str(): decimal for an int, True / False for a bool; a text is already text.
          return part.type === 'str' ? rendered : { text: `str(${rendered.text})`, prec: precAtom };
        });
        const [first, ...rest] = parts;
        if (first === undefined) {
          return { text: "''", prec: precAtom };
        }
        if (rest.length === 0) {
          return first;
        }
        // Evaluated left to right, each part once; `+` is left-associative, so a nested join on the right keeps its parentheses.
        return { text: [wrap(first, precAdd), ...rest.map((part) => wrap(part, precAdd + 1))].join(' + '), prec: precAdd };
      }
      default:
        report('unsupported-node', 'The generator does not know this kind of value.', (expr as { blockId?: string }).blockId);
        return { text: '', prec: precAtom };
    }
  };

  /**
   * C-12, C-13, C-15: the call the contract writes (`button_a.is_pressed()`, `button_b.get_presses()`, `light_level()`). N17 B2:
   * `int(temperature())` (C-16: the board's temperature() is a float, EVD-10), `accelerometer.get_x()` (C-17; get_y and get_z are
   * UNVERIFIED forms), `accelerometer.is_gesture("shake")` (C-18, in the editor's double quotes; the other names are UNVERIFIED).
   */
  const renderRead = (expr: Expr & ReadExpr): string => {
    switch (expr.op) {
      case 'button.isPressed':
      case 'button.getPresses': {
        expectType(expr, expr.op === 'button.isPressed' ? 'bool' : 'int', expr.op === 'button.isPressed' ? 'A button check' : 'A press count');
        const button = (expr.operand as { button?: unknown }).button;
        if (!isButtonName(button)) {
          report('unsupported-node', 'A button is A or B.', expr.blockId);
          return '';
        }
        return `button_${button === 'A' ? 'a' : 'b'}.${expr.op === 'button.isPressed' ? 'is_pressed' : 'get_presses'}()`;
      }
      case 'light.level':
        expectType(expr, 'int', 'A light level');
        return 'light_level()';
      case 'temperature.read':
        expectType(expr, 'int', 'A temperature');
        return 'int(temperature())';
      case 'motion.acceleration': {
        expectType(expr, 'int', 'An acceleration');
        const axis = (expr.operand as { axis?: unknown }).axis;
        if (!isAxisName(axis)) {
          report('unsupported-node', 'An axis is x, y or z.', expr.blockId);
          return '';
        }
        return `accelerometer.get_${axis}()`;
      }
      case 'time.runningTime':
        // C-19 (N17 B4): the call the editor wrote (EVD-03).
        expectType(expr, 'int', 'A running time');
        return 'running_time()';
      case 'motion.isGesture': {
        expectType(expr, 'bool', 'A gesture check');
        const gesture = (expr.operand as { gesture?: unknown }).gesture;
        if (!isGestureName(gesture)) {
          report('unsupported-node', 'A gesture is one of the seven the block offers.', expr.blockId);
          return '';
        }
        return `accelerometer.is_gesture("${gesture}")`;
      }
      default:
        report('unsupported-node', 'The generator does not know this kind of value.', (expr as { blockId?: string }).blockId);
        return '';
    }
  };

  /**
   * C-40 (N17 B4): `random.randint(a, b)`, the call the editor wrote (EVD-03). The simulator takes the ends in either order, and
   * the board's randint refuses them high first, so the Python puts them low first: typed-in ends sorted now, computed ends that
   * read nothing as `min(a, b), max(a, b)` (evaluated twice, which changes nothing for them). Computed ends that read the board or
   * draw a random number would be read twice that way, so they cannot be said faithfully (K4).
   */
  const renderRandom = (expr: Expr & RandomExpr, depth: number): string => {
    const [from, to] = expr.args;
    if (expr.args.length !== 2 || from === undefined || to === undefined) {
      report('unsupported-node', 'A random number needs its two ends.', expr.blockId);
      return '';
    }
    expectType(expr, 'int', 'A random number');
    expectType(from, 'int', 'An end of a random number');
    expectType(to, 'int', 'An end of a random number');
    let ends = true;
    for (const end of [from, to]) {
      if (isLiteralInt(end) && Math.abs(end.value) > MAX_RANDOM_ABS) {
        report('value-out-of-range', `An end of a random number is -${MAX_RANDOM_ABS} to ${MAX_RANDOM_ABS}.`, end.blockId);
        ends = false;
      }
    }
    if (isLiteralInt(from) && isLiteralInt(to)) {
      if (ends && Math.abs(to.value - from.value) > MAX_RANDOM_SPAN) {
        report('value-out-of-range', `The ends of a random number are at most ${MAX_RANDOM_SPAN} apart.`, expr.blockId);
      }
      const low = renderExpr(from.value <= to.value ? from : to, depth + 1).text;
      const high = renderExpr(from.value <= to.value ? to : from, depth + 1).text;
      return `random.randint(${low}, ${high})`;
    }
    if (!readsNothing(from) || !readsNothing(to)) {
      report('unsupported-node', 'The ends of a random number must not read the board or draw a random number; put that value in a variable first.', expr.blockId);
      return '';
    }
    const a = renderExpr(from, depth + 1).text;
    const b = renderExpr(to, depth + 1).text;
    return `random.randint(min(${a}, ${b}), max(${a}, ${b}))`;
  };

  const expression = (expr: Expr) => renderExpr(expr, 1).text;

  const condition = (expr: Expr, what: string) => {
    expectType(expr, 'bool', what);
    return expression(expr);
  };

  const emitSuite = (statements: readonly YbcStatement[], depth: number) => {
    const before = lines.length;
    for (const statement of statements) {
      emitStatement(statement, depth);
    }
    if (lines.length === before) {
      emit(depth, 'pass');
    }
  };

  const emitStatement = (statement: YbcStatement, depth: number) => {
    if (depth > MAX_STATEMENT_DEPTH) {
      report('limit-exceeded', `Blocks can be nested at most ${MAX_STATEMENT_DEPTH} levels deep.`, statement.blockId);
      return;
    }
    switch (statement.kind) {
      case 'noop':
        // A block that has no behaviour has no code.
        return;
      case 'set': {
        const name = names.get(statement.variable);
        if (name === undefined) {
          report('unknown-variable', `The variable "${statement.variable}" is not declared.`, statement.blockId);
          return;
        }
        expectType(statement.value, 'int', 'A variable');
        emit(depth, `${name} = ${expression(statement.value)}`, statement.blockId);
        return;
      }
      case 'print':
        emit(depth, `print(${expression(statement.value)})`, statement.blockId);
        return;
      case 'if': {
        if (statement.branches.length === 0) {
          report('unsupported-node', 'An "if" needs at least one condition.', statement.blockId);
          return;
        }
        statement.branches.forEach((branch, index) => {
          const keyword = index === 0 ? 'if' : 'elif';
          emit(depth, `${keyword} ${condition(branch.condition, 'A condition')}:`, index === 0 ? statement.blockId : undefined);
          emitSuite(branch.body, depth + 1);
        });
        if (statement.else.length > 0) {
          emit(depth, 'else:');
          emitSuite(statement.else, depth + 1);
        }
        return;
      }
      case 'while':
        emit(depth, `while ${condition(statement.condition, 'A condition')}:`, statement.blockId);
        emitSuite(statement.body, depth + 1);
        return;
      case 'repeat': {
        repeatCount += 1;
        expectType(statement.times, 'int', 'The number of repetitions');
        if (isLiteralInt(statement.times) && Math.abs(statement.times.value) > MAX_REPEAT_ABS) {
          report('value-out-of-range', `"repeat" takes at most ${MAX_REPEAT_ABS} repetitions.`, statement.times.blockId);
        }
        emit(depth, `for _r${repeatCount} in range(${expression(statement.times)}):`, statement.blockId);
        emitSuite(statement.body, depth + 1);
        return;
      }
      case 'waitMs': {
        expectType(statement.ms, 'int', 'A wait');
        if (isLiteralInt(statement.ms) && (statement.ms.value < 0 || statement.ms.value > MAX_WAIT_MS)) {
          report('value-out-of-range', `A wait is 0 to ${MAX_WAIT_MS} milliseconds.`, statement.ms.blockId);
        }
        emit(depth, `time.sleep_ms(${expression(statement.ms)})`, statement.blockId);
        return;
      }
      case 'countUp':
        emitCountUp(statement, depth);
        return;
      case 'call': {
        if (isModuleCall(statement)) {
          // N18 R2.2: a module op is a uno program's, whose code is C++ (C1), never Python.
          report('unsupported-node', 'The generator does not know this kind of block.', statement.blockId);
          return;
        }
        if (statement.op === 'digital.write') {
          // A header pin (YB-4, C-23): the pin and the level are literals of the block.
          const pin = pinOf(statement.args, 2, statement.blockId);
          const level = statement.args[1];
          if (pin === null) {
            return;
          }
          if (level === undefined || !isLiteralInt(level)) {
            report('unsupported-node', 'A pin is set ON or OFF by a value known before the program runs.', statement.blockId);
            return;
          }
          if (!PIN_LEVELS.includes(level.value)) {
            report('value-out-of-range', 'A pin is set to 0 (off) or 1 (on).', statement.blockId);
            return;
          }
          emit(depth, `pin${pin}.write_digital(${level.value})`, statement.blockId);
          return;
        }
        if (statement.op === 'pwm.write' || statement.op === 'servo.write') {
          emitPinOutput(statement.op, statement.args, statement.blockId, depth);
          return;
        }
        emitCall(statement, depth);
        return;
      }
      default:
        report('unsupported-node', 'The generator does not know this kind of block.', (statement as { blockId?: string }).blockId);
    }
  };

  /**
   * N17 B5: `pin<N>.write_analog(<value>)` (C-26) and `pin<N>.servo_write(<angle>)` (C-27), the calls the editor wrote (V·G). What
   * the board does with a value outside 0..1023 / 0..180 is not shown, so it never gets one: a typed-in value is written clamped,
   * a computed one as `max(0, min(top, v))`, evaluated once; the simulator clamps the same way and warns.
   */
  const emitPinOutput = (op: 'pwm.write' | 'servo.write', args: readonly Expr[], blockId: string, depth: number) => {
    const pin = pinOf(args, 2, blockId);
    const value = args[1];
    if (pin === null || value === undefined) {
      return;
    }
    const [call, top] = op === 'pwm.write' ? ['write_analog', PWM_MAX] : ['servo_write', SERVO_MAX_ANGLE];
    expectType(value, 'int', op === 'pwm.write' ? 'An analog value' : 'A servo angle');
    if (isLiteralInt(value)) {
      if (!isValidIntLiteral(value.value)) {
        report('invalid-literal', 'A number must be a whole number inside the safe range.', value.blockId);
        return;
      }
      emit(depth, `pin${pin}.${call}(${Math.min(top, Math.max(0, value.value))})`, blockId);
      return;
    }
    emit(depth, `pin${pin}.${call}(max(0, min(${top}, ${expression(value)})))`, blockId);
  };

  /**
   * A colour as the program writes it (N17 B1): '#rrggbb' in lower case, as the editor's colour field writes it. Only the eight
   * colours of the palette (contract §4.4) can be said; the compiler never gives another.
   */
  const colourLiteral = (operand: ColourOperand | undefined, blockId: string): string | null => {
    const colour = operand?.kind === 'colour' ? paletteColourOf(operand.colour) : null;
    if (colour === null) {
      report('value-out-of-range', 'A colour is one of the eight colours of the palette.', blockId);
      return null;
    }
    return `'${colour.toLowerCase()}'`;
  };

  /** `Image("r0:r1:r2:r3:r4")`: rows from the top, digits from the left, 0 off and the palette digit of `digit` lit (EVD-05). */
  const imageLiteral = (pixels: readonly boolean[], digit: number) =>
    `Image("${Array.from({ length: IMAGE_SIZE }, (_, row) => pixels.slice(row * IMAGE_SIZE, (row + 1) * IMAGE_SIZE).map((lit) => (lit ? String(digit) : '0')).join('')).join(':')}")`;

  /** The column and the row of a pixel (C-10, C-42): literals are checked against 0..4; computed ones are the simulator's to refuse. */
  const cellOf = (args: readonly Expr[], blockId: string): string | null => {
    const [x, y] = args;
    if (args.length !== 2 || x === undefined || y === undefined) {
      report('unsupported-node', 'A light needs its column and its row.', blockId);
      return null;
    }
    for (const coordinate of [x, y]) {
      expectType(coordinate, 'int', 'A column or a row');
      if (isLiteralInt(coordinate) && (coordinate.value < 0 || coordinate.value > IMAGE_SIZE - 1)) {
        report('value-out-of-range', `A column or a row is 0 to ${IMAGE_SIZE - 1}.`, coordinate.blockId);
      }
    }
    return `${expression(x)}, ${expression(y)}`;
  };

  /** `, color='#rrggbb'` for a scroll in a colour other than red (N17, UNVERIFIED); nothing for red, the verified form. */
  const scrollColour = (operand: ColourOperand | undefined, blockId: string): string | null => {
    if (operand === undefined || paletteColourOf(operand.colour) === DEFAULT_COLOUR) {
      return '';
    }
    const literal = colourLiteral(operand, blockId);
    return literal === null ? null : `, color=${literal}`;
  };

  /** The statements of the onboard hardware, each in the exact form of its contract row (C-05…C-10, C-42, C-43, C-50, C-51, C-20…C-22). */
  const emitCall = (statement: CallStatement, depth: number) => {
    switch (statement.op) {
      case 'display.show': {
        const { operand } = statement;
        const image = operand.kind === 'image' ? operand.image : undefined;
        if (image?.source === 'builtin') {
          // C-05: a name of the vendor's editor is written `Image.<NAME>` (investigation §5.3); an arrow, which that editor does
          // not offer, as a picture of our own (C-06), so the board shows exactly what the simulator showed.
          if (!isBuiltinImageName(image.name)) {
            report('value-out-of-range', 'A picture is one of the built-in pictures of the display.', statement.blockId);
            return;
          }
          const name = image.name;
          emit(depth, vendorImageNames.has(name) ? `display.show(Image.${name})` : `display.show(${imageLiteral([...builtinImageRows[name].join('')].map((digit) => digit === '1'), 1)})`, statement.blockId);
          return;
        }
        // C-06 `Image("r0:r1:r2:r3:r4")`: 0 off and the palette digit of the colour lit, 1 for red (contract C-06, EVD-05).
        const pixels = image?.source === 'custom' ? image.pixels : undefined;
        if (pixels === undefined || pixels.length !== IMAGE_SIZE * IMAGE_SIZE || !pixels.every((lit) => typeof lit === 'boolean')) {
          report('unsupported-node', 'A picture is 5 rows of 5 squares, each lit or not.', statement.blockId);
          return;
        }
        const colour = image?.source === 'custom' && image.colour !== undefined ? image.colour : DEFAULT_COLOUR;
        const digit = paletteDigitOf(colour);
        if (digit === null) {
          report('value-out-of-range', 'A colour is one of the eight colours of the palette.', statement.blockId);
          return;
        }
        emit(depth, `display.show(${imageLiteral(pixels, digit)})`, statement.blockId);
        return;
      }
      case 'display.scrollText': {
        const [text] = statement.args;
        expectType(text, 'str', 'The text to scroll');
        if (text.kind === 'str' && !isDisplayText(text.value)) {
          report('value-out-of-range', 'The display shows only the characters from space to ~ (ASCII).', text.blockId);
        }
        const colour = scrollColour(statement.operand, statement.blockId);
        if (colour !== null) {
          emit(depth, `display.scroll(${expression(text)}${colour})`, statement.blockId);
        }
        return;
      }
      case 'display.scrollNumber': {
        const [value] = statement.args;
        expectType(value, 'int', 'The number to scroll');
        const colour = scrollColour(statement.operand, statement.blockId);
        if (colour !== null) {
          emit(depth, `display.scroll(${expression(value)}${colour})`, statement.blockId);
        }
        return;
      }
      case 'display.clear':
        emit(depth, 'display.clear()', statement.blockId);
        return;
      case 'display.setPixel': {
        // C-10: `display.set_pixel(x, y, '#rrggbb')` (V·G, EVD-03).
        const cell = cellOf(statement.args, statement.blockId);
        const colour = colourLiteral(statement.operand, statement.blockId);
        if (cell !== null && colour !== null) {
          emit(depth, `display.set_pixel(${cell}, ${colour})`, statement.blockId);
        }
        return;
      }
      case 'display.clearPixel': {
        // C-42: `display.clear_pixel(x, y)` (V·G, EVD-03).
        const cell = cellOf(statement.args, statement.blockId);
        if (cell !== null) {
          emit(depth, `display.clear_pixel(${cell})`, statement.blockId);
        }
        return;
      }
      case 'display.setAll': {
        // C-43: `display.set_all('#rrggbb')` (V·G, EVD-03).
        const colour = colourLiteral(statement.operand, statement.blockId);
        if (colour !== null) {
          emit(depth, `display.set_all(${colour})`, statement.blockId);
        }
        return;
      }
      case 'sound.playNote': {
        const { note, ticks } = statement.operand;
        if (!isNoteName(note) || !noteTicks.some((allowed) => allowed === ticks)) {
          report('value-out-of-range', 'A note is one of the natural notes from C3 to C5, for 1, 2 or 4 ticks.', statement.blockId);
          return;
        }
        emit(depth, `music.play(['${note}:${ticks}'], wait=True)`, statement.blockId);
        return;
      }
      case 'sound.rest': {
        const { ticks } = statement.operand;
        if (!noteTicks.some((allowed) => allowed === ticks)) {
          report('value-out-of-range', 'A rest is 1, 2 or 4 ticks.', statement.blockId);
          return;
        }
        emit(depth, `music.play(['R:${ticks}'], wait=True)`, statement.blockId);
        return;
      }
      case 'sound.playMelody': {
        // C-20 (N17 B3): `music.play(music.DADADADUM, wait=False)` is the line of the investigation (§5.3, V·G); the name is the
        // micro:bit module's, so the board plays its own melody of that name. wait=True and six of the names are UNVERIFIED forms.
        const { melody, wait } = statement.operand;
        if (!isMelodyName(melody) || typeof wait !== 'boolean') {
          report('value-out-of-range', 'A melody is one of the built-in melodies, played until done or in the background.', statement.blockId);
          return;
        }
        emit(depth, `music.play(music.${melody}, wait=${wait ? 'True' : 'False'})`, statement.blockId);
        return;
      }
      case 'sound.pitch': {
        // C-21 (N17 B3): `music.pitch(hz, ms)`, the call the editor wrote (EVD-03); typed-in values are checked against the domain,
        // computed ones are the simulator's to refuse when they run.
        const [hz, ms] = statement.args;
        if (statement.args.length !== 2 || hz === undefined || ms === undefined) {
          report('unsupported-node', 'A tone needs its frequency and its length.', statement.blockId);
          return;
        }
        expectType(hz, 'int', 'The frequency');
        expectType(ms, 'int', 'The length of a tone');
        if (isLiteralInt(hz) && (hz.value < PITCH_MIN_HZ || hz.value > PITCH_MAX_HZ)) {
          report('value-out-of-range', `The frequency is ${PITCH_MIN_HZ} to ${PITCH_MAX_HZ} Hz.`, hz.blockId);
        }
        if (isLiteralInt(ms) && (ms.value < 0 || ms.value > PITCH_MAX_MS)) {
          report('value-out-of-range', `The length of a tone is 0 to ${PITCH_MAX_MS} ms.`, ms.blockId);
        }
        emit(depth, `music.pitch(${expression(hz)}, ${expression(ms)})`, statement.blockId);
        return;
      }
      case 'sound.stop':
        // C-22 (N17 B3): `music.stop()`, the call the editor wrote (EVD-03).
        emit(depth, 'music.stop()', statement.blockId);
        return;
      default:
        report('unsupported-node', 'The generator does not know this kind of block.', (statement as { blockId?: string }).blockId);
    }
  };

  /** Contract §3.3: literal bounds fold into `range`; otherwise both bounds go to temporaries, start first, each once. */
  const emitCountUp = (statement: Extract<YbcStatement, { kind: 'countUp' }>, depth: number) => {
    countUpCount += 1;
    const k = countUpCount;
    const name = names.get(statement.variable);
    if (name === undefined) {
      report('unknown-variable', `The variable "${statement.variable}" is not declared.`, statement.blockId);
      return;
    }
    expectType(statement.from, 'int', 'The start of "count up"');
    expectType(statement.to, 'int', 'The end of "count up"');
    if (!Number.isSafeInteger(statement.step) || statement.step < 1 || statement.step > MAX_RANGE_VALUE) {
      report('value-out-of-range', `The step of "count up" is a whole number from 1 to ${MAX_RANGE_VALUE}.`, statement.blockId);
    }
    for (const bound of [statement.from, statement.to]) {
      // The folded form below never renders its literals, so they are checked here, like any literal.
      if (isLiteralInt(bound) && !isValidIntLiteral(bound.value)) {
        report('invalid-literal', 'A number must be a whole number inside the safe range.', bound.blockId);
        return;
      }
      if (isLiteralInt(bound) && (bound.value < 0 || bound.value > MAX_RANGE_VALUE)) {
        report('value-out-of-range', `"count up" bounds are 0 to ${MAX_RANGE_VALUE}.`, bound.blockId);
      }
    }
    const step = statement.step === 1 ? '' : `, ${statement.step}`;
    if (isLiteralInt(statement.from) && isLiteralInt(statement.to)) {
      if (statement.from.value > statement.to.value) {
        report('descending-range-not-supported', '"count up" cannot count down.', statement.blockId);
        return;
      }
      emit(depth, `for ${name} in range(${statement.from.value}, ${statement.to.value + 1}${step}):`, statement.blockId);
    } else {
      const start = `_cu_start_${k}`;
      const end = `_cu_end_${k}`;
      emit(depth, `${start} = ${expression(statement.from)}`, statement.blockId);
      emit(depth, `${end} = ${expression(statement.to)}`);
      emit(depth, `for ${name} in range(${start}, ${end} + 1${step}):`);
    }
    emitSuite(statement.body, depth + 1);
  };

  // The file (plan §13.3, contract §2.3): comment, imports, variables, on-start, then the forever (or idle) loop.
  lines.push(`# Generated by STEM Studio for Yolo:Bit MicroPython (contract ${target.contract})`);
  lines.push('import time');
  const modules = modulesUsed(ir);
  if (modules.yolobit) {
    lines.push(...yolobitModuleLines);
  }
  if (modules.music) {
    lines.push(...musicHeader);
  }
  if (modules.random) {
    lines.push('import random');
  }
  if (ir.variables.length > 0) {
    lines.push('');
    for (const variable of ir.variables) {
      if ((variable.type as string) !== 'int') {
        report('type-mismatch', `The variable "${variable.name}" must be a whole number.`);
      }
      emit(0, `${names.get(variable.id) ?? ''} = 0`);
    }
  }
  const beforeOnStart = lines.length;
  lines.push('');
  for (const statement of ir.onStart) {
    emitStatement(statement, 0);
  }
  if (lines.length === beforeOnStart + 1) {
    lines.pop();
  }
  lines.push('');
  emit(0, 'while True:');
  for (const statement of ir.forever ?? []) {
    emitStatement(statement, 1);
  }
  emit(1, 'time.sleep_ms(10)');

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  const source = `${lines.join('\n')}\n`;
  // Plan §6.7: no source is returned, truncated or not, for a file over the limit.
  if (utf8Bytes(source) > MAX_GENERATED_BYTES) {
    report('program-too-large', `The generated Python is limited to ${MAX_GENERATED_BYTES} bytes.`);
    return { ok: false, diagnostics };
  }
  return { ok: true, source, lineMap, names: Object.fromEntries(names), diagnostics: [] };
}
