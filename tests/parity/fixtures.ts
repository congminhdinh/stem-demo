import { blocksOf, compileCase, sketchCases, type SketchCase } from '../../src/core/codegen/arduino/__fixtures__/sketch-cases';
import { generateUnoSketch } from '../../src/core/codegen/arduino/generate';
import { kitKey, portParam, productionKits, referenceKitRef, type Kit, type KitRef } from '../../src/core/hardware';
import { rehearsalKit, rehearsalKitRef, rehearsalKits } from '../../src/core/hardware/rehearsal-kits';
import { productionProfiles } from '../../src/core/profiles';
import { unoDocument } from '../../src/core/profiles/__fixtures__/uno-document';
import { compileUnoProject } from '../../src/core/program/compile-uno-program';
import {
  buttonPressed, buzzerStop, buzzerTone, claw, clawAngle, colorIs, colorRaw, driveMove, driveStop, gripperKitRef, irDetect, led, lift, liftAngle, lineDark, lineRaw, motorSet,
  packs, registry, servoSet, ultrasonic,
} from '../../src/core/program/__fixtures__/uno-blocks';
import { add, getVar, ifThen, mul, num, print, setVar, wait } from '../../src/core/program/__fixtures__/ybc-blocks';
import type { Rgbc } from '../../src/core/hardware/devices/tcs34725';
import type { ParityInputs } from './inputs';
import type { SimProgram } from './sim-run';

// The parity fixtures (N18 C2, controller ruling): every C1 language golden (the sketch cases that end on their own and print what
// the contract's arithmetic says, codegen/arduino/__fixtures__/sketch-cases.ts), the C1 golden of the raw pins (U-31…U-34), one
// fixture per driver op of ref-uno-rover@0 (motor PWM and direction with the drive, servo, ultrasonic with a scripted echo, line
// dark and raw, LED, button with a scripted press, buzzer tone and stop) and one for negate (U-08). Each runs for `durationMs` of
// virtual time on both sides with the same scripted `inputs`.
//
// Short on purpose (ADR 0003 §7: avr8js runs about 6× realtime): the whole suite is a few seconds of virtual time. Waveforms last
// at least a few of their periods, so the board shows them (board-trace.ts), and echoes sit near the top of a 58 µs centimetre,
// so the board's short pulseIn (allowed difference `pulsein-short`) reads the same centimetre as the simulator.
//
// `pnpm build:parity-hex` (scripts/build-parity-hex.mjs) compiles each fixture's sketch into tests/__parity__/<name>.hex and writes
// the sha256 of the sketch next to it; tests/uno-emulator-parity.test.ts refuses a HEX whose sketch the generator no longer writes.
//
// N18 R8a, the kit-swap rehearsal: `rehearsalParityFixtures` are the driver fixtures again on rehearsal-rover@0 (the same programs, their
// inputs on that kit's pins), with their HEX in tests/__parity-rehearsal__ (`pnpm build:parity-hex --rehearsal`); tests/kit-rehearsal.test.ts
// runs them.

export type ParityFixture = Pick<SketchCase, 'name' | 'covers' | 'profile' | 'onStart' | 'forever' | 'variables'> & {
  /** `golden`: a C1 golden, as sketch-cases.ts has it; `driver`: a driver op of the reference kit; `language`: a language row no golden runs. */
  readonly origin: 'golden' | 'driver' | 'language';
  readonly durationMs: number;
  readonly inputs: ParityInputs;
  /** The kit the program is compiled for (N18 R8a): ref-uno-rover@0 when absent; otherwise a kit of `rehearsalKits`. */
  readonly kit?: KitRef;
};

/**
 * An echo near the top of the centimetre `cm` (58 µs per cm, contract §6.6): 50 µs into it, 450 µs after the trigger. The board's
 * pulseIn reads short, never long (allowed difference `pulsein-short`), so it still reads `cm` while the shortfall stays under
 * 50 µs: 3 % of an echo up to 1666 µs (28 cm), with a tone playing.
 */
export const ECHO_INTO_CM_US = 50;
export const echoOf = (cm: number) => ({ waitUs: 450, widthUs: cm * 58 + ECHO_INTO_CM_US });

/**
 * The scripted world of the goldens that read sensors, in place of their `world` (which only the simulator can run). The same
 * reads in the same order: the three line sensors share one counter and each ultrasonic read gets the next echo, so a printed
 * value still says which read came first. The values differ from the goldens' so that every waveform is long enough to see.
 */
