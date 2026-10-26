import { productionKits, unoR3Board, type BoardProfile, type Kit, type VirtualUno } from '../../../hardware';
import { productionProfiles } from '../../../profiles';
import { unoDocument } from '../../../profiles/__fixtures__/uno-document';
import { compileUnoProject } from '../../../program/compile-uno-program';
import {
  analogRead, buttonPressed, buzzerStop, buzzerTone, claw, clawAngle, colorIs, colorRaw, digitalRead, digitalWrite, driveMove, driveStop, gripperKitRef, irDetect, led, lift,
  liftAngle, lineDark, lineRaw, millis, motorSet, packs, pwmWrite, registry, rover, servoSet, ultrasonic, unoCountUp, unoDivide,
} from '../../../program/__fixtures__/uno-blocks';
import { add, and, bool, cmp, getVar, ifElif, ifThen, join, mod, mul, not, num, or, print, program, repeat, setVar, sub, text, wait, whileLoop, type Json } from '../../../program/__fixtures__/ybc-blocks';
import type { YbcProgramIR } from '../../../program/ybc-ir';
import type { UnoProgramUses } from '../../../program/uno-uses';
import { add32, div32, INT32_MAX, INT32_MIN, mod32, mul32, printed, sub32 } from './contract-int32';

// TEST-ONLY (N18 C1): the robot programs whose sketch is a golden (`__golden__/<name>.ino`), as Blockly JSON compiled the way the robot
// lab compiles them (compileUnoProject, against ref-uno-rover@0). `console` is what the program prints, by the arithmetic of contract
// UNO §3 (contract-int32.ts), for the cases that end on their own: generate.parity.test.ts runs their IR in the interpreter, on the
// virtual clock, and compares. `covers` lists the contract rows a case writes.

export type SketchCase = {
  name: string;
  covers: string[];
  profile: 'uno-basic' | 'uno-advanced';
  onStart: Json[];
  forever?: Json[];
  /** [id, name]: the variables of the workspace. */
  variables: [id: string, name: string][];
  /** The lines the program prints, from the contract's arithmetic; absent for a program that never ends (a forever). */
  console?: string[];
  /** What the robot's sensors give the parity run (attached to the virtual UNO before setup()); nothing by default. */
  world?: (uno: VirtualUno) => void;
  /** N19 A4: the kit the case is compiled for; ref-uno-rover@0 when absent. */
  kit?: { readonly id: string; readonly version: string };
};

/** Every call of the result gives the next of `first`, `first + step`, …: the order of the reads shows in the values. */
const counting = (first: number, step: number) => {
  let next = first;
  return () => {
    const value = next;
    next += step;
    return value;
  };
};
/** An echo for every ultrasonic read: 10 cm, 20 cm, … (580 µs per 10 cm, contract §6.6), 450 µs after the trigger. */
const echoes = () => {
  const width = counting(580, 580);
  return () => ({ waitUs: 450, widthUs: width() });
};

const x = () => getVar('x');
const y = () => getVar('y');
const i = () => getVar('i');
const n = () => getVar('n');
/** 1 + (1 + (… + 1)): `depth` additions, value depth + 1. */
const nestedAdd = (depth: number): Json => (depth === 0 ? num(1) : add(num(1), nestedAdd(depth - 1)));
/** `levels` repeats, each once, one inside the other, around `body`. */
const nestedRepeat = (levels: number, body: Json[]): Json[] => (levels === 0 ? body : [repeat(num(1), nestedRepeat(levels - 1, body))]);
const xyz: [string, string][] = [
  ['x', 'x'],
  ['y', 'y'],
];

