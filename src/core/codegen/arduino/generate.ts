import { boardPin, hasCap, type BoardProfile } from '../../hardware/board';
import { arduinoCore, arduinoPin, DRIVE_ROLE, driveCall, drivers, kitCpp, roleOps, type CppLibrary, type DriverOp } from '../../hardware/drivers';
import { kitKey, portOfRole, type Kit, type KitPort } from '../../hardware/kit';
import { INT32_COUNT_UP_MAX_END, INT32_MAX, INT32_MIN, MAX_TEXT_CHARS, MAX_WAIT_MS } from '../../program/limits';
import { unoUsesOf } from '../../program/uno-uses';
import {
  isBoardPinOp, isModuleCall, isModuleRead, loopPauseUsOf, numericOf, type Expr, type ModuleCallStatement, type ModuleReadExpr, type Type, type YbcProgramIR,
  type YbcStatement,
} from '../../program/ybc-ir';
import { MAX_EXPRESSION_DEPTH, MAX_GENERATED_BYTES, MAX_STATEMENT_DEPTH } from './limits';
import { assignCppNames } from './names';
import { arithHelper, assembleSketch, languageHelpers, unoOps, type LanguageHelperId } from './sections';
import { arduinoTarget } from './target';

// The Arduino C++ generator of the robot lab (N18 C1, plan C1): a uno IR (`compileUnoProject`) to the sketch that M06 compiles and
// uploads to the board, and that the robot lab shows read-only in its C++ tab. It is the third consumer of the IR, next to the
// interpreter and the MicroPython generator; it never sees Blockly and never runs anything. Every form it writes is a form of the UNO
// contract (docs/uno-compatibility-contract.md §2.3, §3, §6, §9; its `cppAllowlist`), so the sketch means what the simulator runs:
//
// - every value is a `long`, every literal has the L suffix and INT32_MIN is `(-2147483647L - 1L)` (§3.1);
// - + − × // % are the helpers add32…mod32, never C++'s operators on a learner's value: avr-gcc treats a signed overflow as
//   undefined and folds it (§3.2, EMU-10/11);
// - a comparison, `and`, `or` and `not` are parenthesised C++ (U-09, U-10); millis is read as `(long)millis()` (U-19);
// - repeat and count up evaluate their bounds once, in the contract's order, into the generator's own `_n`, `_from`, `_to`; count up
//   assigns the learner's variable from `_c`, so it keeps the last value (U-12, U-14);
// - a module op is its driver's C++ (`Driver.ops[op].cpp`, on the kit's port), the drive is `driveCall` (U-21, U-22);
// - setup() starts with `Serial.begin(9600);` when the program prints, then the setup lines of the ports the program uses in kit port
//   order (`kitCpp`), then the pinMode of each module-wired pin the program reads raw (U-33, `uses.inputPins`) and of each pin it
//   writes (U-31, `uses.outputPins`), as the binding sets them up in the simulator (hardware/binding.ts `createProgramIO`).
//
// Like the MicroPython generator, anything it cannot say faithfully is a diagnostic, never a half sketch (K4).

export type UnoGenDiagnosticCode =
  | 'unsupported-node'
  | 'invalid-literal'
  | 'invalid-identifier'
  | 'unknown-variable'
  | 'type-mismatch'
  | 'value-out-of-range'
  | 'descending-range-not-supported'
  | 'capability-unavailable'
  | 'unsequenced-reads'
  | 'limit-exceeded'
  | 'program-too-large';

export type UnoGenDiagnostic = { severity: 'error'; code: UnoGenDiagnosticCode; message: string; blockId?: string };

/** The lines of the sketch a block's code takes, 1-based and inclusive (for the C++ tab's highlighting, plan R4.5). */
export type UnoLineRange = { blockId: string; from: number; to: number };

export type UnoSketchResult =
  | {
      ok: true;
      source: string;
      /** Each IR blockId to the lines its code takes: a statement from its first line to its last, an expression its line. */
      lineMap: UnoLineRange[];
      /** The libraries the sketch needs, the core first, each once (contract §2.2); M06 and `pnpm check:arduino` install them. */
      libraries: CppLibrary[];
      /** Blockly variable id to the C++ name. */
      names: Record<string, string>;
      diagnostics: [];
    }
  | { ok: false; diagnostics: UnoGenDiagnostic[] };