const goldenInputs: Readonly<Record<string, ParityInputs>> = {
  // L R | L R | C (the tone's Hz) | L R (the motor); echoes 10, 12 | 14 (the tone's ms) | 16, 18 cm.
  'sequenced-reads': {
    analog: [{ pins: ['A0', 'A1', 'A2'], values: [100, 200, 300, 400, 500, 600, 700] }],
    echoes: { trig: 'D12', echo: 'D11', readings: [10, 12, 14, 16, 18].map(echoOf) },
  },
  // The left sensor reads 0, 10, … and the right one 35: four turns of the while, then 50 > 35.
  'while-two-reads': { analog: [{ pins: ['A0'], values: [0, 10, 20, 30, 40, 50] }, { pins: ['A2'], values: [35, 35, 35, 35, 35, 35] }] },
  // The button held (D3 LOW behind its pull-up), the center line sensor HIGH, 700 on A0.
  'raw-pins': {
    levels: [
      { pin: 'D3', atUs: 0, level: 0 },
      { pin: 'A1', atUs: 0, level: 1 },
    ],
    analog: [{ pins: ['A0'], values: [700] }],
  },
  // Left and right line dark, center not, the button held: the || never reads the distance, the print's read is 10 cm.
  'logic-reads': {
    levels: [
      { pin: 'A0', atUs: 0, level: 1 },
      { pin: 'A1', atUs: 0, level: 0 },
      { pin: 'A2', atUs: 0, level: 1 },
      { pin: 'D3', atUs: 0, level: 0 },
    ],
    echoes: { trig: 'D12', echo: 'D11', readings: [echoOf(10)] },
  },
};

/** How long each golden runs: until what it prints has left the USART (about 1.04 ms per byte), with room to spare. */
const goldenDurationMs: Readonly<Record<string, number>> = {
  'empty-program': 10,
  'mul-literal': 30,
  'int32-wrap': 120,
  'division-by-zero': 60,
  'count-up-bounds-once': 40,
  'count-up-body-changes-variable': 60,
  'millis-compare': 60,
  'print-mixed': 140,
  'nested-control': 70,
  names: 20,
  'deep-nesting': 20,
  'sequenced-reads': 80,
  'while-two-reads': 30,
  'logic-reads': 40,
  'raw-pins': 20,
};

/** The C1 goldens a parity fixture runs: the language ones (they print what the contract says) and the raw pins. */
export const PARITY_GOLDENS: readonly string[] = [...sketchCases.filter((sketchCase) => sketchCase.console !== undefined).map((sketchCase) => sketchCase.name), 'raw-pins'];

const goldens: ParityFixture[] = sketchCases
  .filter((sketchCase) => PARITY_GOLDENS.includes(sketchCase.name))
  .map((sketchCase) => {
    const durationMs = goldenDurationMs[sketchCase.name];
    if (durationMs === undefined) {
      throw new Error(`No parity duration for the golden ${sketchCase.name}`);
    }
    const { name, covers, profile, onStart, forever, variables } = sketchCase;
    return { name, covers, profile, onStart, ...(forever ? { forever } : {}), variables, origin: 'golden', durationMs, inputs: goldenInputs[name] ?? {} };
  });