export const sketchCases: SketchCase[] = [
  { name: 'empty-program', covers: ['U-01', 'U-02'], profile: 'uno-basic', onStart: [], variables: [], console: [] },
  {
    name: 'mul-literal',
    covers: ['U-03', 'U-04', 'U-05', 'U-15'],
    profile: 'uno-basic',
    onStart: [setVar('x', mul(num(300), num(200))), print(x()), print(mul(num(300), num(200)))],
    variables: xyz,
    console: [printed(mul32(300, 200)), printed(mul32(300, 200))],
  },
  {
    name: 'int32-wrap',
    covers: ['U-04', 'U-05', 'U-06', 'U-09', 'U-15'],
    profile: 'uno-basic',
    onStart: [
      setVar('x', num(INT32_MAX)),
      print(add(x(), num(1))),
      print(sub(num(INT32_MIN), num(1))),
      print(mul(num(65536), num(65536))),
      print(mul(num(INT32_MAX), num(INT32_MAX))),
      setVar('y', num(1_073_741_824)),
      print(unoDivide(mul(y(), num(2)), num(2))),
      print(cmp('GT', add(x(), num(1)), x())),
      print(sub(num(0), num(INT32_MIN))),
      print(num(INT32_MIN)),
    ],
    variables: xyz,
    console: [
      printed(add32(INT32_MAX, 1)),
      printed(sub32(INT32_MIN, 1)),
      printed(mul32(65536, 65536)),
      printed(mul32(INT32_MAX, INT32_MAX)),
      printed(div32(mul32(1_073_741_824, 2), 2)),
      printed(add32(INT32_MAX, 1) > INT32_MAX),
      printed(sub32(0, INT32_MIN)),
      printed(INT32_MIN),
    ],
  },
  {
    name: 'division-by-zero',
    covers: ['U-06', 'U-07', 'U-15'],
    profile: 'uno-basic',
    onStart: [
      print(unoDivide(num(7), num(0))),
      print(mod(num(7), num(0))),
      setVar('x', num(0)),
      print(unoDivide(num(-7), x())),
      print(mod(num(-7), x())),
      print(unoDivide(num(-7), num(2))),
      print(mod(num(-7), num(2))),
      print(mod(num(7), num(-2))),
      print(unoDivide(num(INT32_MIN), num(-1))),
      print(mod(num(INT32_MIN), num(-1))),
    ],
    variables: xyz,
    console: [
      printed(div32(7, 0)),
      printed(mod32(7, 0)),
      printed(div32(-7, 0)),
      printed(mod32(-7, 0)),
      printed(div32(-7, 2)),
      printed(mod32(-7, 2)),
      printed(mod32(7, -2)),
      printed(div32(INT32_MIN, -1)),
      printed(mod32(INT32_MIN, -1)),
    ],
  },
  {
    name: 'count-up-bounds-once',
    covers: ['U-03', 'U-14', 'U-15'],
    profile: 'uno-basic',
    onStart: [
      setVar('n', num(3)),
      unoCountUp('i', num(1), n(), [setVar('n', add(n(), num(1))), print(i())]),
      print(i()),
      print(n()),
      setVar('i', num(99)),
      unoCountUp('i', n(), num(2), [print(i())]),
      print(i()),
      unoCountUp('i', num(-2), num(-1), []),
      print(i()),
    ],
    variables: [
      ['i', 'i'],
      ['n', 'n'],
    ],
    // The end is read once (3) although the body raises n to 6; i keeps its last value; a start above the end at run time runs none
    // and leaves i as it was.
    console: ['1', '2', '3', '3', '6', '99', '-1'],
  },
  {
    // The body changes the count up's own variable (contract §3.3, U-14): the next turn still takes its value from _c, so the loop runs
    // its five turns, and after the loop the variable keeps what the last body left (5 + 10), as the interpreter's counter does.
    name: 'count-up-body-changes-variable',
    covers: ['U-05', 'U-14', 'U-15'],
    profile: 'uno-basic',
    onStart: [
      unoCountUp('i', num(1), num(5), [setVar('i', add(i(), num(10))), print(i())]),
      print(i()),
      unoCountUp('i', num(1), num(3), [print(i()), setVar('i', num(100))]),
      print(i()),
    ],
    variables: [['i', 'i']],
    console: [...[1, 2, 3, 4, 5].map((k) => printed(add32(k, 10))), printed(add32(5, 10)), '1', '2', '3', '100'],
  },
  {
    name: 'millis-compare',
    covers: ['U-09', 'U-11', 'U-13', 'U-16', 'U-19'],
    profile: 'uno-advanced',
    onStart: [
      print(cmp('LT', num(-1), millis())),
      whileLoop(cmp('LT', millis(), num(20)), []),
      print(cmp('GTE', millis(), num(20))),
      setVar('x', millis()),
      ifThen(cmp('GT', x(), num(-1)), [print(text('started'))]),
    ],
    variables: xyz,
    // -1 < (long)millis() is 1 on the board, where -1 < millis() would be 0 (EMU-10).
    console: [printed(true), printed(true), 'started'],
  },
  {
    name: 'print-mixed',
    covers: ['U-15', 'U-16', 'U-17'],
    profile: 'uno-basic',
    onStart: [
      print(text('Xin chào')),
      print(text('say "hi" \\ ok')),
      print(text('??= ??/ ?')),
      print(text('')),
      print(num(42)),
      print(num(-7)),
      print(bool(true)),
      print(bool(false)),
      print(cmp('GT', num(3), num(2))),
      setVar('x', num(5)),
      print(join(text('x = '), x(), text(', big: '), cmp('GT', x(), num(3)))),
      print(join()),
      print(join(x())),
      print(join(text('a'), join(text('b'), x()), bool(false))),
    ],
    variables: xyz,
    console: ['Xin chào', 'say "hi" \\ ok', '??= ??/ ?', '', '42', '-7', '1', '0', '1', 'x = 5, big: 1', '', '5', 'ab50'],
  },
  {
    name: 'nested-control',
    covers: ['U-09', 'U-10', 'U-11', 'U-12', 'U-13', 'U-14', 'U-16'],
    profile: 'uno-basic',
    onStart: [
      setVar('x', num(0)),
      whileLoop(cmp('LT', x(), num(3)), [
        setVar('x', add(x(), num(1))),
        ifElif([[cmp('EQ', x(), num(1)), [print(text('one'))]], [cmp('EQ', x(), num(2)), [print(text('two'))]]], [print(text('other'))]),
      ]),
      unoCountUp('i', num(1), num(2), [repeat(num(2), [unoCountUp('y', num(1), num(2), [print(add(mul(i(), num(10)), y()))])])]),
      ifThen(and(not(cmp('GT', x(), num(5))), or(cmp('EQ', x(), num(3)), bool(false))), [print(text('logic'))], [print(text('no'))]),
      repeat(num(-3), [print(text('never'))]),
    ],
    variables: [
      ['x', 'x'],
      ['y', 'y'],
      ['i', 'i'],
    ],
    console: ['one', 'two', 'other', '11', '12', '11', '12', '21', '22', '21', '22', 'logic'],
  },
  {
    name: 'names',
    covers: ['U-03'],
    profile: 'uno-basic',
    onStart: [
      setVar('a', num(1)),
      setVar('b', num(2)),
      setVar('c', num(3)),
      setVar('d', num(4)),
      setVar('e', num(5)),
      setVar('f', num(6)),
      setVar('g', num(7)),
      setVar('h', num(8)),
      print(add(getVar('a'), add(getVar('b'), add(getVar('c'), add(getVar('d'), add(getVar('e'), add(getVar('f'), add(getVar('g'), getVar('h'))))))))),
    ],
    variables: [
      ['a', 'số lượng'],
      ['b', 'int'],
      ['c', 'delay'],
      ['d', 'servo1'],
      ['e', 'B101'],
      ['f', 'so luong'],
      ['g', '9 lives'],
      ['h', 'MOTOR_LEFT_EN'],
    ],
    console: ['36'],
  },
  {
    name: 'every-module-op',
    covers: ['U-18', 'U-20', 'U-21', 'U-22', 'U-23', 'U-24', 'U-25', 'U-26', 'U-27', 'U-28', 'U-29', 'U-30'],
    profile: 'uno-advanced',
    onStart: [
      driveMove('forward', num(60)),
      wait(num(100)),
      driveMove('backward', num(60)),
      driveMove('spinLeft', num(40)),
      driveMove('spinRight', x()),
      driveStop(),
      motorSet('motorLeft', num(50)),
      motorSet('motorRight', num(-100)),
      servoSet('servo1', num(45)),
      led('ON'),
      led('OFF'),
      buzzerTone(num(440), num(100)),
      buzzerStop(),
      setVar('x', ultrasonic()),
      print(x()),
      print(lineDark('lineLeft')),
      print(lineDark('lineCenter')),
      print(lineDark('lineRight')),
      print(lineRaw('lineLeft')),
      print(lineRaw('lineCenter')),
      print(lineRaw('lineRight')),
      print(buttonPressed()),
    ],
    forever: [ifThen(cmp('LT', ultrasonic(), num(20)), [driveStop()], [driveMove('forward', num(50))])],
    variables: xyz,
  },
  {
    name: 'raw-pins',
    covers: ['U-31', 'U-32', 'U-33', 'U-34'],
    profile: 'uno-advanced',
    onStart: [
      digitalWrite('A3', 'HIGH'),
      digitalWrite('A3', 'LOW'),
      pwmWrite('A4', num(200)),
      setVar('x', num(300)),
      pwmWrite('A4', x()),
      print(digitalRead('D3')),
      print(digitalRead('A1')),
      print(analogRead('A0')),
    ],
    variables: xyz,
  },
  {
    // The deepest block nesting the generator writes (MAX_STATEMENT_DEPTH = 64 levels: 63 repeats and the print), with an expression
    // 30 deep inside it (the compiler allows 100 nested blocks in all): `pnpm check:arduino` compiles it.
    name: 'deep-nesting',
    covers: ['U-05', 'U-12', 'U-15'],
    profile: 'uno-basic',
    onStart: nestedRepeat(63, [print(nestedAdd(30))]),
    variables: [],
    console: [printed(31)],
  },
  {
    // Contract §3.5 (0.1.3): two reads in one helper call, comparison or buzzerTone are sequenced with the comma operator, left to right.
    // The three line sensors share one counter (10, 20, 30, … per analogRead), the echoes give 10, 20, 30, … cm: a value says which read
    // came first. "line raw left − line raw right" and "distance + distance".
    name: 'sequenced-reads',
    covers: ['U-05', 'U-09', 'U-17', 'U-20', 'U-25', 'U-27', 'U-29'],
    profile: 'uno-advanced',
    onStart: [
      print(sub(lineRaw('lineLeft'), lineRaw('lineRight'))),
      setVar('x', add(ultrasonic(), ultrasonic())),
      print(x()),
      print(cmp('GT', lineRaw('lineLeft'), add(lineRaw('lineRight'), num(5)))),
      buzzerTone(lineRaw('lineCenter'), ultrasonic()),
      motorSet('motorLeft', sub(lineRaw('lineLeft'), lineRaw('lineRight'))),
      print(join(text('d = '), sub(ultrasonic(), ultrasonic()))),
    ],
    variables: xyz,
    console: [printed(sub32(10, 20)), printed(add32(10, 20)), printed(30 > add32(40, 5)), `d = ${printed(sub32(40, 50))}`],
    world: (uno) => {
      const shared = counting(10, 10);
      ['A0', 'A1', 'A2'].forEach((pin) => uno.attachAnalogSource(pin, shared));
      uno.attachPulseSource('D11', echoes());
    },
  },
  {
    // A while condition with two reads is sequenced again on every evaluation; an else-if is evaluated only when it is reached.
    name: 'while-two-reads',
    covers: ['U-09', 'U-11', 'U-13', 'U-29'],
    profile: 'uno-advanced',
    onStart: [
      setVar('x', num(0)),
      whileLoop(cmp('LT', lineRaw('lineLeft'), lineRaw('lineRight')), [setVar('x', add(x(), num(1)))]),
      print(x()),
      ifElif(
        [
          [cmp('GT', lineRaw('lineLeft'), lineRaw('lineRight')), [print(text('left'))]],
          [cmp('LT', lineRaw('lineLeft'), lineRaw('lineRight')), [print(text('right'))]],
        ],
        [print(text('same'))],
      ),
    ],
    variables: xyz,
    // The left sensor reads 0, 10, 20, … and the right one 35: four turns (0…30 < 35), then 50 > 35.
    console: ['4', 'left'],
    world: (uno) => {
      uno.attachAnalogSource('A0', counting(0, 10));
      uno.attachAnalogSource('A2', () => 35);
    },
  },
  {
    // && and || stay native (contract §3.5, U-10): sequenced, and the right side is not read when the left decides. An && that reads,
    // compared with another read, is taken whole into a bool temporary.
    name: 'logic-reads',
    covers: ['U-09', 'U-10', 'U-11', 'U-13', 'U-27', 'U-28', 'U-30'],
    profile: 'uno-basic',
    onStart: [
      ifThen(and(lineDark('lineLeft'), lineDark('lineRight')), [print(text('both'))]),
      ifThen(or(buttonPressed(), cmp('LT', ultrasonic(), num(10))), [print(text('stop'))]),
      print(ultrasonic()),
      print(cmp('EQ', and(lineDark('lineLeft'), lineDark('lineCenter')), lineDark('lineRight'))),
      setVar('x', num(0)),
      whileLoop(and(not(buttonPressed()), cmp('LT', x(), num(3))), [setVar('x', add(x(), num(1)))]),
      print(x()),
    ],
    variables: xyz,
    // The button is held, so the || never reads the distance: the first echo (10 cm) is the print's. (true && false) == true is 0, and
    // the while stops at not(pressed) without comparing x.
    console: ['both', 'stop', '10', printed(false), '0'],
    world: (uno) => {
      uno.attachDigitalSource('A0', () => 1);
      uno.attachDigitalSource('A1', () => 0);
      uno.attachDigitalSource('A2', () => 1);
      uno.attachDigitalSource('D3', () => 0);
      uno.attachPulseSource('D11', echoes());
    },
  },
  {
    name: 'forever-blink',
    covers: ['U-02', 'U-18', 'U-24'],
    profile: 'uno-basic',
    onStart: [print(text('start'))],
    forever: [led('ON'), wait(num(500)), led('OFF'), wait(num(500))],
    variables: [],
  },
  {
    // N19 A4: every op of the gripper car on ref-uno-gripper@0: the claw's and the arm's two positions and any angle (a computed one
    // too), the IR sensor between the jaws and the colour sensor's colour and raw value (Advanced), with the drive it carries them on.
    name: 'gripper-every-op',
    covers: ['U-35', 'U-36', 'U-37', 'U-38', 'U-39', 'U-21', 'U-22', 'U-11', 'U-13', 'U-15', 'U-03', 'U-05'],
    profile: 'uno-advanced',
    kit: gripperKitRef,
    onStart: [lift('DOWN'), claw('OPEN'), setVar('x', num(40))],
    forever: [
      whileLoop(not(irDetect()), [driveMove('forward', num(50))]),
      driveStop(),
      claw('CLOSE'),
      lift('UP'),
      ifElif([
        [colorIs('red'), [liftAngle(num(45))]],
        [colorIs('unknown'), [clawAngle(add(x(), num(5)))]],
      ]),
      print(colorRaw('clear')),
      lift('DOWN'),
      claw('OPEN'),
    ],
    variables: xyz,
  },
];

export const referenceKit: Kit = rover;
export const referenceBoard: BoardProfile = unoR3Board;

/** The workspace of a case: its hats and its variables. */
export function blocksOf(c: Pick<SketchCase, 'onStart' | 'forever' | 'variables'>): Json {
  return { ...program(c.onStart, c.forever, []), variables: c.variables.map(([id, name]) => ({ id, name })) };
}

/** Compiles a case as the robot lab does (compileUnoProject); throws when it does not compile. */
export function compileCase(c: Pick<SketchCase, 'onStart' | 'forever' | 'variables' | 'profile' | 'kit'>): { ir: YbcProgramIR; kit: Kit; board: BoardProfile; uses: UnoProgramUses } {
  const document = unoDocument(c.profile, { program: { blocks: blocksOf(c) }, ...(c.kit ? { kit: { ...c.kit } } : {}) });
  const compiled = compileUnoProject(document, { registry, profiles: productionProfiles, packs, kits: productionKits });
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled;
}