export type UnoSketchOptions = {
  kit: Kit;
  board: BoardProfile;
  /** The scenario the program was written for, named in the header; absent for a program of no scenario. */
  scenario?: { key: string; version: number };
};

const indentUnit = '  ';

/** A comment-safe text: printable ASCII without the backslash (a `\` at the end of a `//` line would join the next line to it). */
const commentText = (text: string) => text.replace(/[^\x20-\x5b\x5d-\x7e]/g, '_');

/** C0 and C1 control characters, as the compiler refuses them in a text (contract U-16). */
const isControl = (code: number) => code < 0x20 || (code >= 0x7f && code <= 0x9f);

/**
 * A C string literal's content (contract U-16, §7): UTF-8 as typed, `"` and `\` escaped, and a `?` after a `?` written `\?` so that no
 * trigraph can form (`-Wtrigraphs` warns, and an ISO mode would replace it). Null for text that has no faithful C form: a control
 * character (the domain of U-16) or a lone surrogate (no UTF-8).
 */
export function cString(text: string): string | null {
  let out = '';
  let previous = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0xd800 && code <= 0xdfff) || isControl(code)) {
      return null;
    }
    out += char === '\\' ? '\\\\' : char === '"' ? '\\"' : char === '?' && previous === '?' ? '\\?' : char;
    previous = char;
  }
  return out;
}

/**
 * Whether an expression reads the robot or the board's clock (a module read, millis, a raw pin read). An explicit stack, never recursion.
 * Literals and variables read nothing, and nothing in an expression writes a variable, so such operands may be evaluated in any order.
 */
function readsTheRobot(expr: Expr): boolean {
  const pending: Expr[] = [expr];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    switch (node.kind) {
      case 'read':
        return true;
      case 'arith':
      case 'compare':
      case 'logic':
        pending.push(node.left, node.right);
        break;
      case 'not':
        pending.push(node.value);
        break;
      case 'join':
        pending.push(...node.parts);
        break;
      default:
        break;
    }
  }
  return false;
}

/** A long literal (contract U-04): `300L`; INT32_MIN is `(-2147483647L - 1L)`, since 2147483648L is not a long. */
const longLiteral = (value: number) => (value === INT32_MIN ? '(-2147483647L - 1L)' : `${String(value === 0 ? 0 : value)}L`);

/** The size of the file as written: UTF-8 bytes. */
const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