const drivers: ParityFixture[] = [
  {
    // EN PWM (D5 Timer0 976.5625 Hz) and IN1/IN2, with every duty kind: 128, 255 (HIGH), 77, 3 (a 12 µs pulse), the drive's
    // ±60 and ±40, stop.
    name: 'driver-motor',
    covers: ['U-20', 'U-21', 'U-22', 'U-18'],
    profile: 'uno-basic',
    onStart: [
      motorSet('motorLeft', num(50)),
      motorSet('motorRight', num(-100)),
      wait(num(30)),
      motorSet('motorLeft', num(-30)),
      motorSet('motorRight', num(1)),
      wait(num(30)),
      motorSet('motorLeft', num(100)),
      wait(num(30)),
      driveMove('forward', num(60)),
      wait(num(30)),
      driveMove('spinLeft', num(40)),
      wait(num(30)),
      driveStop(),
      wait(num(10)),
    ],
    variables: [],
    origin: 'driver',
    durationMs: 175,
    inputs: {},
  },
  {
    // Servo on D9 (Timer1): 90° from setup(), then 45°, 180°, 0° and 135°, four 20 ms frames each. The LED toggles just before
    // each change: an exact event on both sides, so each change is timed from its own call (within one frame).
    name: 'driver-servo',
    covers: ['U-23', 'U-24', 'U-18'],
    profile: 'uno-basic',
    onStart: [45, 180, 0, 135].flatMap((deg, index) => [wait(num(80)), led(index % 2 === 0 ? 'ON' : 'OFF'), servoSet('servo1', num(deg))]).concat([wait(num(80))]),
    variables: [],
    origin: 'driver',
    durationMs: 405,
    inputs: {},
  },
  {
    // HC-SR04 on TRIG D12 / ECHO D11: 10 cm, 25 cm, no echo (400, 20.8 ms of pulseIn), 1 cm (clamped to 2), and an echo longer
    // than the 30 ms timeout (400).
    name: 'driver-ultrasonic',
    covers: ['U-27', 'U-15', 'U-18'],
    profile: 'uno-basic',
    onStart: [print(ultrasonic()), print(ultrasonic()), print(ultrasonic()), print(ultrasonic()), print(ultrasonic()), wait(num(40))],
    variables: [],
    origin: 'driver',
    durationMs: 115,
    inputs: { echoes: { trig: 'D12', echo: 'D11', readings: [echoOf(10), echoOf(25), null, { waitUs: 450, widthUs: 87 }, { waitUs: 450, widthUs: 30_500 }] } },
  },
  {
    // Line sensors on A0/A1/A2: dark (HIGH, activeLow false) read before and after their levels change at 10 ms, then raw values.
    name: 'driver-line',
    covers: ['U-28', 'U-29', 'U-15', 'U-18'],
    profile: 'uno-advanced',
    onStart: [
      print(lineDark('lineLeft')),
      print(lineDark('lineCenter')),
      print(lineDark('lineRight')),
      wait(num(15)),
      print(lineDark('lineLeft')),
      print(lineDark('lineCenter')),
      print(lineDark('lineRight')),
      print(lineRaw('lineLeft')),
      print(lineRaw('lineCenter')),
      print(lineRaw('lineRight')),
    ],
    variables: [],
    origin: 'driver',
    durationMs: 60,
    inputs: {
      levels: [
        { pin: 'A0', atUs: 0, level: 0 },
        { pin: 'A1', atUs: 0, level: 1 },
        { pin: 'A0', atUs: 10_000, level: 1 },
        { pin: 'A1', atUs: 10_000, level: 0 },
        { pin: 'A2', atUs: 10_000, level: 1 },
      ],
      analog: [{ pins: ['A0', 'A1', 'A2'], values: [0, 512, 1023] }],
    },
  },
  {
    // LED on D13: on and off twice, 20 ms apart.
    name: 'driver-led',
    covers: ['U-24', 'U-18'],
    profile: 'uno-basic',
    onStart: [led('ON'), wait(num(20)), led('OFF'), wait(num(20)), led('ON'), wait(num(20)), led('OFF'), wait(num(10))],
    variables: [],
    origin: 'driver',
    durationMs: 75,
    inputs: {},
  },
  {
    // Button on D3 (INPUT_PULLUP, pressed = LOW): held from 15 ms to 35 ms; loop() lights the LED while it is held.
    name: 'driver-button',
    covers: ['U-30', 'U-24', 'U-02'],
    profile: 'uno-basic',
    onStart: [],
    forever: [ifThen(buttonPressed(), [led('ON')], [led('OFF')])],
    variables: [],
    origin: 'driver',
    durationMs: 50,
    inputs: {
      levels: [
        { pin: 'D3', atUs: 15_000, level: 0 },
        { pin: 'D3', atUs: 35_000, level: 1 },
      ],
    },
  },
  {
    // Buzzer on D10 (Timer2): 1000 Hz for 50 ms that ends by itself, 440 Hz stopped after 50 ms, 500 Hz replaced by 1500 Hz
    // while it plays, which then ends by itself. The LED toggles before each call: an exact event to time it from.
    name: 'driver-buzzer',
    covers: ['U-25', 'U-26', 'U-24', 'U-18'],
    profile: 'uno-advanced',
    onStart: [
      led('ON'),
      buzzerTone(num(1000), num(50)),
      wait(num(70)),
      led('OFF'),
      buzzerTone(num(440), num(500)),
      wait(num(50)),
      led('ON'),
      buzzerStop(),
      wait(num(20)),
      led('OFF'),
      buzzerTone(num(500), num(100)),
      wait(num(30)),
      led('ON'),
      buzzerTone(num(1500), num(30)),
      wait(num(50)),
    ],
    variables: [],
    origin: 'driver',
    durationMs: 230,
    inputs: {},
  },
];

