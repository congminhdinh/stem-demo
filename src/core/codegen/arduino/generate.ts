import { boardPin, hasCap, type BoardProfile } from '../../hardware/board';
import { arduinoCore, arduinoPin, COLOR_CHANNELS, COLOR_NAMES, DRIVE_ROLE, driveCall, drivers, kitCpp, roleOps, type CppLibrary, type DriverOp } from '../../hardware/drivers';
import { kitKey, portOfRole, type Kit, type KitPort } from '../../hardware/kit';
import { INT32_COUNT_UP_MAX_END, INT32_MAX, INT32_MIN, MAX_TEXT_CHARS, MAX_WAIT_MS } from '../../program/limits';
import { unoUsesOf } from '../../program/uno-uses';
import {
  isBoardPinOp, isModuleCall, isModuleRead, loopPauseUsOf, moduleReadType, numericOf, type Expr, type ModuleCallStatement, type ModuleReadExpr, type Type,
  type YbcProgramIR, type YbcStatement,
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
// - the interpreter evaluates operands left to right, each once; C++ leaves a call's arguments and a comparison's operands unsequenced
//   (avr-gcc 7.3 evaluates call arguments right to left, EMU-15). An expression that reads the robot two or more times in such operands
//   assigns each read, in the interpreter's depth-first order, to a function-scope temporary `_s<k>` with the comma operator, which is
//   sequenced left to right: `(_s1 = <read>, _s2 = <read>, sub32(_s1, _s2))` (contract §3.5, 0.1.3); `&&` and `||` stay native;
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
 * Literals and variables read nothing, and nothing in an expression writes a learner variable, so such operands may be evaluated in any
 * order.
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
  const assigned = assignCppNames(ir.variables, kit);
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

  /** An expression nested too deep is said once, on its first block: its operands are all too deep too. */
  let tooDeep = false;
  const deepExpression = (blockId: string) => {
    if (!tooDeep) {
      tooDeep = true;
      report('limit-exceeded', `An expression can be nested at most ${MAX_EXPRESSION_DEPTH} levels deep.`, blockId);
    }
  };

  // --- Contract §3.5 (0.1.3): operands in the interpreter's order ----------------------------------------------------------------
  //
  // A region is the part of an expression whose operands C++ leaves unsequenced: the arguments of a helper (add32…mod32), the two sides
  // of a comparison, through `!`. `&&` and `||` end a region: C++ sequences them left to right and skips the right side exactly as the
  // interpreter does, so each of their operands is a region of its own. The units of a region are what reads the robot in it: a read, or
  // an `&&` / `||` that reads (taken whole, so its short-circuit stays). A region with two or more units is written with each unit
  // assigned, in depth-first left-to-right order (the interpreter's), to a temporary `_s<k>` of setup() or loop(), with the comma
  // operator, and the rest of the expression on the temporaries. One unit or none: the expression as it is.

  /** The temporaries of setup() and of loop(), `_s1`, `_s2`, … in the order they are taken, each with its C++ type. */
  const temps: Record<Section, ('long' | 'bool')[]> = { setup: [], loop: [] };
  const takeTemp = (type: Type) => {
    temps[section].push(type === 'bool' ? 'bool' : 'long');
    return `_s${String(temps[section].length)}`;
  };

  /** The units of a region, depth-first, left to right, with their depth. An explicit stack, never recursion. */
  const unitsOf = (roots: readonly Expr[], depth: number): { expr: Expr; depth: number }[] => {
    const found: { expr: Expr; depth: number }[] = [];
    const stack = [...roots].reverse().map((expr) => ({ expr, depth }));
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      const { expr } = node;
      if (expr.kind === 'read' || (expr.kind === 'logic' && readsTheRobot(expr))) {
        found.push(node);
      } else if (expr.kind === 'arith' || expr.kind === 'compare') {
        stack.push({ expr: expr.right, depth: node.depth + 1 }, { expr: expr.left, depth: node.depth + 1 });
      } else if (expr.kind === 'not') {
        stack.push({ expr: expr.value, depth: node.depth + 1 });
      }
    }
    return found;
  };

  /** The C++ of the expressions of one region (one, or a call's arguments), and the assignments that sequence its reads, if any. */
  const renderRegion = (roots: readonly Expr[], depth: number): { assignments: string[]; texts: string[] } => {
    const units = unitsOf(roots, depth);
    if (units.length < 2) {
      return { assignments: [], texts: roots.map((root) => renderExpr(root, depth)) };
    }
    const substitution = new Map<Expr, string>();
    const assignments = units.map((unit) => {
      const temp = takeTemp(unit.expr.type);
      const text = renderExpr(unit.expr, unit.depth);
      substitution.set(unit.expr, temp);
      return `${temp} = ${text}`;
    });
    return { assignments, texts: roots.map((root) => renderExpr(root, depth, substitution)) };
  };

  /** One expression, sequenced when it has to be: `(_s1 = <read>, _s2 = <read>, <expr>)`. */
  const renderTop = (expr: Expr, depth: number): string => {
    const { assignments, texts } = renderRegion([expr], depth);
    const text = texts[0] ?? '';
    return assignments.length === 0 ? text : `(${[...assignments, text].join(', ')})`;
  };

  /** `substitution`: the units of a sequenced region, already in their temporaries. */
  const renderExpr = (expr: Expr, depth: number, substitution?: ReadonlyMap<Expr, string>): string => {
    if (depth > MAX_EXPRESSION_DEPTH) {
      deepExpression(expr.blockId);
      return '';
    }
    pending.push(expr.blockId);
    const temp = substitution?.get(expr);
    if (temp !== undefined) {
      return temp;
    }
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
        return `${arithHelper[expr.op]}(${renderExpr(expr.left, depth + 1, substitution)}, ${renderExpr(expr.right, depth + 1, substitution)})`;
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
        return `(${renderExpr(expr.left, depth + 1, substitution)} ${expr.op} ${renderExpr(expr.right, depth + 1, substitution)})`;
      }
      case 'logic': {
        expectType(expr, 'bool', 'A logic result');
        expectType(expr.left, 'bool', `The left side of ${expr.op}`);
        expectType(expr.right, 'bool', `The right side of ${expr.op}`);
        // Sequenced and short-circuit in C++ as in the interpreter: each side is a region of its own (§3.5).
        return `(${renderTop(expr.left, depth + 1)} ${expr.op === 'and' ? '&&' : '||'} ${renderTop(expr.right, depth + 1)})`;
      }
      case 'not':
        expectType(expr, 'bool', 'A "not" result');
        expectType(expr.value, 'bool', 'The value of "not"');
        return `!(${renderExpr(expr.value, depth + 1, substitution)})`;
      case 'read':
        return renderRead(expr);
      default:
        report('unsupported-node', 'The generator does not know this kind of value.', (expr as { blockId?: string }).blockId);
        return '';
    }
  };

  /**
   * N19 A4: the argument a read's driver takes, as C++: the index of a colour (`colorIs(n)`) or of a channel (`colorRaw(k)`) as a long
   * literal; none for the other reads. Null after a diagnostic.
   */
  const readArgs = (read: Expr & ModuleReadExpr): string[] | null => {
    const choice = read.op === 'color.is' ? COLOR_NAMES.indexOf(read.color) : read.op === 'color.raw' ? COLOR_CHANNELS.indexOf(read.channel) : null;
    if (choice === null) {
      return [];
    }
    if (choice < 0) {
      report('value-out-of-range', `"${read.op}" names a ${read.op === 'color.is' ? 'colour' : 'channel'} the colour sensor does not have.`, read.blockId);
      return null;
    }
    return [longLiteral(choice)];
  };

  /** U-19, U-27…U-30 (N19 A4: U-37…U-39) through the kit's drivers, U-33 and U-34 on a raw pin. */
  const renderRead = (expr: Expr & { kind: 'read' }): string => {
    if (isModuleRead(expr)) {
      const read = expr as Expr & ModuleReadExpr;
      useOp(read.op);
      expectType(expr, moduleReadType(read.op), `"${read.op}"`);
      if (read.op === 'time.millis') {
        return '(long)millis()';
      }
      const found = driverOpOf(read.operand.role, read.op, 'read', expr.blockId);
      const args = readArgs(read);
      return found && args ? found.driverOp.cpp.call(found.port, read.operand.role, args) : '';
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

  const expression = (expr: Expr) => renderTop(expr, 1);
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

  /**
   * U-15…U-17: a number or truth value, a text, or a join whose parts are printed one after another, the last with println. In the line
   * map a join, and each join inside it, takes every line of its own parts; a join with no part takes the line of the next part (the
   * println of an empty print).
   */
  const emitPrint = (value: Expr, depth: number) => {
    const parts: Expr[] = [];
    /** Each join, with the parts it holds: `parts[from]` up to, not including, `parts[to]`. */
    const joins: { blockId: string; from: number; to: number }[] = [];
    const flatten = (expr: Expr, level: number) => {
      if (level > MAX_EXPRESSION_DEPTH) {
        deepExpression(expr.blockId);
        return;
      }
      if (expr.kind === 'join') {
        const from = parts.length;
        expr.parts.forEach((part) => flatten(part, level + 1));
        joins.push({ blockId: expr.blockId, from, to: parts.length });
      } else {
        parts.push(expr);
      }
    };
    flatten(value, 1);
    if (parts.length === 0) {
      emit(depth, 'Serial.println(F(""));');
      const line = bodies[section].length - 1;
      joins.forEach((join) => mark(join.blockId, line, line));
      return;
    }
    /** The body line of each part, once it is written. */
    const partLines: number[] = [];
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
      } else if (part.type === 'str') {
        report('unsupported-node', 'The generator does not know this kind of text.', part.blockId);
        return;
      } else {
        emit(depth, `${call}(${expression(part)});`);
      }
      partLines[index] = bodies[section].length - 1;
    });
    for (const join of joins) {
      const first = partLines[Math.min(join.from, parts.length - 1)];
      const last = partLines[Math.max(join.to - 1, Math.min(join.from, parts.length - 1))];
      if (first !== undefined && last !== undefined) {
        mark(join.blockId, first, last);
      }
    }
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
    if (statement.op === 'buzzer.stop') {
      if (found) {
        emit(depth, found.driverOp.cpp.call(found.port, role, []));
      }
      return;
    }
    statement.args.forEach((arg, index) => {
      const range = found?.driverOp.args[index];
      expectType(arg, range === null ? 'bool' : 'int', range === null ? 'An on / off value' : range === undefined ? 'An argument' : `The ${range.name}`);
    });
    // U-25 (§3.5): hz and ms are one region, so when they read the robot twice or more the call itself is sequenced,
    // `(_s1 = <read>, _s2 = <read>, buzzerTone(BUZZER_PIN, _s1, _s2));`. A call with one argument sequences inside it.
    const { assignments, texts } = statement.args.length > 1 ? renderRegion(statement.args, 1) : { assignments: [], texts: statement.args.map(expression) };
    if (found) {
      const call = found.driverOp.cpp.call(found.port, role, texts);
      emit(depth, assignments.length === 0 ? call : `(${[...assignments, call.replace(/;$/, '')].join(', ')});`);
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
  /** §3.5: the temporaries a function takes, declared at its top (after setup()'s setup lines), each once, with its type. */
  const declarations = (of: Section) => temps[of].map((type, index) => `${indentUnit}${type} _s${String(index + 1)};`);
  const assembled = assembleSketch({
    header,
    includes: cpp.includes,
    defines: cpp.defines,
    globals: [...cpp.globals, ...ir.variables.map((variable) => `long ${names.get(variable.id) ?? ''} = 0L;`)],
    helpers,
    functions: [],
    setup: [...setupLines, ...declarations('setup'), ...bodies.setup],
    loop: [...declarations('loop'), ...bodies.loop],
  });
  if (utf8Bytes(assembled.source) > MAX_GENERATED_BYTES) {
    report('program-too-large', `The generated sketch is limited to ${MAX_GENERATED_BYTES} bytes.`);
    return { ok: false, diagnostics };
  }
  const firstLine: Record<Section, number> = {
    setup: assembled.setupBodyLine + setupLines.length + temps.setup.length,
    loop: assembled.loopBodyLine + temps.loop.length,
  };
  const lineMap = [...ranges.entries()]
    .map(([blockId, range]) => ({ blockId, from: firstLine[range.section] + range.from, to: firstLine[range.section] + range.to, order: range.order }))
    .sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order)
    .map(({ blockId, from, to }) => ({ blockId, from, to }));
  return { ok: true, source: assembled.source, lineMap, libraries: libraryList, names: Object.fromEntries(names), diagnostics: [] };
}
