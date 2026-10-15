import { IMAGE_SIZE, isDisplayText } from '../../constructs/ybc.display';
import { isButtonName } from '../../constructs/ybc.input';
import { PIN_LEVELS, PIN_NUMBERS } from '../../constructs/ybc.pins';
import { isNoteName, noteTicks } from '../../constructs/ybc.sound';
import { MAX_RANGE_VALUE, MAX_REPEAT_ABS, MAX_SAFE_INT, MAX_TEXT_CHARS, MAX_WAIT_MS } from '../../program/limits';
import type { ArithOp, CallStatement, Expr, ReadExpr, Type, YbcProgramIR, YbcStatement } from '../../program/ybc-ir';
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
 * buttons C-12 and C-13, light C-15, sound C-50 and C-51) and the header pins of YB-4 (C-23, C-24, C-25). The other
 * hardware rows arrive with their phases.
 */
export const generatedConstructs = [
  'C-01', 'C-02', 'C-04', 'C-06', 'C-07', 'C-08', 'C-09', 'C-12', 'C-13', 'C-15', 'C-23', 'C-24', 'C-25', 'C-29', 'C-30',
  'C-31', 'C-32', 'C-33', 'C-34', 'C-35', 'C-36', 'C-37', 'C-38', 'C-39', 'C-50', 'C-51', 'C-56',
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
// tempo, `music.set_tempo(4, 120)`. The order is fixed: time, yolobit with its preamble, music. They are written here
// and in modules.ts, not read from the contract data, so that the large contract stays out of the app bundle;
// generate.constructs.test.ts keeps them equal to the contract.
const musicHeader = ['import music', 'music.set_tempo(4, 120)'] as const;

/**
 * Which modules the program needs. An explicit stack, not recursion: the IR may be nested as deep as a hostile document
 * asks, and the generator never throws (it reports the depth later, when it writes the nesting).
 */
function modulesUsed(ir: YbcProgramIR): { yolobit: boolean; music: boolean } {
  const used = { yolobit: false, music: false };
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

  /** C-12, C-13, C-15: the call the contract writes (`button_a.is_pressed()`, `button_b.get_presses()`, `light_level()`). */
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
      default:
        report('unsupported-node', 'The generator does not know this kind of value.', (expr as { blockId?: string }).blockId);
        return '';
    }
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
        emitCall(statement, depth);
        return;
      }
      default:
        report('unsupported-node', 'The generator does not know this kind of block.', (statement as { blockId?: string }).blockId);
    }
  };

  /** The statements of the onboard hardware, each in the exact form of its contract row (C-06…C-09, C-50, C-51). */
  const emitCall = (statement: CallStatement, depth: number) => {
    switch (statement.op) {
      case 'display.show': {
        // `Image("r0:r1:r2:r3:r4")`: rows from the top, digits from the left, 1 lit (red) and 0 off (contract C-06, EVD-05).
        const { operand } = statement;
        const pixels = operand.image.pixels;
        const wellFormed =
          operand.kind === 'image' &&
          operand.image.source === 'custom' &&
          pixels.length === IMAGE_SIZE * IMAGE_SIZE &&
          pixels.every((lit) => typeof lit === 'boolean');
        if (!wellFormed) {
          report('unsupported-node', 'A picture is 5 rows of 5 squares, each lit or not.', statement.blockId);
          return;
        }
        const rows = Array.from({ length: IMAGE_SIZE }, (_, row) =>
          pixels.slice(row * IMAGE_SIZE, (row + 1) * IMAGE_SIZE).map((lit) => (lit ? '1' : '0')).join(''),
        );
        emit(depth, `display.show(Image("${rows.join(':')}"))`, statement.blockId);
        return;
      }
      case 'display.scrollText': {
        const [text] = statement.args;
        expectType(text, 'str', 'The text to scroll');
        if (text.kind === 'str' && !isDisplayText(text.value)) {
          report('value-out-of-range', 'The display shows only the characters from space to ~ (ASCII).', text.blockId);
        }
        emit(depth, `display.scroll(${expression(text)})`, statement.blockId);
        return;
      }
      case 'display.scrollNumber': {
        const [value] = statement.args;
        expectType(value, 'int', 'The number to scroll');
        emit(depth, `display.scroll(${expression(value)})`, statement.blockId);
        return;
      }
      case 'display.clear':
        emit(depth, 'display.clear()', statement.blockId);
        return;
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