/** INT32_MIN, written as a number block, as int32-wrap does. */
const INT32_MIN = -2_147_483_648;

const language: ParityFixture[] = [
  {
    // Negate (U-08) has no block of its own (constructs/uno.ts): its C++, neg32, is the −s of the drive and the helper div32 uses
    // for a division by −1. A computed speed through neg32: −(−50) = 50 forward on both motors; INT32_MIN, which neg32 wraps to
    // itself, clamped to −100 on both sides of the spin; −70 on the left of a spin left.
    name: 'negate-drive',
    covers: ['U-08', 'U-03', 'U-04', 'U-21', 'U-22', 'U-18'],
    profile: 'uno-basic',
    onStart: [
      setVar('x', num(-50)),
      driveMove('backward', getVar('x')),
      wait(num(30)),
      setVar('x', num(INT32_MIN)),
      driveMove('spinRight', getVar('x')),
      wait(num(30)),
      driveMove('spinLeft', num(70)),
      wait(num(30)),
      driveStop(),
      wait(num(10)),
    ],
    variables: [['x', 'x']],
    origin: 'language',
    durationMs: 105,
    inputs: {},
  },
];

/**
 * A pin event right after a tone(), with no wait between: what tone() costs on the board is all of that interval. With a literal
 * frequency and few call sites -flto folds tone(); with one read from the robot it cannot (allowed difference `tone-fold`).
 */
const toneThenPin: ParityFixture[] = [
  {
    name: 'driver-tone-led',
    covers: ['U-25', 'U-24', 'U-18'],
    profile: 'uno-basic',
    onStart: [
      led('ON'),
      buzzerTone(num(1000), num(50)),
      led('OFF'),
      wait(num(60)),
      led('ON'),
      buzzerTone(num(1500), num(100)),
      led('OFF'),
      wait(num(20)),
      led('ON'),
      buzzerTone(num(440), num(30)),
      led('OFF'),
      wait(num(40)),
    ],
    variables: [],
    origin: 'driver',
    durationMs: 130,
    inputs: {},
  },
  {
    // The frequency is lineLeft · 1000 + lineCenter: 1000 Hz on the pin that is still an input, then 440 Hz on the pin that still
    // plays, then 700 Hz on the pin that is an OUTPUT again and silent.
    name: 'driver-tone-computed',
    covers: ['U-25', 'U-24', 'U-29', 'U-05', 'U-18'],
    profile: 'uno-advanced',
    onStart: [
      setVar('x', add(mul(lineRaw('lineLeft'), num(1000)), lineRaw('lineCenter'))),
      led('ON'),
      buzzerTone(getVar('x'), num(60)),
      led('OFF'),
      wait(num(20)),
      setVar('x', add(mul(lineRaw('lineLeft'), num(1000)), lineRaw('lineCenter'))),
      led('ON'),
      buzzerTone(getVar('x'), num(30)),
      led('OFF'),
      wait(num(50)),
      setVar('x', add(mul(lineRaw('lineLeft'), num(1000)), lineRaw('lineCenter'))),
      led('ON'),
      buzzerTone(getVar('x'), num(30)),
      led('OFF'),
      wait(num(40)),
    ],
    variables: [['x', 'x']],
    origin: 'driver',
    durationMs: 160,
    inputs: { analog: [{ pins: ['A0', 'A1'], values: [1, 0, 0, 440, 0, 700] }] },
  },
  // The reviewer's loop: one literal call site, which -flto folds to 17.6 µs whatever the band; at 31 Hz a 40 ms tone is one pulse
  // (tone-duration). The recording ends in the wait after the fourth tone.
  ...[31, 121, 200].map(
    (hz): ParityFixture => ({
      name: `driver-tone-loop-${hz}`,
      covers: ['U-25', 'U-24', 'U-02', 'U-18'],
      profile: 'uno-basic',
      onStart: [],
      forever: [led('ON'), buzzerTone(num(hz), num(40)), led('OFF'), wait(num(50))],
      variables: [],
      origin: 'driver',
      durationMs: 196,
      inputs: {},
    }),
  ),
];

