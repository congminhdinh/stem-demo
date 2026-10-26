import { drivers, pinMacro } from '../../hardware/drivers';
import { driverIds, driverPortSpecs, robotRoles, type DriverId, type Kit } from '../../hardware/kit';
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
//
// N19 A4 (ruling A23 names): the robot's names are its kit's. A sketch keeps away from the roles its kit has, the pin macros of those
// roles with the pin names of the kit's drivers, what those drivers' C++ declares at file scope (`driverCppNames`: the gripper's
// `<role>Claw` and `gripperSet`, the colour sensor's helpers) and what the libraries they include declare (`libraryNames`: Wire). So a
// ref-uno-rover@0 sketch takes exactly the names it took before the gripper car's kit existed (its ten roles with the pin names of its
// drivers, EN, IN1, IN2, PIN, TRIG and ECHO), and a learner's `gripper` keeps its name there. Without a kit, the names of every kit.

const keywords = [
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break', 'case', 'catch', 'char', 'char16_t',
  'char32_t', 'class', 'compl', 'const', 'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do', 'double',
  'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int',
  'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected',
  'public', 'register', 'reinterpret_cast', 'return', 'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct',
  'switch', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
  'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor', 'xor_eq',
];

/**
 * The driver helpers of contract §6 (the language's are `languageHelperNames`), and the two functions every sketch defines. N18's helpers
 * stay taken in every sketch, whatever its kit: that is what every sketch did before N19.
 */
const sketchNames = ['setup', 'loop', 'main', 'motorSet', 'servoSet', 'buzzerTone', 'ultrasonicCm'];

/**
 * N19 A4: what each driver's C++ declares at file scope besides its role and its pin macros: the globals and the helper's functions,
 * variables, tables and macros (names.kit.test.ts reads them off the driver's text). A Record over every driver, so a new one says its
 * names. N18's helpers are also `sketchNames`.
 */
const driverCppNames: Readonly<Record<DriverId, (role: string) => readonly string[]>> = {
  'hbridge-en-in1-in2': () => ['motorSet'],
  'servo-lib': () => ['servoSet'],
  'hcsr04-pulsein': () => ['ultrasonicCm'],
  'line-digital': () => [],
  'line-analog': () => [],
  'led-digital': () => [],
  'buzzer-tone': () => ['buzzerTone'],
  'button-pullup': () => [],
  'gripper-servo2': (role) => [`${role}Claw`, `${role}Lift`, 'gripperSet'],
  'ir-digital': () => [],
  'tcs34725-wire': () => [
    'COLOR_ADDR', 'COLOR_RULE_COUNT', 'COLOR_RULES', 'colorC', 'colorR', 'colorG', 'colorB', 'colorWrite', 'colorBegin', 'colorFetch', 'colorClassify',
    'colorIs', 'colorRaw',
  ],
};

/**
 * N19 A4: what a library a driver includes declares at file scope, by its include line, beyond the toolchain list (which was extracted
 * with Servo.h). Wire 1.0 of arduino:avr 1.8.8: Wire.h's include guard and macros, its class and object, and the global functions of its
 * utility/twi.c (avr-gcc-nm of a Wire build); a learner global of any of them fails to compile or to link, but TwoWire, a class a
 * variable may hide, which the toolchain list keeps too.
 */
const libraryNames: Readonly<Record<string, readonly string[]>> = {
  '#include <Servo.h>': [],
  '#include <Wire.h>': [
    'TwoWire_h', 'BUFFER_LENGTH', 'WIRE_HAS_END', 'TwoWire', 'Wire', 'twi_attachSlaveRxEvent', 'twi_attachSlaveTxEvent', 'twi_disable', 'twi_handleTimeout',
    'twi_init', 'twi_manageTimeoutFlag', 'twi_readFrom', 'twi_releaseBus', 'twi_reply', 'twi_setAddress', 'twi_setFrequency', 'twi_setTimeoutInMicros',
    'twi_stop', 'twi_transmit', 'twi_writeTo',
  ],
};

