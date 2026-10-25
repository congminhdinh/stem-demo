import { compileCase, sketchCases, type SketchCase } from '../../src/core/codegen/arduino/__fixtures__/sketch-cases';
import { generateUnoSketch } from '../../src/core/codegen/arduino/generate';
import {
  buttonPressed, buzzerStop, buzzerTone, driveMove, driveStop, led, lineDark, lineRaw, motorSet, servoSet, ultrasonic,
} from '../../src/core/program/__fixtures__/uno-blocks';
import { ifThen, num, print, wait } from '../../src/core/program/__fixtures__/ybc-blocks';
import type { ParityInputs } from './inputs';
import type { SimProgram } from './sim-run';

// The parity fixtures (N18 C2, controller ruling): every C1 language golden (the sketch cases that end on their own and print what
// the contract's arithmetic says, codegen/arduino/__fixtures__/sketch-cases.ts) and one fixture per driver op of ref-uno-rover@0:
// motor PWM and direction (with the drive), servo, ultrasonic with a scripted echo, line (dark and raw), LED, button with a scripted
// press, buzzer tone and stop. Each runs for `durationMs` of virtual time on both sides with the same scripted `inputs`.
//
// Short on purpose (ADR 0003 §7: avr8js runs about 6× realtime): the whole suite is a few seconds of virtual time. Waveforms last
// at least a few of their periods, so the board shows them (board-trace.ts), and echoes sit near the top of a 58 µs centimetre,
// so the board's short pulseIn (allowed difference `pulsein-short`) reads the same centimetre as the simulator.
//
// `pnpm build:parity-hex` (scripts/build-parity-hex.mjs) compiles each fixture's sketch into tests/__parity__/<name>.hex and writes
// the sha256 of the sketch next to it; tests/uno-emulator-parity.test.ts refuses a HEX whose sketch the generator no longer writes.

export type ParityFixture = Pick<SketchCase, 'name' | 'covers' | 'profile' | 'onStart' | 'forever' | 'variables'> & {
  /** `golden`: a C1 language golden, as sketch-cases.ts has it; `driver`: a driver op of the reference kit. */
  readonly origin: 'golden' | 'driver';
  readonly durationMs: number;
  readonly inputs: ParityInputs;
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
};

const goldens: ParityFixture[] = sketchCases
  .filter((sketchCase) => sketchCase.console !== undefined)
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

export const parityFixtures: readonly ParityFixture[] = [...goldens, ...drivers];

/** A fixture's program, compiled as the robot lab compiles it (compileUnoProject against ref-uno-rover@0). */
export const compileFixture = (fixture: ParityFixture): SimProgram => compileCase(fixture);

/** The sketch the generator writes for a fixture (what build-parity-hex.mjs compiles). */
export function sketchOf(fixture: ParityFixture): string {
  const { ir, kit, board } = compileFixture(fixture);
  const generated = generateUnoSketch(ir, { kit, board });
  if (!generated.ok) {
    throw new Error(`${fixture.name}: the generator refuses it: ${JSON.stringify(generated.diagnostics)}`);
  }
  return generated.source;
}