/**
 * N19 C2: the light a palette colour gives the TCS34725 (PLACEHOLDER, the G0.2 spike's and A3's, plan §4.4's units): each channel the
 * white counts per second at 1× of the gripper kit's ColorSensorSpec (48, 44, 36 per ms) × the sRGB component / 255, plus the ambient
 * 0.2 per ms; clear the sum. B3 makes the world's.
 */
function lightOf(hex: string): Rgbc {
  const ambient = 200;
  const component = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  const channel = (whitePerS: number, value: number) => Math.floor((whitePerS * value) / 255) + ambient;
  const r = channel(48_000, component(1));
  const g = channel(44_000, component(3));
  const b = channel(36_000, component(5));
  return { c: r + g + b, r, g, b };
}
/**
 * driver-color's change of light: inside the RGBC Init of its second window (57 162.25…59 562.25 µs, the AEN byte 4362.25 µs into setup()),
 * so neither window has two lights in it.
 */
const COLOR_LIGHT_SWITCH_US = 58_400;
/** The wait that puts driver-color's colorIs read across the end of the second window (measured on both sides). */
const COLOR_STRADDLE_WAIT_MS = 51;
/**
 * LED toggles that move driver-color's read later, to centre the window's end between its 1st and 3rd data byte on both sides: each moves
 * the simulator's read 6.5625 µs (digitalWrite and two nodes) and the board's 3.59 µs (its -flto build), so five leave each side about
 * 34.5 µs of the tighter margin. A change of the costs moves the simulator's side, a change of the sketch the board's: re-measure both.
 */
const COLOR_STRADDLE_NUDGE = [led('ON'), led('OFF'), led('ON'), led('OFF'), led('ON')];
const RED = lightOf('#d32f2f');
const WHITE = lightOf('#f5f5f5');
const YELLOW = lightOf('#fbc02d');

/**
 * N19 C2: the gripper car's driver fixtures, on ref-uno-gripper@0 (plan §7 C2): the claw and the arm (gripper-servo2, U-35, U-36), the
 * IR sensor between the jaws (ir-digital, U-37), the colour sensor on the I²C bus (tcs34725-wire, U-38, U-39) with a sensor and with
 * none, and every op of the kit at once. Their servo pulses are held to the gripper car's 6 µs (waveform-jitter).
 */