/** The pin names of a driver's port: what follows `<ROLE>_` in its macros. */
const pinNamesOf = (driver: DriverId) => Object.keys(driverPortSpecs[driver].pins);

/** The include lines of a driver's ops. */
const includesOf = (driver: DriverId) => Object.values(drivers[driver].ops).flatMap((op) => op.cpp.includes);

/**
 * The robot's names in a sketch of `modules` (role and driver of each): the roles, `<ROLE>_<PIN>` for every role and every pin name of the
 * drivers (what `#define` such a kit may write, contract §2.1), and what the drivers and their libraries declare.
 */
function robotNames(modules: readonly { readonly role: string; readonly driver: DriverId }[]): string[] {
  const roles = [...new Set(modules.map((module) => module.role))];
  const used = [...new Set(modules.map((module) => module.driver))];
  const pins = [...new Set(used.flatMap(pinNamesOf))];
  const includes = [...new Set(used.flatMap(includesOf))];
  return [
    ...roles,
    ...roles.flatMap((role) => pins.map((pin) => pinMacro(role, pin))),
    ...modules.flatMap((module) => driverCppNames[module.driver](module.role)),
    ...includes.flatMap((line) => libraryNames[line] ?? []),
  ];
}

/** Every role with every driver: what no sketch of any kit may take a name from (the reserved names without a kit). */
const everyKit = () => robotNames(robotRoles.flatMap((role) => driverIds.map((driver) => ({ role, driver }))));

/** A kit's roles with the drivers of their ports. */
const kitModules = (kit: Kit) =>
  kit.modules.flatMap((module) => {
    const port = kit.ports.find((candidate) => candidate.id === module.port);
    return port ? [{ role: module.role, driver: port.driver }] : [];
  });

const common = () => [...keywords, ...sketchNames, ...languageHelperNames];
let anyKit: ReadonlySet<string> | undefined;
const byKit = new WeakMap<Kit, ReadonlySet<string>>();

/** The names a sketch of `kit` (any kit's when absent) keeps away from, besides the toolchain's and the generator's own. */
function ownNames(kit: Kit | undefined): ReadonlySet<string> {
  if (kit === undefined) {
    anyKit ??= new Set([...common(), ...everyKit()]);
    return anyKit;
  }
  let names = byKit.get(kit);
  if (names === undefined) {
    names = new Set([...common(), ...robotNames(kitModules(kit))]);
    byKit.set(kit, names);
  }
  return names;
}

/** The sequencing temporaries of contract §3.5: `_s<k>`, declared in setup() or loop(). */
export const isSequencingTemporary = (name: string): boolean => /^_s\d+$/.test(name);

/** N19 A4: whether a name is taken in a generated sketch of `kit`; without a kit, in a sketch of any kit. */
export function isReservedCppNameFor(kit: Kit | undefined, name: string): boolean {
  return ownNames(kit).has(name) || toolchainNames().has(name) || /^B[01]{1,8}$/.test(name) || isSequencingTemporary(name);
}

/** Whether a name is taken in a generated sketch of any kit. */
export const isReservedCppName = (name: string): boolean => isReservedCppNameFor(undefined, name);

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

/**
 * One C++ name per variable id, unique, in the order given, for a sketch of `kit` (N19 A4; any kit's names when absent). A taken name
 * gets `_2`, `_3`, … (never `__`).
 */
export function assignCppNames(variables: readonly { id: string; name: string }[], kit?: Kit): CppNameAssignment {
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const variable of variables) {
    if (names.has(variable.id)) {
      return { ok: false, message: `The variable id "${variable.id}" is used twice.`, variableId: variable.id };
    }
    const base = sanitizeCppName(variable.name);
    const stem = base.replace(/_+$/, '');
    let candidate = base;
    for (let suffix = 2; isReservedCppNameFor(kit, candidate) || used.has(candidate); suffix += 1) {
      candidate = `${stem}_${String(suffix)}`;
    }
    used.add(candidate);
    names.set(variable.id, candidate);
  }
  return { ok: true, names };
}
