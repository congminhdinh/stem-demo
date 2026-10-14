// Python names for Blockly variables (YB plan §13.5). Blockly names are free text
// and Blockly ids are not meant to be read, so neither is copied into the program:
// a name is made ASCII and legal, kept away from everything the target already
// means, and made unique, all in the order of `variables`, so the same program
// always gets the same names. A learner name never starts with `_`; those are
// the generator's own (the `repeat` counter, the `count up` bounds, IM-10).

const keywords = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
  'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
];

const builtins = [
  'abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
  'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr',
  'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list',
  'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property',
  'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
  'tuple', 'type', 'vars', 'zip', 'Exception', 'KeyboardInterrupt', 'ZeroDivisionError',
];

/** Modules and the `yolobit` names the contract uses or that `from yolobit import *` brings in (contract §2, §4–§11). */
const targetNames = [
  'time', 'music', 'random', 'yolobit', 'display', 'Image', 'button_a', 'button_b', 'light_level', 'temperature',
];

const reserved = new Set([...keywords, ...builtins, ...targetNames]);

/** pin0, pin1, … belong to the `yolobit` module. */
const isReserved = (name: string) => reserved.has(name) || /^pin\d+$/.test(name);

/** ASCII letters, digits and `_`: accents are dropped (đ becomes d), anything else becomes `_`, and a name never starts with a digit or `_`. */
export function sanitizeName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z]/.test(ascii) ? ascii : `v_${ascii.replace(/^_+/, '')}`;
}

export type NameAssignment = { ok: true; names: Map<string, string> } | { ok: false; message: string; variableId: string };

/** One Python name per variable id, unique, in the order given. */
export function assignNames(variables: readonly { id: string; name: string }[]): NameAssignment {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const variable of variables) {
    if (names.has(variable.id)) {
      return { ok: false, message: `The variable id "${variable.id}" is used twice.`, variableId: variable.id };
    }
    const base = sanitizeName(variable.name);
    let candidate = base;
    for (let suffix = 2; isReserved(candidate) || used.has(candidate); suffix += 1) {
      candidate = `${base}_${suffix}`;
    }
    used.add(candidate);
    names.set(variable.id, candidate);
  }
  return { ok: true, names };
}