export const gripperDriverFixtures: readonly ParityFixture[] = [
  {
    // Claw on D9, lift on D10 (Timer1, one Servo frame for both): claw 0° and lift 90° from setup(), held 130 ms (the first pulse comes
    // 52.8 ms after attach(): servo-first-pulse), then close (80), down (0), the angles 45 and 30, a computed 120 clamped to 90 on the claw
    // and a typed-in -10 written 0 on the lift. The LED toggles before each pair: an exact event to time them from.
    name: 'driver-gripper',
    covers: ['U-35', 'U-36', 'U-24', 'U-18', 'U-03', 'U-05'],
    profile: 'uno-basic',
    kit: gripperKitRef,
    onStart: [
      wait(num(130)),
      led('ON'),
      claw('CLOSE'),
      lift('DOWN'),
      wait(num(80)),
      led('OFF'),
      clawAngle(num(45)),
      liftAngle(num(30)),
      wait(num(80)),
      led('ON'),
      setVar('x', add(num(120), num(0))),
      clawAngle(getVar('x')),
      liftAngle(num(-10)),
      wait(num(80)),
    ],
    variables: [['x', 'x']],
    origin: 'driver',
    durationMs: 380,
    inputs: {},
  },
  {
    // IR sensor on A3 (INPUT, activeLow): nothing until 15 ms, an object until 35 ms, nothing after; loop() lights the LED while it sees one.
    name: 'driver-ir',
    covers: ['U-37', 'U-24', 'U-02', 'U-11'],
    profile: 'uno-basic',
    kit: gripperKitRef,
    onStart: [],
    forever: [ifThen(irDetect(), [led('ON')], [led('OFF')])],
    variables: [],
    origin: 'driver',
    durationMs: 50,
    inputs: {
      levels: [
        { pin: 'A3', atUs: 0, level: 1 },
        { pin: 'A3', atUs: 15_000, level: 0 },
        { pin: 'A3', atUs: 35_000, level: 1 },
      ],
    },
  },
  {
    // TCS34725 at 0x29 on A4/A5 (Wire): colorBegin in setup() (its AEN byte 4362.25 µs into setup() on the simulator, 4367.375 on the
    // board: the second window ends at 109 962.25 / 109 967.375 µs); red light until the RGBC Init after the first window, white after it
    // (COLOR_LIGHT_SWITCH_US). A colorIs read placed so that the second window ends during its eight data bytes, after the first (C low,
    // which latches C high) and before the third (R low), on both sides (ADR 0004 §11 condition 3, G0.2 ruling c2): C from the red
    // window, R, G, B from the white one, which is no colour (C below white's 12000): unknown, where a read of the red window alone is red
    // and of the white one white. The board reaches the read about 116 µs before the simulator (its calls run faster than charged), so the
    // end falls after byte 0 on the simulator and before byte 2 on the board; COLOR_STRADDLE_NUDGE centres the two: the end is 34.875 µs
    // after C low (and 155 µs before R low) on the simulator, 155.8125 µs after C low and 34.25 µs before R low on the board (fix round
    // 1, I1; the parity test asserts both). Then every channel and two colours of the white window; the LED and the motors' stop at the end.
    name: 'driver-color',
    covers: ['U-38', 'U-39', 'U-15', 'U-11', 'U-03', 'U-18'],
    profile: 'uno-advanced',
    kit: gripperKitRef,
    onStart: [
      wait(num(COLOR_STRADDLE_WAIT_MS)),
      driveStop(),
      ...COLOR_STRADDLE_NUDGE,
      ifThen(colorIs('unknown'), [setVar('x', num(1))], [setVar('x', num(0))]),
      print(getVar('x')),
      print(colorRaw('clear')),
      print(colorRaw('red')),
      print(colorRaw('green')),
      print(colorRaw('blue')),
      print(colorIs('white')),
      print(colorIs('red')),
      led('ON'),
      driveStop(),
    ],
    variables: [['x', 'x']],
    origin: 'driver',
    durationMs: 160,
    inputs: { colors: { windows: [{ fromUs: 0, light: RED }, { fromUs: COLOR_LIGHT_SWITCH_US, light: WHITE }] } },
  },
  {
    // No device at 0x29: colorBegin's writes and every read are an address NACK and a STOP (their NACK times); every channel reads 0,
    // which is unknown and no other colour. The 3 ms Wire timeout never fires.
    name: 'driver-color-nack',
    covers: ['U-38', 'U-39', 'U-15', 'U-24'],
    profile: 'uno-advanced',
    kit: gripperKitRef,
    onStart: [print(colorRaw('clear')), print(colorRaw('blue')), print(colorIs('unknown')), print(colorIs('black')), led('ON'), wait(num(5))],
    variables: [],
    origin: 'driver',
    durationMs: 80,
    inputs: { colors: { absent: true, windows: [] } },
  },
  {
    // Every module of ref-uno-gripper@0 at once: the colour of a yellow object (the first window's) and its raw green; the left motor at
    // 30 % for 5 ms, then the drive forward at 50 %; the ultrasonic's echo of 10 cm, the center line sensor on the line (A1 HIGH), the left one's raw 300, the button held;
    // then, once both servos have shown three pulses of their start angles, the IR sensor sees an object (A3 LOW): the claw closes and
    // the arm goes to 60°; the drive stops and the LED lights.
    name: 'kit-gripper-all',
    covers: ['U-35', 'U-36', 'U-37', 'U-38', 'U-39', 'U-20', 'U-21', 'U-22', 'U-24', 'U-27', 'U-28', 'U-29', 'U-30', 'U-11', 'U-15', 'U-18'],
    profile: 'uno-advanced',
    kit: gripperKitRef,
    onStart: [
      print(colorIs('yellow')),
      print(colorRaw('green')),
      motorSet('motorLeft', num(30)),
      wait(num(5)),
      driveMove('forward', num(50)),
      print(ultrasonic()),
      print(lineDark('lineCenter')),
      print(lineRaw('lineLeft')),
      print(buttonPressed()),
      wait(num(45)),
      ifThen(irDetect(), [claw('CLOSE'), liftAngle(num(60))], [claw('OPEN')]),
      driveStop(),
      led('ON'),
      wait(num(70)),
    ],
    variables: [],
    origin: 'driver',
    durationMs: 200,
    inputs: {
      levels: [
        { pin: 'A1', atUs: 0, level: 1 },
        { pin: 'A3', atUs: 0, level: 0 },
        { pin: 'D3', atUs: 0, level: 0 },
      ],
      analog: [{ pins: ['A0'], values: [300] }],
      echoes: { trig: 'D12', echo: 'D11', readings: [echoOf(10)] },
      colors: { windows: [{ fromUs: 0, light: YELLOW }] },
    },
  },
];