export function generateUnoSketch(ir: YbcProgramIR, options: UnoSketchOptions): UnoSketchResult {
  const { kit, board } = options;
  const diagnostics: UnoGenDiagnostic[] = [];
  const report = (code: UnoGenDiagnosticCode, message: string, blockId?: string) => {
    diagnostics.push(blockId === undefined ? { severity: 'error', code, message } : { severity: 'error', code, message, blockId });
  };

  if (numericOf(ir) !== 'cxx-int32' || loopPauseUsOf(ir) !== 0) {
    report('unsupported-node', 'A sketch is written for a program of the UNO family (32-bit numbers, no pause after a forever iteration).');
    return { ok: false, diagnostics };
  }
  if (kit.board !== board.id) {
    report('capability-unavailable', `The kit ${kitKey(kit)} is for the board ${kit.board}, not ${board.id}.`);
    return { ok: false, diagnostics };
  }
  const assigned = assignCppNames(ir.variables);
  if (!assigned.ok) {
    report('invalid-identifier', assigned.message);
    return { ok: false, diagnostics };
  }
  const names = assigned.names;
  for (const variable of ir.variables) {
    if ((variable.type as string) !== 'int') {
      report('type-mismatch', `The variable "${variable.name}" must be a whole number.`);
    }
  }
  const helpersUsed = new Set<LanguageHelperId>();
  const useOp = (op: keyof typeof unoOps) => unoOps[op].helpers.forEach((helper) => helpersUsed.add(helper));

  // --- the bodies of setup() and loop(), and where each block's code is ---------------------------------------------------------
  type Section = 'setup' | 'loop';
  const bodies: Record<Section, string[]> = { setup: [], loop: [] };
  let section: Section = 'setup';
  /** Expression blocks rendered since the last line was written: they are on the next line. */
  let pending: string[] = [];
  const ranges = new Map<string, { section: Section; from: number; to: number; order: number }>();
  const mark = (blockId: string, from: number, to: number) => {
    const known = ranges.get(blockId);
    if (!known) {
      ranges.set(blockId, { section, from, to, order: ranges.size });
    } else if (known.section === section) {
      known.from = Math.min(known.from, from);
      known.to = Math.max(known.to, to);
    }
  };
  /** Writes a line; the expressions rendered for it are on it, unless it is only a brace that opens a block (`attach` false). */
  const emit = (depth: number, text: string, attach = true) => {
    const body = bodies[section];
    body.push(`${indentUnit.repeat(depth)}${text}`);
    if (attach) {
      const line = body.length - 1;
      pending.forEach((blockId) => mark(blockId, line, line));
      pending = [];
    }
  };
  /** Runs `write` and marks the block on every line it wrote. */
  const spanning = (blockId: string, write: () => void) => {
    const from = bodies[section].length;
    write();
    const to = bodies[section].length - 1;
    if (to >= from) {
      mark(blockId, from, to);
    }
  };

  const expectType = (expr: Expr, expected: Type, what: string) => {
    if (expr.type !== expected) {
      const wanted = expected === 'int' ? 'a whole number' : expected === 'bool' ? 'true or false' : 'text';
      report('type-mismatch', `${what} must be ${wanted}, not ${expr.type}.`, expr.blockId);
    }
  };

  /** The kit's port and driver op for a role's op, when the kit offers it there (`roleOps`: the driver's ops its pins allow). */
  const driverOpOf = (role: string, op: string, kind: DriverOp['kind'], blockId: string): { port: KitPort; driverOp: DriverOp } | null => {
    const port = portOfRole(kit, role);
    const driverOp = port ? drivers[port.driver].ops[op] : undefined;
    if (!port || !driverOp || driverOp.kind !== kind || !roleOps(kit, board, role).includes(op)) {
      report('capability-unavailable', `The kit ${kitKey(kit)} has no "${op}" on ${role}.`, blockId);
      return null;
    }
    return { port, driverOp };
  };

  /** A raw pin of the board (contract §9), as Arduino names it: `D5` → `5`, `A3` → `A3`. */
  const rawPin = (pin: string, blockId: string, cap?: 'analogIn'): string | null => {
    if (!boardPin(board, pin) || (cap !== undefined && !hasCap(board, pin, cap))) {
      report('capability-unavailable', cap ? `${pin} is not an analog input of ${board.id}.` : `${pin} is not a pin of ${board.id}.`, blockId);
      return null;
    }
    return arduinoPin(pin);
  };

  /**
   * C++ leaves the order of a call's arguments and of a comparison's operands open, and avr-gcc 7.3 evaluates call arguments right to
   * left (avr8js trace of `add32(se(1L), se(2L))`: eval=2, then eval=1), where the interpreter evaluates left to right. So the operands of
   * one helper call, comparison or module call may read the robot in one of them only; `and`, `or` (sequenced, left first), a join's
   * parts (one Serial.print each) and count up's bounds (`_from`, `_to`) are in order already.
   */
  const inOrder = (operands: readonly Expr[], blockId: string) => {
    if (operands.filter(readsTheRobot).length > 1) {
      report('unsequenced-reads', 'This block reads the robot in two of its inputs, and C++ does not say which read comes first; put one reading in a variable first.', blockId);
    }
  };

  /** An expression nested too deep is said once, on its first block: its operands are all too deep too. */
  let tooDeep = false;
  const deepExpression = (blockId: string) => {
    if (!tooDeep) {
      tooDeep = true;
      report('limit-exceeded', `An expression can be nested at most ${MAX_EXPRESSION_DEPTH} levels deep.`, blockId);
    }
  };

  const renderExpr = (expr: Expr, depth: number): string => {
    if (depth > MAX_EXPRESSION_DEPTH) {
      deepExpression(expr.blockId);
      return '';
    }
    pending.push(expr.blockId);
    switch (expr.kind) {
      case 'int':
        if (expr.type !== 'int' || !Number.isSafeInteger(expr.value)) {
          report('invalid-literal', 'A number must be a whole number.', expr.blockId);
          return '';
        }
        if (expr.value < INT32_MIN || expr.value > INT32_MAX) {
          report('value-out-of-range', `A number must be between ${INT32_MIN} and ${INT32_MAX}.`, expr.blockId);
          return '';
        }
        return longLiteral(expr.value);
      case 'bool':
        expectType(expr, 'bool', 'A true/false value');
        return expr.value ? 'true' : 'false';
      case 'str':
      case 'join':
        // Contract §3.1: a text is only printed (U-16, U-17); `print` writes it, nothing else can hold one.
        report('unsupported-node', 'A text can only be printed on this board.', expr.blockId);
        return '';
      case 'variable': {
        const name = names.get(expr.variable);
        if (name === undefined) {
          report('unknown-variable', `The variable "${expr.variable}" is not declared.`, expr.blockId);
          return '';
        }
        expectType(expr, 'int', 'A variable');
        return name;
      }
      case 'arith': {
        expectType(expr, 'int', 'An arithmetic result');
        expectType(expr.left, 'int', `The left side of ${expr.op}`);
        expectType(expr.right, 'int', `The right side of ${expr.op}`);
        useOp(expr.op);
        inOrder([expr.left, expr.right], expr.blockId);
        return `${arithHelper[expr.op]}(${renderExpr(expr.left, depth + 1)}, ${renderExpr(expr.right, depth + 1)})`;
      }
      case 'compare': {
        expectType(expr, 'bool', 'A comparison');
        if (expr.op === '==' || expr.op === '!=') {
          if (expr.left.type !== expr.right.type || expr.left.type === 'str') {
            report('type-mismatch', `"${expr.op}" compares two numbers or two true / false values.`, expr.blockId);
          }
        } else {
          expectType(expr.left, 'int', `The left side of ${expr.op}`);
          expectType(expr.right, 'int', `The right side of ${expr.op}`);
        }
        inOrder([expr.left, expr.right], expr.blockId);
        return `(${renderExpr(expr.left, depth + 1)} ${expr.op} ${renderExpr(expr.right, depth + 1)})`;
      }
      case 'logic': {
        expectType(expr, 'bool', 'A logic result');
        expectType(expr.left, 'bool', `The left side of ${expr.op}`);
        expectType(expr.right, 'bool', `The right side of ${expr.op}`);
        return `(${renderExpr(expr.left, depth + 1)} ${expr.op === 'and' ? '&&' : '||'} ${renderExpr(expr.right, depth + 1)})`;
      }
      case 'not':
        expectType(expr, 'bool', 'A "not" result');
        expectType(expr.value, 'bool', 'The value of "not"');
        return `!(${renderExpr(expr.value, depth + 1)})`;
      case 'read':
        return renderRead(expr);
      default:
        report('unsupported-node', 'The generator does not know this kind of value.', (expr as { blockId?: string }).blockId);
        return '';
    }
  };

  /** U-19, U-27…U-30 through the kit's drivers, U-33 and U-34 on a raw pin. */
  const renderRead = (expr: Expr & { kind: 'read' }): string => {
    if (isModuleRead(expr)) {
      const read = expr as Expr & ModuleReadExpr;
      useOp(read.op);
      expectType(expr, read.op === 'line.dark' || read.op === 'button.pressed' ? 'bool' : 'int', `"${read.op}"`);
      if (read.op === 'time.millis') {
        return '(long)millis()';
      }
      const found = driverOpOf(read.operand.role, read.op, 'read', expr.blockId);
      return found ? found.driverOp.cpp.call(found.port, read.operand.role, []) : '';
    }
    if ((expr.op === 'digital.read' || expr.op === 'analogIn.read') && isBoardPinOp(expr)) {
      useOp(expr.op);
      if (expr.op === 'digital.read') {
        expectType(expr, 'bool', 'A digital read');
        const pin = rawPin(expr.operand.pin, expr.blockId);
        return pin === null ? '' : `(digitalRead(${pin}) == HIGH)`;
      }
      expectType(expr, 'int', 'An analog read');
      const pin = rawPin(expr.operand.pin, expr.blockId, 'analogIn');
      return pin === null ? '' : `(long)analogRead(${pin})`;
    }
    // The Yolo:Bit's onboard parts, header pins and random numbers are not on this board.
    report('unsupported-node', 'The generator does not know this kind of value.', expr.blockId);
    return '';
  };

  const expression = (expr: Expr) => renderExpr(expr, 1);
  const condition = (expr: Expr, what: string) => {
    expectType(expr, 'bool', what);
    return expression(expr);
  };
  const intArgument = (expr: Expr | undefined, what: string, blockId: string): string => {
    if (expr === undefined) {
      report('unsupported-node', `${what} is missing.`, blockId);
      return '';
    }
    expectType(expr, 'int', what);
    return expression(expr);
  };

  /** `depth` is the indentation; `level` how deep the blocks nest (a repeat's body is two indents in, one level). */
  const emitBody = (statements: readonly YbcStatement[], depth: number, level: number) => {
    for (const statement of statements) {
      emitStatement(statement, depth, level);
    }
  };

  /** A C++ text of statements (`a; b;`) one per line: the drive's form (U-21, U-22) is one line in the contract. */
  const emitStatements = (depth: number, text: string) => {
    const block = /^\{ (.*) \}$/.exec(text);
    const parts = (block ? block[1] ?? '' : text).split(/(?<=;) /);
    if (block) {
      emit(depth, '{', false);
    }
    parts.forEach((part) => emit(depth + (block ? 1 : 0), part));
    if (block) {
      emit(depth, '}');
    }
  };

  /** U-15…U-17: a number or truth value, a text, or a join whose parts are printed one after another, the last with println. */
  const emitPrint = (value: Expr, depth: number) => {
    const parts: Expr[] = [];
    const flatten = (expr: Expr, level: number) => {
      if (level > MAX_EXPRESSION_DEPTH) {
        deepExpression(expr.blockId);
        return;
      }
      if (expr.kind === 'join') {
        pending.push(expr.blockId);
        expr.parts.forEach((part) => flatten(part, level + 1));
      } else {
        parts.push(expr);
      }
    };
    flatten(value, 1);
    if (parts.length === 0) {
      emit(depth, 'Serial.println(F(""));');
      return;
    }
    parts.forEach((part, index) => {
      const call = index === parts.length - 1 ? 'Serial.println' : 'Serial.print';
      if (part.kind === 'str') {
        pending.push(part.blockId);
        if (part.value.length > MAX_TEXT_CHARS) {
          report('limit-exceeded', `A text is limited to ${MAX_TEXT_CHARS} characters.`, part.blockId);
          return;
        }
        const literal = cString(part.value);
        if (literal === null) {
          report('invalid-literal', 'A text cannot contain control characters or a lone surrogate.', part.blockId);
          return;
        }
        emit(depth, `${call}(F("${literal}"));`);
        return;
      }
      if (part.type === 'str') {
        report('unsupported-node', 'The generator does not know this kind of text.', part.blockId);
        return;
      }
      emit(depth, `${call}(${expression(part)});`);
    });
  };

  const emitStatement = (statement: YbcStatement, depth: number, level: number) => {
    if (level > MAX_STATEMENT_DEPTH) {
      report('limit-exceeded', `Blocks can be nested at most ${MAX_STATEMENT_DEPTH} levels deep.`, statement.blockId);
      return;
    }
    spanning(statement.blockId, () => emitStatementLines(statement, depth, level));
  };

  const emitStatementLines = (statement: YbcStatement, depth: number, level: number) => {
    switch (statement.kind) {
      case 'noop':
        return;
      case 'set': {
        const name = names.get(statement.variable);
        if (name === undefined) {
          report('unknown-variable', `The variable "${statement.variable}" is not declared.`, statement.blockId);
          return;
        }
        expectType(statement.value, 'int', 'A variable');
        emit(depth, `${name} = ${expression(statement.value)};`);
        return;
      }
      case 'print':
        emitPrint(statement.value, depth);
        return;
      case 'if': {
        if (statement.branches.length === 0) {
          report('unsupported-node', 'An "if" needs at least one condition.', statement.blockId);
          return;
        }
        statement.branches.forEach((branch, index) => {
          emit(depth, `${index === 0 ? 'if' : '} else if'} (${condition(branch.condition, 'A condition')}) {`);
          emitBody(branch.body, depth + 1, level + 1);
        });
        if (statement.else.length > 0) {
          emit(depth, '} else {');
          emitBody(statement.else, depth + 1, level + 1);
        }
        emit(depth, '}');
        return;
      }
      case 'while':
        emit(depth, `while (${condition(statement.condition, 'A condition')}) {`);
        emitBody(statement.body, depth + 1, level + 1);
        emit(depth, '}');
        return;
      case 'repeat': {
        // U-12: the count is evaluated once; N <= 0 runs none.
        expectType(statement.times, 'int', 'The number of repetitions');
        emit(depth, '{');
        emit(depth + 1, `const long _n = (${expression(statement.times)});`);
        emit(depth + 1, 'for (long _r = 0L; _r < _n; _r += 1L) {');
        emitBody(statement.body, depth + 2, level + 1);
        emit(depth + 1, '}');
        emit(depth, '}');
        return;
      }
      case 'countUp':
        emitCountUp(statement, depth, level);
        return;
      case 'waitMs': {
        expectType(statement.ms, 'int', 'A wait');
        if (statement.ms.kind === 'int' && (statement.ms.value < 0 || statement.ms.value > MAX_WAIT_MS)) {
          report('value-out-of-range', `A wait is 0 to ${MAX_WAIT_MS} milliseconds.`, statement.ms.blockId);
        }
        emit(depth, `delay(${expression(statement.ms)});`);
        return;
      }
      case 'call':
        if (isModuleCall(statement)) {
          emitModuleCall(statement, depth);
          return;
        }
        if ((statement.op === 'digital.write' || statement.op === 'pwm.write') && isBoardPinOp(statement)) {
          useOp(statement.op);
          const pin = rawPin(statement.operand.pin, statement.blockId);
          const [value] = statement.args;
          if (statement.op === 'digital.write') {
            // U-31: the level is a truth value.
            if (value === undefined) {
              report('unsupported-node', 'A digital write needs its level.', statement.blockId);
              return;
            }
            expectType(value, 'bool', 'A pin level');
            const level = expression(value);
            if (pin !== null) {
              emit(depth, `digitalWrite(${pin}, (${level}) ? HIGH : LOW);`);
            }
            return;
          }
          // U-32: pwmWrite clamps to 0..255, as the simulator does.
          const duty = intArgument(value, 'A PWM value', statement.blockId);
          if (pin !== null) {
            emit(depth, `pwmWrite(${pin}, ${duty});`);
          }
          return;
        }
        // The Yolo:Bit's onboard parts and header pins are not on this board.
        report('unsupported-node', 'The generator does not know this kind of block.', statement.blockId);
        return;
      default:
        report('unsupported-node', 'The generator does not know this kind of block.', (statement as { blockId?: string }).blockId);
    }
  };

  /** U-14: start, then end, each evaluated once into `_from` and `_to`; the variable takes each value of `_c` and keeps the last. */
  const emitCountUp = (statement: Extract<YbcStatement, { kind: 'countUp' }>, depth: number, level: number) => {
    const name = names.get(statement.variable);
    if (name === undefined) {
      report('unknown-variable', `The variable "${statement.variable}" is not declared.`, statement.blockId);
      return;
    }
    expectType(statement.from, 'int', 'The start of "count up"');
    expectType(statement.to, 'int', 'The end of "count up"');
    if (statement.step !== 1) {
      report('value-out-of-range', '"count up" counts by 1 on this board.', statement.blockId);
    }
    if (statement.to.kind === 'int' && statement.to.value > INT32_COUNT_UP_MAX_END) {
      report('value-out-of-range', `The end of "count up" is at most ${INT32_COUNT_UP_MAX_END}.`, statement.to.blockId);
    }
    if (statement.from.kind === 'int' && statement.to.kind === 'int' && statement.from.value > statement.to.value) {
      report('descending-range-not-supported', '"count up" cannot count down.', statement.blockId);
    }
    emit(depth, '{');
    emit(depth + 1, `const long _from = (${expression(statement.from)});`);
    emit(depth + 1, `const long _to = (${expression(statement.to)});`);
    emit(depth + 1, 'for (long _c = _from; _c <= _to; _c += 1L) {');
    emit(depth + 2, `${name} = _c;`);
    emitBody(statement.body, depth + 2, level + 1);
    emit(depth + 1, '}');
    emit(depth, '}');
  };

  /** U-20…U-26: the driver's C++ on the kit's port; the drive (U-21, U-22) is both motors, `driveCall`. */
  const emitModuleCall = (statement: ModuleCallStatement, depth: number) => {
    useOp(statement.op);
    if (statement.op === 'drive.move' || statement.op === 'drive.stop') {
      if (!roleOps(kit, board, DRIVE_ROLE).includes(statement.op)) {
        report('capability-unavailable', `The kit ${kitKey(kit)} has no drive: it needs motorLeft and motorRight.`, statement.blockId);
        return;
      }
      const text =
        statement.op === 'drive.stop'
          ? driveCall('drive.stop')
          : driveCall('drive.move', statement.operand.direction, intArgument(statement.args[0], 'The speed', statement.blockId));
      emitStatements(depth, text);
      return;
    }
    const role = statement.operand.role;
    const found = driverOpOf(role, statement.op, 'call', statement.blockId);
    const args: string[] = [];
    if (statement.op !== 'buzzer.stop') {
      inOrder(statement.args, statement.blockId);
      statement.args.forEach((arg, index) => {
        const range = found?.driverOp.args[index];
        if (range === null) {
          expectType(arg, 'bool', 'An on / off value');
          args.push(expression(arg));
        } else {
          args.push(intArgument(arg, range === undefined ? 'An argument' : `The ${range.name}`, statement.blockId));
        }
      });
    }
    if (found) {
      emit(depth, found.driverOp.cpp.call(found.port, role, args));
    }
  };

  section = 'setup';
  emitBody(ir.onStart, 1, 1);
  section = 'loop';
  emitBody(ir.forever ?? [], 1, 1);

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  // --- the parts around the bodies --------------------------------------------------------------------------------------------
  const uses = unoUsesOf(ir, kit);
  const cpp = kitCpp(kit, uses.modules);
  const libraries = new Map<string, CppLibrary>([[`${arduinoCore.name}@${arduinoCore.version}`, arduinoCore]]);
  cpp.libraries.forEach((library) => libraries.set(`${library.name}@${library.version}`, library));
  const libraryList = [...libraries.values()];
  const scenario = options.scenario ? `${options.scenario.key}@${String(options.scenario.version)}` : 'none';
  const header = [
    `// Scenario: ${commentText(scenario)}, kit: ${commentText(kitKey(kit))}, board: ${commentText(`${board.id}@${board.version}`)}`,
    '// Generated by STEM Studio from the blocks: editing this code does not change the lab.',
    `// Target: ${arduinoTarget.fqbn}, contract ${arduinoTarget.contract} ${arduinoTarget.contractVersion}. Libraries: ${libraryList
      .map((library) => commentText(`${library.name}@${library.version} (${library.license})`))
      .join(', ')}`,
  ];
  const preamble = [
    ...(uses.usage.serial ? ['Serial.begin(9600);'] : []),
    ...cpp.setup,
    ...uses.inputPins.map(({ pin, mode }) => `pinMode(${arduinoPin(pin)}, ${mode});`),
    ...uses.outputPins.map((pin) => `pinMode(${arduinoPin(pin)}, OUTPUT);`),
  ];
  const setupLines = [...new Set(preamble)].map((line) => `${indentUnit}${line}`);
  const helpers = [
    ...(helpersUsed.has('int32') ? [languageHelpers.int32] : []),
    ...cpp.helpers.map((helper) => helper.text),
    ...(helpersUsed.has('pwm-write') ? [languageHelpers['pwm-write']] : []),
  ];
  const assembled = assembleSketch({
    header,
    includes: cpp.includes,
    defines: cpp.defines,
    globals: [...cpp.globals, ...ir.variables.map((variable) => `long ${names.get(variable.id) ?? ''} = 0L;`)],
    helpers,
    functions: [],
    setup: [...setupLines, ...bodies.setup],
    loop: bodies.loop,
  });
  if (utf8Bytes(assembled.source) > MAX_GENERATED_BYTES) {
    report('program-too-large', `The generated sketch is limited to ${MAX_GENERATED_BYTES} bytes.`);
    return { ok: false, diagnostics };
  }
  const firstLine: Record<Section, number> = { setup: assembled.setupBodyLine + setupLines.length, loop: assembled.loopBodyLine };
  const lineMap = [...ranges.entries()]
    .map(([blockId, range]) => ({ blockId, from: firstLine[range.section] + range.from, to: firstLine[range.section] + range.to, order: range.order }))
    .sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order)
    .map(({ blockId, from, to }) => ({ blockId, from, to }));
  return { ok: true, source: assembled.source, lineMap, libraries: libraryList, names: Object.fromEntries(names), diagnostics: [] };
}
