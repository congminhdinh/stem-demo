import type { ArithOp, UnoCallOp, UnoReadOp } from '../../program/ybc-ir';

// The parts of a generated sketch (N18 C1) and their fixed order (contract UNO §2.1, plan C1): header comment (scenario, kit@version)
// → #include → #define of the kit's pins → globals (`Servo <role>;`, the learner's `long`s) → helpers (each used one once) → the
// learner's functions (none: U-42 is DEFERRED) → setup() → loop(). The language's helpers are written here, not read from
// compat/uno-contract.ts, so that the large contract data stays out of the app bundle (as yolobit/modules.ts does);
// generate.constructs.test.ts keeps them equal to the contract's text, which is the text contract-forms.ino compiled and traced.

/** The helpers of the language (contract §3.2) and of the raw pins (§9), by the contract's id. The drivers' are their `cpp.helper`. */
export const languageHelpers = {
  // Literals joined with +, not [...].join: the bundler can drop a constant it never needs (the app shows no sketch outside the robot lab).
  int32:
    'long add32(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }\n' +
    'long sub32(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }\n' +
    'long mul32(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }\n' +
    'long neg32(long a) { return (long)(0UL - (unsigned long)a); }\n' +
    'long div32(long a, long b) { return b == -1L ? neg32(a) : (b == 0L ? 0L : a / b); }\n' +
    'long mod32(long a, long b) { return (b == -1L || b == 0L) ? 0L : a % b; }',
  'pwm-write':
    'void pwmWrite(uint8_t pin, long value) {\n' +
    '  if (value < 0L) value = 0L;\n' +
    '  if (value > 255L) value = 255L;\n' +
    '  analogWrite(pin, (int)value);\n' +
    '}',
} as const;

export type LanguageHelperId = keyof typeof languageHelpers;

/** The functions the language helpers define: no learner name may take them (names.ts). */
export const languageHelperNames: readonly string[] = ['add32', 'sub32', 'mul32', 'neg32', 'div32', 'mod32', 'pwmWrite'];

/** The int32 helper of each arithmetic operator of the IR (contract U-05…U-07): never the plain operator (§3.2). */
export const arithHelper: Readonly<Record<ArithOp, string>> = { '+': 'add32', '-': 'sub32', '*': 'mul32', '//': 'div32', '%': 'mod32' };

/**
 * The contract row of every op a uno IR can hold, and the language helpers it needs (contract §2.3, column "Helper"). A module op's
 * own helper is its driver's (`kitCpp`); the drive needs int32 too, for `neg32(_s)`. Typed by the ops, so an op without an entry
 * does not compile.
 */
export const unoOps: Readonly<Record<ArithOp | UnoCallOp | UnoReadOp, { readonly row: string; readonly helpers: readonly LanguageHelperId[] }>> = {
  '+': { row: 'U-05', helpers: ['int32'] },
  '-': { row: 'U-05', helpers: ['int32'] },
  '*': { row: 'U-05', helpers: ['int32'] },
  '//': { row: 'U-06', helpers: ['int32'] },
  '%': { row: 'U-07', helpers: ['int32'] },
  'time.millis': { row: 'U-19', helpers: [] },
  'motor.set': { row: 'U-20', helpers: [] },
  'drive.move': { row: 'U-21', helpers: ['int32'] },
  'drive.stop': { row: 'U-22', helpers: [] },
  'servo.set': { row: 'U-23', helpers: [] },
  'led.set': { row: 'U-24', helpers: [] },
  'buzzer.tone': { row: 'U-25', helpers: [] },
  'buzzer.stop': { row: 'U-26', helpers: [] },
  'ultrasonic.cm': { row: 'U-27', helpers: [] },
  'line.dark': { row: 'U-28', helpers: [] },
  'line.raw': { row: 'U-29', helpers: [] },
  'button.pressed': { row: 'U-30', helpers: [] },
  'digital.write': { row: 'U-31', helpers: [] },
  'pwm.write': { row: 'U-32', helpers: ['pwm-write'] },
  'digital.read': { row: 'U-33', helpers: [] },
  'analogIn.read': { row: 'U-34', helpers: [] },
  // N19 A4 (plan §4.3): the gripper car's. Their helpers are their drivers' (gripperSet, the colour helpers).
  'gripper.claw': { row: 'U-35', helpers: [] },
  'gripper.lift': { row: 'U-36', helpers: [] },
  'ir.detect': { row: 'U-37', helpers: [] },
  'color.is': { row: 'U-38', helpers: [] },
  'color.raw': { row: 'U-39', helpers: [] },
};

export type SketchParts = {
  readonly header: readonly string[];
  readonly includes: readonly string[];
  readonly defines: readonly string[];
  readonly globals: readonly string[];
  /** Each helper's text, in the order they are written. */
  readonly helpers: readonly string[];
  /** The learner's functions: none in contract v0 (U-42 DEFERRED). */
  readonly functions: readonly string[];
  /** The lines inside setup() and loop(), already indented. */
  readonly setup: readonly string[];
  readonly loop: readonly string[];
};

/**
 * The sketch text, in the fixed order, one blank line between two non-empty parts; and the 1-based line of the first line inside
 * setup() and inside loop(), for the line map.
 */
export function assembleSketch(parts: SketchParts): { source: string; setupBodyLine: number; loopBodyLine: number } {
  const blocks: string[][] = [
    [...parts.header],
    [...parts.includes],
    [...parts.defines],
    [...parts.globals],
    ...parts.helpers.map((text) => text.split('\n')),
    ...parts.functions.map((text) => text.split('\n')),
  ].filter((block) => block.length > 0);
  const lines: string[] = [];
  const add = (block: readonly string[]) => {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(...block);
  };
  blocks.forEach(add);
  add(['void setup() {']);
  const setupBodyLine = lines.length + 1;
  lines.push(...parts.setup, '}');
  add(['void loop() {']);
  const loopBodyLine = lines.length + 1;
  lines.push(...parts.loop, '}');
  return { source: `${lines.join('\n')}\n`, setupBodyLine, loopBodyLine };
}
