import { add, and, cmp, countUp, getVar, idiv, ifElif, ifThen, join, mul, not, num, or, print, program, setVar, text, whileLoop, type Json } from '../../../program/__fixtures__/ybc-blocks';
import { pinAnalog, pinRead, pinWrite, pinWriteAnalog, servoWrite } from '../../../program/__fixtures__/ybc-pin-blocks';

// The pin programs of YB-4, as Blockly JSON: each is compiled to the IR (for the ybc-board), run by the
// interpreter AND generated to Python. The golden of a case is `pins/__golden__/<name>.py`. `covers` lists the
// contract rows the case exercises. The hardware is scripted: `scripts` say what each read returns (the n-th
// read of a pin gets the n-th value; after the last it stays there), and the parity test runs the case once for
// every script, in the simulator and under CPython with a fake `yolobit`, and compares what both did.

export type PinScript = {
  /** Digital reads (0 or 1) by pin. */
  digital: Record<string, number[]>;
  /** Analog reads (0..4095) by pin. */
  analog: Record<string, number[]>;
};

export type PinCase = { name: string; covers: string[]; blocks: Json; scripts: PinScript[] };

const script = (digital: PinScript['digital'], analog: PinScript['analog'] = {}): PinScript => ({ digital, analog });

const x = () => getVar('x');

export const pinCases: PinCase[] = [
  {
    name: 'pins-digital-write',
    covers: ['C-01', 'C-02', 'C-23'],
    blocks: program([pinWrite('P0', true), pinWrite('P1', false), pinWrite('P2', true)], [pinWrite('P0', false), pinWrite('P0', true)]),
    scripts: [script({})],
  },
  {
    // A loopback: P0 is written, P1 is wired to it, and the program mirrors P1 back (digital read, if / else).
    name: 'pins-digital-read',
    covers: ['C-02', 'C-23', 'C-24'],
    blocks: program([], [ifThen(pinRead('P1'), [pinWrite('P0', true), print(text('on'))], [pinWrite('P0', false), print(text('off'))])]),
    scripts: [script({ P1: [1] }), script({ P1: [0] })],
  },
  {
    // P7 of the contract (§18): the knob on P1 above 2048 (native scale 0..4095) switches the LED on P0.
    name: 'pins-knob-led',
    covers: ['C-02', 'C-23', 'C-25'],
    blocks: program([], [ifThen(cmp('GT', pinAnalog('P1'), num(2048)), [pinWrite('P0', true)], [pinWrite('P0', false)])]),
    // 2048 is the middle of the knob: not above it. 2049 is.
    scripts: [script({}, { P1: [4095] }), script({}, { P1: [2048] }), script({}, { P1: [2049] }), script({}, { P1: [0] })],
  },
  {
    name: 'pins-expressions',
    covers: ['C-01', 'C-02', 'C-24', 'C-25', 'C-30', 'C-31', 'C-34', 'C-35', 'C-36', 'C-56'],
    blocks: program(
      [
        setVar('x', add(pinAnalog('P0'), num(1))),
        print(x()),
        print(idiv(pinAnalog('P2'), num(41))),
        print(join(text('level='), pinAnalog('P1'))),
        print(not(pinRead('P0'))),
      ],
      [
        ifElif(
          [
            [and(pinRead('P0'), not(pinRead('P1'))), [print(text('a'))]],
            [or(pinRead('P2'), cmp('LTE', pinAnalog('P1'), num(100))), [print(text('b'))]],
          ],
          [print(text('c'))],
        ),
      ],
    ),
    scripts: [
      // P0 on, P1 off: the first branch. P0 off: its right side is never read (short-circuit), the second branch decides.
      script({ P0: [1], P1: [0], P2: [0] }, { P0: [7], P1: [300], P2: [4095] }),
      script({ P0: [0], P1: [1], P2: [1] }, { P0: [0], P1: [50], P2: [0] }),
      script({ P0: [0], P1: [1], P2: [0] }, { P0: [4094], P1: [101], P2: [41] }),
    ],
  },
  {
    // A pin read in a loop condition: waits for the pin to go on, then writes it back out.
    name: 'pins-while-read',
    covers: ['C-23', 'C-24', 'C-38'],
    blocks: program([whileLoop(not(pinRead('P2')), [print(text('waiting'))]), pinWrite('P0', true)]),
    // P2 goes on at the third read.
    scripts: [script({ P2: [0, 0, 1] }), script({ P2: [1] })],
  },
  // N17 B5: analog write (PWM, C-26) and the servo (C-27). The brief's two lines, and a typed-in value outside the range, which
  // the generator writes clamped (2000 is 1023, -30 is 0), as the simulator clamps it.
  {
    name: 'pins-pwm-and-servo',
    covers: ['C-01', 'C-26', 'C-27'],
    blocks: program([pinWriteAnalog('P0', num(512)), servoWrite('P1', num(90)), pinWriteAnalog('P0', num(2000)), servoWrite('P1', num(-30))]),
    scripts: [script({})],
  },
  {
    // A fade and a sweep: computed values are written as max(0, min(top, v)); the last step (1200 and 200) is clamped on both sides.
    name: 'pins-fade-and-sweep',
    covers: ['C-02', 'C-26', 'C-27', 'C-30', 'C-32', 'C-34'],
    blocks: program([], [countUp('x', num(0), num(4), 1, [pinWriteAnalog('P0', mul(getVar('x'), num(300))), servoWrite('P2', mul(getVar('x'), num(50)))])]),
    scripts: [script({})],
  },
  {
    // The knob on P2 turns the servo on P1: 4095 // 22 is 186, clamped to 180; the pin is read once.
    name: 'pins-knob-servo',
    covers: ['C-02', 'C-25', 'C-27', 'C-34'],
    blocks: program([], [servoWrite('P1', idiv(pinAnalog('P2'), num(22)))]),
    scripts: [script({}, { P2: [0] }), script({}, { P2: [2048] }), script({}, { P2: [4095] })],
  },
];
