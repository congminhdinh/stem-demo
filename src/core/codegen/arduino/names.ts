import { pinMacro } from '../../hardware/drivers';
import { driverIds, driverPortSpecs, robotRoles } from '../../hardware/kit';
import { languageHelperNames } from './sections';
import { toolchainNames } from './toolchain-names';

// C++ names for Blockly variables in a generated sketch (N18 C1), as yolobit/names.ts does for Python: a name is made ASCII and a
// legal identifier, kept away from everything the sketch and the pinned toolchain already mean, and made unique, all in the order of
// `variables`, so the same program always gets the same names. A learner name never starts with `_` (those are the generator's own:
// `_n`, `_r`, `_from`, `_to`, `_c`, `_s`, and the sequencing temporaries `_s1`, `_s2`, … of contract §3.5) and never holds `__` (C++
// reserves it).
//
// Kept away from: the C++ keywords and alternative tokens (`and` is an operator in C++); every identifier the pinned toolchain uses at
// file scope (toolchain-names.ts, extracted by scripts/arduino-reserved-names.mjs: Arduino's API, the AVR registers and macros, the C
// library, binary.h's B0…B11111111); and the sketch's own names: setup and loop, the helpers (contract §3.2, §6), every robot role (a
// servo is a `Servo <role>;` global) and every pin macro a kit can define (`MOTOR_LEFT_EN`).

const keywords = [
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break', 'case', 'catch', 'char', 'char16_t',
  'char32_t', 'class', 'compl', 'const', 'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do', 'double',
  'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int',
  'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected',
  'public', 'register', 'reinterpret_cast', 'return', 'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct',
  'switch', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
  'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor', 'xor_eq',
];

/** The driver helpers of contract §6 (the language's are `languageHelperNames`), and the two functions every sketch defines. */
const sketchNames = ['setup', 'loop', 'main', 'motorSet', 'servoSet', 'buzzerTone', 'ultrasonicCm'];

/** `<ROLE>_<PIN>` for every role and every pin name of every driver: what `#define` a kit may write (contract §2.1). */
const pinMacros = () => robotRoles.flatMap((role) => driverIds.flatMap((driver) => Object.keys(driverPortSpecs[driver].pins).map((pin) => pinMacro(role, pin))));

let own: ReadonlySet<string> | undefined;

/** The sequencing temporaries of contract §3.5: `_s<k>`, declared in setup() or loop(). */
export const isSequencingTemporary = (name: string): boolean => /^_s\d+$/.test(name);

/** Whether a name is taken in every generated sketch. */
export function isReservedCppName(name: string): boolean {
  own ??= new Set([...keywords, ...sketchNames, ...languageHelperNames, ...robotRoles, ...pinMacros()]);
  return own.has(name) || toolchainNames().has(name) || /^B[01]{1,8}$/.test(name) || isSequencingTemporary(name);
}

/** ASCII letters, digits and single `_`s: accents are dropped (đ becomes d), anything else becomes `_`, and a name starts with a letter. */
export function sanitizeCppName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_');
  return /^[A-Za-z]/.test(ascii) ? ascii : `v_${ascii.replace(/^_+/, '')}`;
}

export type CppNameAssignment = { ok: true; names: Map<string, string> } | { ok: false; message: string; variableId: string };

/** One C++ name per variable id, unique, in the order given. A taken name gets `_2`, `_3`, … (never `__`). */
export function assignCppNames(variables: readonly { id: string; name: string }[]): CppNameAssignment {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const variable of variables) {
    if (names.has(variable.id)) {
      return { ok: false, message: `The variable id "${variable.id}" is used twice.`, variableId: variable.id };
    }
    const base = sanitizeCppName(variable.name);
    const stem = base.replace(/_+$/, '');
    let candidate = base;
    for (let suffix = 2; isReservedCppName(candidate) || used.has(candidate); suffix += 1) {
      candidate = `${stem}_${String(suffix)}`;
    }
    used.add(candidate);
    names.set(variable.id, candidate);
  }
  return { ok: true, names };
}