export const parityFixtures: readonly ParityFixture[] = [...goldens, ...drivers, ...toneThenPin, ...language, ...gripperDriverFixtures];

/** A fixture's program, compiled as the robot lab compiles it (compileUnoProject against ref-uno-rover@0, or the fixture's kit). */
export function compileFixture(fixture: ParityFixture): SimProgram {
  if (fixture.kit === undefined) {
    return compileCase(fixture);
  }
  const document = unoDocument(fixture.profile, { program: { blocks: blocksOf(fixture) }, kit: { ...fixture.kit } });
  // A rehearsal kit's catalog for a rehearsal fixture, the production one for the gripper car's (N19 C2).
  const kits = rehearsalKits.get(fixture.kit) ? rehearsalKits : productionKits;
  const compiled = compileUnoProject(document, { registry, profiles: productionProfiles, packs, kits });
  if (!compiled.ok) {
    throw new Error(`${fixture.name} does not compile for ${kitKey(fixture.kit)}: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled;
}

/**
 * The inputs of a fixture of `from` on the pins of `to`, for the same world: each pin of a port goes to the pin of the same name of the same
 * port of `to`; a line sensor whose `activeLow` differs reads the other level (its pin, scripted in the fixture, also gets the other one of
 * its INPUT default, LOW, at 0 µs); ADC values and echoes stay what they are.
 */
export function inputsOnKit(inputs: ParityInputs, from: Kit, to: Kit): ParityInputs {
  const pinOf = new Map<string, string>();
  const inverted = new Set<string>();
  for (const port of from.ports) {
    const other = to.ports.find((candidate) => candidate.id === port.id && candidate.driver === port.driver);
    if (other === undefined) throw new Error(`${kitKey(to)} has no port ${port.id} driven by ${port.driver}`);
    for (const [name, pin] of Object.entries(port.pins)) {
      pinOf.set(pin, other.pins[name] as string);
      if (port.driver === 'line-digital' && portParam(port, 'activeLow') !== portParam(other, 'activeLow')) inverted.add(pin);
    }
  }
  const mapped = (pin: string) => pinOf.get(pin) ?? pin;
  const scripted = [...new Set((inputs.levels ?? []).map((change) => change.pin))].filter((pin) => inverted.has(pin));
  return {
    ...(inputs.levels === undefined
      ? {}
      : {
          levels: [
            ...scripted.map((pin) => ({ pin: mapped(pin), atUs: 0, level: 1 as const })),
            ...inputs.levels.map((change) => ({ pin: mapped(change.pin), atUs: change.atUs, level: inverted.has(change.pin) ? ((1 - change.level) as 0 | 1) : change.level })),
          ],
        }),
    ...(inputs.analog === undefined ? {} : { analog: inputs.analog.map((group) => ({ pins: group.pins.map(mapped), values: group.values })) }),
    ...(inputs.echoes === undefined ? {} : { echoes: { ...inputs.echoes, trig: mapped(inputs.echoes.trig), echo: mapped(inputs.echoes.echo) } }),
  };
}

/** N18 R8a: every driver fixture on rehearsal-rover@0, the same program and world, named `rehearsal-<name>`. */
export const rehearsalParityFixtures: readonly ParityFixture[] = drivers.map((fixture) => ({
  ...fixture,
  name: `rehearsal-${fixture.name}`,
  kit: rehearsalKitRef,
  inputs: inputsOnKit(fixture.inputs, productionKits.get(referenceKitRef) as Kit, rehearsalKit),
}));

/** The sketch the generator writes for a fixture (what build-parity-hex.mjs compiles). */
export function sketchOf(fixture: ParityFixture): string {
  const { ir, kit, board } = compileFixture(fixture);
  const generated = generateUnoSketch(ir, { kit, board });
  if (!generated.ok) {
    throw new Error(`${fixture.name}: the generator refuses it: ${JSON.stringify(generated.diagnostics)}`);
  }
  return generated.source;
}
