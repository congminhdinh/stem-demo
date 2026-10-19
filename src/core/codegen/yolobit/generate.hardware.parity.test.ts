import { describe, expect, it } from 'vitest';
import {
  clearDisplay, colour, getVar, images, num, playMelody, playNote, playPitch, print, program, randomInt, rest, runningTime, scrollNumber, scrollText,
  scrollTextIn, setPixel, setVar, showImage, text, wait, type ImageRows, type Json,
} from '../../program/__fixtures__/ybc-blocks';
import { charactersOf, scrollFrame } from '../../simulation/peripherals/display';
import { compileBlocks } from './__fixtures__/compile-case';
import { hardwareCases } from './__fixtures__/hardware-cases';
import { runUnderCpythonWithHardware, simulateWithHardware, type RunResult, type Script, type Timeline } from './__fixtures__/hardware-parity';
import { python } from './__fixtures__/python';
import { generateYbcMicroPython } from './generate';

// Simulator <-> generator parity for the onboard hardware (plan §1, §13.9, §18.3; contract §4–§8). The SAME IR is run by the
// interpreter (with capability fakes and a fake clock) and generated; the generated Python is then run by CPython with fake
// `time`, `yolobit` and `music` modules, and both record a timeline of [ms, event]: pictures, scrolls, notes, waits, prints
// and every scripted answer that was consumed. The two timelines must be equal. See `__fixtures__/hardware-parity.ts` for what
// the fakes are told by the contract. It checks that the generated program means what the simulator does; it is NOT a
// check on MicroPython or on a Yolo:Bit (plan §6.9).

const frame = (rows: ImageRows | readonly string[]) => `frame:${rows.join(':')}`;
const RING = frame(images.RING);
const CROSS = frame(images.CROSS);
const DOT = frame(images.DOT);
const FULL = frame(images.FULL);
const BLANK = frame(['00000', '00000', '00000', '00000', '00000']);

type Scenario = {
  name: string;
  blocks: Json;
  script?: Script;
  /** The texts the program scrolls, in order. */
  scrolls?: string[];
  /** How many 10 ms pauses of a forever the program may reach; the last one ends it. */
  passes?: number;
  /** The timeline, written out from the contract by hand, for the programs short enough to read. */
  timeline?: Timeline;
};

const caseBlocks = (name: string): Json => {
  const found = hardwareCases.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no hardware case ${name}`);
  }
  return found.blocks;
};

const noteTimeline: Timeline = [
  [0, 'note:C4:4'], [500, 'note:E4:4'], [1000, 'note:G4:4'], [1500, 'sleep:500'], [2000, 'note:C5:4'], [2500, 'end'],
];

const scenarios: Scenario[] = [
  {
    name: 'image-then-text',
    blocks: caseBlocks('image-then-text'),
    scrolls: ['Hi'],
    timeline: [[0, RING], [0, 'sleep:1000'], [1000, 'scroll:Hi'], [3400, 'end']],
  },
  {
    name: 'blink-image (one pass)',
    blocks: caseBlocks('blink-image'),
    timeline: [[0, DOT], [0, 'sleep:500'], [500, BLANK], [500, 'sleep:500'], [1000, 'end']],
  },
  {
    name: 'blink-image (two passes)',
    blocks: caseBlocks('blink-image'),
    passes: 2,
    timeline: [
      [0, DOT], [0, 'sleep:500'], [500, BLANK], [500, 'sleep:500'], [1000, 'sleep:10'],
      [1010, DOT], [1010, 'sleep:500'], [1510, BLANK], [1510, 'sleep:500'], [2010, 'end'],
    ],
  },
  {
    name: 'button-images (A held)',
    blocks: caseBlocks('button-images'),
    script: { 'a.pressed': [1], 'b.pressed': [1] },
    timeline: [[0, 'read:a.pressed=1'], [0, CROSS], [0, 'end']],
  },
  {
    name: 'button-images (only B held)',
    blocks: caseBlocks('button-images'),
    script: { 'a.pressed': [0], 'b.pressed': [1] },
    timeline: [[0, 'read:a.pressed=0'], [0, 'read:b.pressed=1'], [0, RING], [0, 'end']],
  },
  {
    name: 'button-images (none held)',
    blocks: caseBlocks('button-images'),
    script: { 'a.pressed': [0], 'b.pressed': [0] },
    timeline: [[0, 'read:a.pressed=0'], [0, 'read:b.pressed=0'], [0, 'end']],
  },
  {
    name: 'button-images (three passes: A, then B, then neither)',
    blocks: caseBlocks('button-images'),
    script: { 'a.pressed': [1, 0, 0], 'b.pressed': [1, 0] },
    passes: 3,
  },
  {
    name: 'press-counter',
    blocks: caseBlocks('press-counter'),
    script: { 'a.presses': [2, 0, 5] },
    passes: 3,
    timeline: [
      [0, 'read:a.presses=2'], [0, 'print:2'], [0, 'sleep:10'],
      [10, 'read:a.presses=0'], [10, 'print:2'], [10, 'sleep:10'],
      [20, 'read:a.presses=5'], [20, 'print:7'], [20, 'end'],
    ],
  },
  {
    name: 'night-light (dark, bright, just below 30)',
    blocks: caseBlocks('night-light'),
    script: { light: [10, 80, 29] },
    passes: 3,
    timeline: [
      [0, 'read:light=10'], [0, FULL], [0, 'sleep:10'],
      [10, 'read:light=80'], [10, BLANK], [10, 'sleep:10'],
      [20, 'read:light=29'], [20, FULL], [20, 'end'],
    ],
  },
  {
    name: 'night-light (30 is not below 30)',
    blocks: caseBlocks('night-light'),
    script: { light: [30] },
    timeline: [[0, 'read:light=30'], [0, BLANK], [0, 'end']],
  },
  { name: 'melody', blocks: caseBlocks('melody'), timeline: noteTimeline },
  { name: 'all-notes-and-lengths', blocks: caseBlocks('all-notes-and-lengths') },
  {
    name: 'alarm-both-modules (A held)',
    blocks: caseBlocks('alarm-both-modules'),
    script: { 'a.pressed': [1] },
    timeline: [[0, 'read:a.pressed=1'], [0, 'note:A4:2'], [250, FULL], [250, 'sleep:125'], [375, BLANK], [375, 'end']],
  },
  {
    name: 'alarm-both-modules (A not held)',
    blocks: caseBlocks('alarm-both-modules'),
    script: { 'a.pressed': [0] },
    timeline: [[0, 'read:a.pressed=0'], [0, 'end']],
  },
  {
    name: 'alarm-both-modules (two passes)',
    blocks: caseBlocks('alarm-both-modules'),
    script: { 'a.pressed': [1, 1] },
    passes: 2,
    timeline: [
      [0, 'read:a.pressed=1'], [0, 'note:A4:2'], [250, FULL], [250, 'sleep:125'], [375, BLANK], [375, 'sleep:10'],
      [385, 'read:a.pressed=1'], [385, 'note:A4:2'], [635, FULL], [635, 'sleep:125'], [760, BLANK], [760, 'end'],
    ],
  },
  {
    name: 'scroll-expressions',
    blocks: caseBlocks('scroll-expressions'),
    script: { light: [42] },
    scrolls: ['15', 'n=7', '-12'],
    timeline: [[0, 'scroll:15'], [2400, 'scroll:n=7'], [6000, 'scroll:-12'], [9600, 'read:light=42'], [9600, 'print:42'], [9600, 'end']],
  },
  {
    name: 'reads-short-circuit (every right side that is read)',
    blocks: caseBlocks('reads-short-circuit'),
    // a.presses is never asked for: `False and …` does not read it. Its answer stays in the script.
    script: { light: [50], 'b.pressed': [1], 'a.pressed': [0], 'b.presses': [1], 'a.presses': [9] },
    timeline: [
      [0, 'print:False'], [0, 'print:True'],
      [0, 'read:light=50'], [0, 'read:b.pressed=1'], [0, 'print:True'],
      [0, 'read:a.pressed=0'], [0, 'read:b.presses=1'], [0, 'print:True'],
      [0, 'end'],
    ],
  },
  {
    name: 'reads-short-circuit (the left side decides twice more)',
    blocks: caseBlocks('reads-short-circuit'),
    // light 5 is not above 10, so b.pressed is not read; a is held, so b.presses is not read.
    script: { light: [5], 'b.pressed': [1], 'a.pressed': [1], 'b.presses': [7], 'a.presses': [9] },
    timeline: [
      [0, 'print:False'], [0, 'print:True'],
      [0, 'read:light=5'], [0, 'print:False'],
      [0, 'read:a.pressed=1'], [0, 'print:True'],
      [0, 'end'],
    ],
  },
  {
    name: 'count-up-reads-bounds-once (presses 2, then 0: no iteration)',
    blocks: caseBlocks('count-up-reads-bounds-once'),
    script: { 'a.presses': [2, 0] },
    timeline: [[0, 'read:a.presses=2'], [0, 'read:a.presses=0'], [0, 'end']],
  },
  {
    name: 'count-up-reads-bounds-once (presses 1, then 3: 1, 2, 3)',
    blocks: caseBlocks('count-up-reads-bounds-once'),
    script: { 'a.presses': [1, 3] },
    timeline: [
      [0, 'read:a.presses=1'], [0, 'read:a.presses=3'], [0, 'print:1'], [0, 'print:2'], [0, 'print:3'], [0, 'end'],
    ],
  },
  {
    name: 'count-up-reads-bounds-once (presses 0, then 0: one iteration)',
    blocks: caseBlocks('count-up-reads-bounds-once'),
    script: { 'a.presses': [0, 0] },
    timeline: [[0, 'read:a.presses=0'], [0, 'read:a.presses=0'], [0, 'print:0'], [0, 'end']],
  },
  {
    name: 'scroll: one character, the empty text, a one-digit number and a text',
    blocks: program([scrollText(text('A')), scrollText(text('')), scrollNumber(num(7)), scrollText(text('Hi')), print(text('done'))]),
    scrolls: ['A', '', '7', 'Hi'],
    timeline: [[0, 'scroll:A'], [0, 'scroll:7'], [0, 'scroll:Hi'], [2400, 'print:done'], [2400, 'end']],
  },
  {
    name: 'a rest takes as long as a wait of the same length, and a note as long as its ticks',
    blocks: program([playNote('C4', 1), rest(1), wait(num(125)), rest(2), playNote('C3', 2), scrollNumber(num(100))]),
    scrolls: ['100'],
    timeline: [
      [0, 'note:C4:1'], [125, 'sleep:125'], [250, 'sleep:125'], [375, 'sleep:250'], [625, 'note:C3:2'], [875, 'scroll:100'], [4475, 'end'],
    ],
  },
  {
    // Only rests: the program needs the music module (and its tempo) for them as much as for notes.
    name: 'a program of only rests',
    blocks: program([rest(1), rest(2), rest(4)]),
    timeline: [[0, 'sleep:125'], [125, 'sleep:250'], [375, 'sleep:500'], [875, 'end']],
  },
  // N17 B1: the built-in pictures, the pixels, the fill and the colours, in the palette digits of the contract.
  {
    name: 'builtin-icons',
    blocks: caseBlocks('builtin-icons'),
    timeline: [
      [0, frame(['01010', '11111', '11111', '01110', '00100'])],
      [0, 'sleep:500'],
      [500, frame(['00100', '01110', '10101', '00100', '00100'])],
      [500, frame(['00000', '01010', '00000', '10001', '01110'])],
      [500, 'end'],
    ],
  },
  {
    name: 'pixels-and-colours',
    blocks: caseBlocks('pixels-and-colours'),
    scrolls: ['Hi', '42'],
    timeline: [
      [0, frame(['55555', '55555', '55555', '55555', '55555'])],
      [0, frame(['55555', '55555', '55555', '55455', '55555'])],
      [0, frame(['05555', '55555', '55555', '55455', '55555'])],
      [0, frame(['20002', '02020', '00200', '02020', '20002'])],
      [0, 'scroll:Hi@3'],
      [2400, 'scroll:42@8'],
      [4800, 'end'],
    ],
  },
  {
    name: 'pixel-walk',
    blocks: caseBlocks('pixel-walk'),
    timeline: [0, 1, 2, 3, 4].flatMap((x): Timeline => [
      [x * 100, frame(['00000', '00000', '0'.repeat(x) + '1' + '0'.repeat(4 - x), '00000', '00000'])],
      [x * 100, 'sleep:100'],
      [x * 100 + 100, BLANK],
    ]).concat([[500, 'end']]),
  },
  {
    name: 'a pixel on a picture, a still green character, then a clear',
    blocks: program([showImage(images.DOT), setPixel(num(4), num(0), colour('#ffa500')), scrollTextIn(text('A'), colour('#00ff00')), clearDisplay()]),
    scrolls: ['A'],
    timeline: [[0, DOT], [0, frame(['00002', '00000', '00100', '00000', '00000'])], [0, 'scroll:A@4'], [0, BLANK], [0, 'end']],
  },
  // N17 B2: the temperature (a float on the board, written int(temperature())), the accelerometer and the gestures. A gesture
  // answer is the index of the gesture the board makes in `gestureNames` (shake 0, tilt_left 1, tilt_right 2, face_up 3,
  // face_down 4, logo_up 5, logo_down 6), and each `is_gesture` asks once.
  {
    name: 'thermometer (31, then 30 twice, then −5 twice)',
    blocks: caseBlocks('thermometer'),
    script: { temperature: [31, 30, 30, -5, -5] },
    scrolls: ['30', '-5'],
    passes: 3,
    timeline: [
      [0, 'read:temperature=31'], [0, FULL], [0, 'sleep:10'],
      [10, 'read:temperature=30'], [10, 'read:temperature=30'], [10, 'scroll:30'], [2410, 'sleep:10'],
      [2420, 'read:temperature=-5'], [2420, 'read:temperature=-5'], [2420, 'scroll:-5'], [4820, 'end'],
    ],
  },
  {
    name: 'tilt-and-shake (shaken, then tilted left, then face up)',
    blocks: caseBlocks('tilt-and-shake'),
    script: { gesture: [0, 1, 1, 3, 3] },
    passes: 3,
    timeline: [
      [0, 'read:gesture=0'], [0, FULL], [0, 'sleep:10'],
      [10, 'read:gesture=1'], [10, 'read:gesture=1'], [10, CROSS], [10, 'sleep:10'],
      [20, 'read:gesture=3'], [20, 'read:gesture=3'], [20, BLANK], [20, 'end'],
    ],
  },
  {
    name: 'accelerometer-readings (tilted, face up, 35 °C)',
    blocks: caseBlocks('accelerometer-readings'),
    script: { 'accel.x': [-700], 'accel.y': [300], 'accel.z': [-685], gesture: [3, 3, 3, 3, 3], temperature: [35] },
    scrolls: ['25'],
    timeline: [
      [0, 'read:accel.x=-700'], [0, 'read:accel.y=300'], [0, 'read:accel.z=-685'], [0, 'print:-1085'],
      [0, 'read:gesture=3'], [0, 'print:False'], [0, 'read:gesture=3'], [0, 'print:True'], [0, 'read:gesture=3'], [0, 'print:False'],
      [0, 'read:gesture=3'], [0, 'print:False'], [0, 'read:gesture=3'], [0, 'print:False'],
      [0, 'read:temperature=35'], [0, 'scroll:25'], [2400, 'end'],
    ],
  },
  {
    name: 'accelerometer-readings (face down, logo up and down)',
    blocks: caseBlocks('accelerometer-readings'),
    script: { 'accel.x': [0], 'accel.y': [0], 'accel.z': [1024], gesture: [2, 4, 4, 5, 6], temperature: [-10] },
    scrolls: ['-20'],
  },
  // N17 B3: the built-in melodies, the tone and stop. A note of the contract for whole ticks is `note:`, any other tone `tone:<hz>:<ms>`.
  {
    // BIRTHDAY in the background while the heart shows, cut by stop at 1000 ms after C4 (3 ticks), C4 (1) and D4 (4); a tone of 440 Hz
    // that does not wait, cut at 1500 ms by POWER_UP, which waits: G4, C5, then E5 and G5 (not notes of the contract).
    name: 'melodies-and-tones',
    blocks: caseBlocks('melodies-and-tones'),
    timeline: [
      [0, frame(['01010', '11111', '11111', '01110', '00100'])],
      [0, 'note:C4:3'], [375, 'note:C4:1'], [500, 'note:D4:4'],
      [1000, 'note:A4:4'],
      [1500, 'note:G4:1'], [1625, 'note:C5:1'], [1750, 'tone:659:125'], [1875, 'tone:784:250'], [2125, 'tone:659:125'], [2250, 'tone:784:375'],
      [2625, 'end'],
    ],
  },
  {
    // Twenty melodies, each replacing the one before at once (none is heard), then stop; then a tone on each pass with A held, each
    // cut 10 ms later by the next pass's tone or by the end.
    name: 'every-melody (A held twice)',
    blocks: caseBlocks('every-melody'),
    script: { 'a.pressed': [1, 1, 0] },
    passes: 3,
    timeline: [[0, 'read:a.pressed=1'], [0, 'tone:200:10'], [10, 'read:a.pressed=1'], [10, 'tone:210:10'], [20, 'read:a.pressed=0'], [20, 'end']],
  },
  {
    name: 'a melody in the background cut in the middle of a note, another cut by a tone, the tone cut by a rest',
    blocks: program([
      playMelody('ODE', 'background'),
      wait(num(700)),
      playMelody('JUMP_UP', 'background'),
      wait(num(300)),
      playPitch(num(1000), num(400)),
      wait(num(100)),
      rest(1),
      print(text('done')),
    ]),
    timeline: [
      [0, 'note:E4:4'], [500, 'tone:330:200'], [700, 'note:C5:1'], [825, 'tone:587:125'], [950, 'tone:659:50'], [1000, 'tone:1000:100'],
      [1100, 'sleep:125'], [1225, 'print:done'], [1225, 'end'],
    ],
  },
  {
    name: 'DADADADUM until done: its rests are time passing, its notes are notes',
    blocks: program([playMelody('DADADADUM', 'wait'), print(text('after'))]),
    timeline: [
      [0, 'sleep:250'], [250, 'note:G4:2'], [500, 'note:G4:2'], [750, 'note:G4:2'], [1000, 'tone:311:1000'],
      [2000, 'sleep:250'], [2250, 'note:F4:2'], [2500, 'note:F4:2'], [2750, 'note:F4:2'], [3000, 'note:D4:8'],
      [4000, 'print:after'], [4000, 'end'],
    ],
  },
  {
    // (3, 1) is column 3 of row 1 (EVD-06), and an L shows that rows and columns are not turned the wrong way round.
    name: 'pictures keep their rows and columns: a pixel at (3, 1), an L, a full frame, a clear',
    blocks: program([
      showImage(['00000', '00010', '00000', '00000', '00000']),
      showImage(['10000', '10000', '10000', '10000', '11111']),
      showImage(images.FULL),
      clearDisplay(),
    ]),
    timeline: [
      [0, frame(['00000', '00010', '00000', '00000', '00000'])],
      [0, frame(['10000', '10000', '10000', '10000', '11111'])],
      [0, FULL],
      [0, BLANK],
      [0, 'end'],
    ],
  },
  // N17 B4: A+B reads A first and B only when A is held (the `and` short-circuits, on both sides); the running time is the clock
  // since the program started, on both sides; a random number is a scripted answer, drawn over the same ends, low first.
  {
    name: 'both-buttons-and-running-time (A+B, then only A, then A+B again)',
    blocks: caseBlocks('both-buttons-and-running-time'),
    script: { 'a.pressed': [1, 1, 1, 1], 'b.pressed': [1, 0, 1] },
    passes: 3,
    timeline: [
      [0, 'read:a.pressed=1'], [0, 'read:b.pressed=1'], [0, FULL], [0, 'print:0'], [0, 'sleep:10'],
      [10, 'read:a.pressed=1'], [10, 'read:b.pressed=0'], [10, 'read:a.pressed=1'], [10, CROSS], [10, 'sleep:10'],
      [20, 'read:a.pressed=1'], [20, 'read:b.pressed=1'], [20, FULL], [20, 'print:20'], [20, 'end'],
    ],
  },
  {
    name: 'both-buttons-and-running-time (none held: B is never asked)',
    blocks: caseBlocks('both-buttons-and-running-time'),
    script: { 'a.pressed': [0, 0] },
    timeline: [[0, 'read:a.pressed=0'], [0, 'read:a.pressed=0'], [0, BLANK], [0, 'end']],
  },
  {
    name: 'dice (A held once)',
    blocks: caseBlocks('dice'),
    script: { random: [3, 7, 5], 'a.pressed': [1, 0] },
    scrolls: ['5'],
    passes: 2,
    timeline: [
      [0, 'random:1..6=3'], [0, 'random:3..10=7'], [0, 'print:7'],
      [0, 'read:a.pressed=1'], [0, 'random:1..6=5'], [0, 'scroll:5'], [0, 'sleep:500'], [500, 'sleep:10'],
      [510, 'read:a.pressed=0'], [510, 'end'],
    ],
  },
  {
    name: 'a random number between two computed ends given high first: min and max make it low first on the board too',
    blocks: program([setVar('x', num(9)), setVar('y', num(2)), print(randomInt(getVar('x'), getVar('y'))), print(runningTime())]),
    script: { random: [4] },
    timeline: [[0, 'random:2..9=4'], [0, 'print:4'], [0, 'print:0'], [0, 'end']],
  },
];

const scenarioNamed = (name: string): Scenario => {
  const found = scenarios.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no scenario ${name}`);
  }
  return found;
};
const irOf = (scenario: Scenario) => compileBlocks(scenario.blocks);
const sourceOf = (scenario: Scenario): string => {
  const generated = generateYbcMicroPython(irOf(scenario));
  if (!generated.ok) {
    throw new Error(`${scenario.name}: ${JSON.stringify(generated.diagnostics)}`);
  }
  return generated.source;
};

describe.skipIf(python === null)('the generated Python takes the time and shows what the simulator does (CPython, fake time, yolobit and music)', () => {
  const run = (cases: Record<string, { source: string; script: Script; passes: number }>): Record<string, RunResult> =>
    python ? runUnderCpythonWithHardware(cases) : {};
  const results = run(
    Object.fromEntries(scenarios.map((scenario) => [scenario.name, { source: sourceOf(scenario), script: scenario.script ?? {}, passes: scenario.passes ?? 1 }])),
  );

  it('runs every scenario without a Python error', () => {
    expect(Object.values(results).map((result) => result.error)).toEqual(scenarios.map(() => null));
    expect(Object.keys(results)).toHaveLength(scenarios.length);
  });

  it('uses the cases of the goldens: every hardware case is a scenario here', () => {
    for (const { name } of hardwareCases) {
      expect(scenarios.some((scenario) => scenario.blocks === caseBlocks(name)), name).toBe(true);
    }
  });

  it.each(scenarios)('$name: the timeline of the simulator is the timeline of the Python', async (scenario) => {
    const generated = results[scenario.name];
    const simulated = await simulateWithHardware(irOf(scenario), scenario.script ?? {}, scenario.scrolls ?? [], scenario.passes ?? 1);
    expect(generated?.error).toBeNull();
    expect(simulated.problems).toEqual([]);
    expect(simulated.events).toEqual(generated?.events);
    // The answers left in the script are the same: a read that one side skipped (short-circuit) the other skipped too.
    expect(simulated.left).toEqual(generated?.left);
    if (scenario.timeline) {
      expect(generated?.events).toEqual(scenario.timeline);
    }
    expect(generated?.events.at(-1)?.[1]).toBe('end');
  });

  it('plays the whole table: 15 notes in order with the cycle of lengths 1, 2, 4, then three rests, 42 ticks of 125 ms', async () => {
    const scenario = scenarioNamed('all-notes-and-lengths');
    const events = results['all-notes-and-lengths']?.events ?? [];
    const notes = events.filter(([, event]) => event.startsWith('note:')).map(([, event]) => event);
    expect(notes).toEqual(
      ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map((note, index) => `note:${note}:${[1, 2, 4][index % 3]}`),
    );
    expect(events.filter(([, event]) => event.startsWith('sleep:')).map(([, event]) => event)).toEqual(['sleep:125', 'sleep:250', 'sleep:500']);
    expect(events.at(-1)).toEqual([42 * 125, 'end']);
    const simulated = await simulateWithHardware(irOf(scenario), {}, []);
    expect(simulated.events).toEqual(events);
  });

  it('is paced by the tempo the generator sets: without music.set_tempo(4, 120) every note is twice as long (the default is (4, 60))', async () => {
    const melody = scenarioNamed('melody');
    const original = sourceOf(melody);
    expect(original).toContain('music.set_tempo(4, 120)\n');
    const slow = run({
      withTempo: { source: original, script: {}, passes: 1 },
      withoutTempo: { source: original.replace('music.set_tempo(4, 120)\n', ''), script: {}, passes: 1 },
    });
    expect(slow['withTempo']?.events).toEqual(noteTimeline);
    expect(slow['withoutTempo']?.events.at(-1)).toEqual([5000, 'end']);
    expect(slow['withoutTempo']?.events).not.toEqual(noteTimeline);
    // And the simulator does not agree with the program that forgot it.
    const simulated = await simulateWithHardware(irOf(melody), {}, []);
    expect(simulated.events).toEqual(noteTimeline);
    expect(simulated.events).not.toEqual(slow['withoutTempo']?.events);
  });

  it('would notice a program that differs from the simulator: a note one length too short, a picture turned, a wrong text', async () => {
    const mutations: [name: string, scenario: string, from: string, to: string][] = [
      ['a shorter note', 'melody', "'E4:4'", "'E4:2'"],
      ['another note', 'melody', "'G4:4'", "'A4:4'"],
      ['a shorter rest', 'melody', "'R:4'", "'R:2'"],
      ['a picture turned', 'image-then-text', '11111:10001:10001:10001:11111', '11111:10001:10001:10001:11110'],
      ['a text with another length', 'image-then-text', "scroll('Hi')", "scroll('Hii')"],
      ['a wait that is too short', 'image-then-text', 'time.sleep_ms(1000)', 'time.sleep_ms(999)'],
      // N17 B1.
      ['another built-in picture', 'builtin-icons', 'Image.HEART', 'Image.SAD'],
      ['a pixel in another colour', 'pixels-and-colours', "set_pixel(2, 3, '#00ff00')", "set_pixel(2, 3, '#0000ff')"],
      ['a pixel at another place', 'pixels-and-colours', 'set_pixel(2, 3,', 'set_pixel(3, 2,'],
      ['a picture in another colour', 'pixels-and-colours', '20002:02020:00200:02020:20002', '30003:03030:00300:03030:30003'],
      ['a scroll in red', 'pixels-and-colours', ", color='#ffff00'", ''],
      // N17 B3.
      ['another melody', 'melodies-and-tones', 'music.BIRTHDAY', 'music.ODE'],
      ['a melody that waits instead', 'melodies-and-tones', 'music.play(music.BIRTHDAY, wait=False)', 'music.play(music.BIRTHDAY, wait=True)'],
      ['a melody in the background instead', 'melodies-and-tones', 'music.play(music.POWER_UP, wait=True)', 'music.play(music.POWER_UP, wait=False)'],
      ['a shorter tone', 'melodies-and-tones', 'music.pitch(440, 500)', 'music.pitch(440, 400)'],
      ['another tone', 'melodies-and-tones', 'music.pitch(440, 500)', 'music.pitch(392, 500)'],
      ['a stop sooner', 'melodies-and-tones', 'time.sleep_ms(1000)\nmusic.stop()', 'time.sleep_ms(400)\nmusic.stop()\ntime.sleep_ms(600)'],
    ];
    for (const [label, name, from, to] of mutations) {
      const scenario = scenarioNamed(name);
      const original = sourceOf(scenario);
      expect(original, label).toContain(from);
      const mutated = run({ mutated: { source: original.replace(from, to), script: {}, passes: 1 } })['mutated'];
      const simulated = await simulateWithHardware(irOf(scenario), {}, scenario.scrolls ?? []);
      expect(simulated.problems, label).toEqual([]);
      expect(mutated?.error, label).toBeNull();
      expect(mutated?.events, label).not.toEqual(simulated.events);
    }
  });
});

describe.skipIf(python === null)('the sensors of N17 B2 in the Python: what the simulator would not notice by itself', () => {
  it('would notice another gesture, another axis or another threshold than the simulator’s', async () => {
    const mutations: [label: string, scenario: string, from: string, to: string][] = [
      ['another gesture', 'tilt-and-shake (shaken, then tilted left, then face up)', 'is_gesture("tilt_left")', 'is_gesture("tilt_right")'],
      ['another axis', 'accelerometer-readings (tilted, face up, 35 °C)', 'y = accelerometer.get_y()', 'y = accelerometer.get_x()'],
      ['another threshold', 'thermometer (31, then 30 twice, then −5 twice)', '> 30', '>= 30'],
    ];
    for (const [label, name, from, to] of mutations) {
      const scenario = scenarioNamed(name);
      const original = sourceOf(scenario);
      expect(original, label).toContain(from);
      const script = scenario.script ?? {};
      const mutated = python ? runUnderCpythonWithHardware({ mutated: { source: original.replace(from, to), script, passes: scenario.passes ?? 1 } })['mutated'] : undefined;
      const simulated = await simulateWithHardware(irOf(scenario), script, scenario.scrolls ?? [], scenario.passes ?? 1);
      expect(simulated.problems, label).toEqual([]);
      expect(mutated?.events, label).not.toEqual(simulated.events);
    }
  });

  it('gives temperature() as a float, as the simulator printed it (EVD-10): without int() the scroll is refused, with it the reading scrolls', () => {
    const header = 'import time\nfrom yolobit import *\n';
    const results = python
      ? runUnderCpythonWithHardware({
          bare: { source: `${header}display.scroll(temperature())\ntime.sleep_ms(10)\n`, script: { temperature: [25] }, passes: 1 },
          wrapped: { source: `${header}display.scroll(int(temperature()))\ntime.sleep_ms(10)\n`, script: { temperature: [25] }, passes: 1 },
        })
      : {};
    expect(results['bare']?.error).toMatch(/scroll needs a text or an int/);
    expect(results['wrapped']?.events).toEqual([[0, 'read:temperature=25'], [0, 'scroll:25'], [2400, 'end']]);
  });

  it.each([
    ['a gesture the block does not offer', 'accelerometer.is_gesture("freefall")'],
    ['a gesture written with a space', 'accelerometer.is_gesture("tilt left")'],
    ['an axis that is not there', 'accelerometer.get_w()'],
  ])('refuses %s', (_label, body) => {
    const header = 'import time\nfrom yolobit import *\n';
    const result = python ? runUnderCpythonWithHardware({ attempt: { source: `${header}${body}\ntime.sleep_ms(10)\n`, script: { gesture: [0] }, passes: 1 } })['attempt'] : undefined;
    expect(result?.error).not.toBeNull();
  });
});

describe.skipIf(python === null)('A+B, the running time and random numbers of N17 B4 in the Python', () => {
  it('would notice A or B instead of A+B, a running time taken at another moment, and the ends of a random number not swapped', async () => {
    const mutations: [label: string, scenario: string, from: string, to: string][] = [
      ['A or B', 'both-buttons-and-running-time (A+B, then only A, then A+B again)', 'button_a.is_pressed() and button_b.is_pressed()', 'button_a.is_pressed() or button_b.is_pressed()'],
      ['the running time of another moment', 'both-buttons-and-running-time (A+B, then only A, then A+B again)', 'print(running_time() - x)', 'print(running_time() - x - 10)'],
      ['another range', 'dice (A held once)', 'random.randint(1, 6))', 'random.randint(1, 5))'],
      ['the computed ends not swapped', 'a random number between two computed ends given high first: min and max make it low first on the board too', 'random.randint(min(x, y), max(x, y))', 'random.randint(x, y)'],
    ];
    for (const [label, name, from, to] of mutations) {
      const scenario = scenarioNamed(name);
      const original = sourceOf(scenario);
      expect(original, label).toContain(from);
      const script = scenario.script ?? {};
      const mutated = python ? runUnderCpythonWithHardware({ mutated: { source: original.replace(from, to), script, passes: scenario.passes ?? 1 } })['mutated'] : undefined;
      const simulated = await simulateWithHardware(irOf(scenario), script, scenario.scrolls ?? [], scenario.passes ?? 1);
      expect(simulated.problems, label).toEqual([]);
      expect([mutated?.error ?? null, mutated?.events], label).not.toEqual([null, simulated.events]);
    }
  });

  it.each([
    ['random.randint with the ends the other way round, as the board refuses it', 'x = random.randint(6, 1)', /ValueError/],
    ['random.randint of a text', "x = random.randint('1', 6)", /whole numbers/],
  ])('refuses %s', (_label, body, error) => {
    const result = python
      ? runUnderCpythonWithHardware({ attempt: { source: `import time\nimport random\n${body}\ntime.sleep_ms(10)\n`, script: { random: [1] }, passes: 1 } })['attempt']
      : undefined;
    expect(result?.error).toMatch(error);
  });

  it('gives the running time of the fake clock: 0 at the start, then what the program waited', () => {
    const source = 'import time\nfrom yolobit import *\nprint(running_time())\ntime.sleep_ms(250)\nprint(running_time())\ntime.sleep_ms(10)\n';
    const result = python ? runUnderCpythonWithHardware({ clock: { source, script: {}, passes: 1 } })['clock'] : undefined;
    expect(result?.events).toEqual([[0, 'print:0'], [0, 'sleep:250'], [250, 'print:250'], [250, 'end']]);
  });
});

describe.skipIf(python === null)('the fake modules enforce the forms the contract writes (so a pass is not the fakes being lenient)', () => {
  const header = 'import time\nfrom yolobit import *\nbutton_a.on_pressed = None\nbutton_b.on_pressed = None\nbutton_a.on_pressed_ab = button_b.on_pressed_ab = -1\nimport music\n';
  const attempt = (body: string) => {
    const result = python ? runUnderCpythonWithHardware({ attempt: { source: `${header}${body}\ntime.sleep_ms(10)\n`, script: {}, passes: 1 } })['attempt'] : undefined;
    return result;
  };

  it('moves the clock by 1200 ms per character for two characters or more, and not for one or none (contract §4.2)', () => {
    expect(attempt("display.scroll('Hi')\ndisplay.scroll('H')\ndisplay.scroll(100)\ndisplay.scroll('')\ndisplay.scroll(-7)")?.events).toEqual([
      [0, 'scroll:Hi'], [2400, 'scroll:H'], [2400, 'scroll:100'], [6000, 'scroll:-7'], [8400, 'end'],
    ]);
  });

  it('takes ticks × 60000 / (bpm × ticks per beat): (4, 60) by default, then what set_tempo says', () => {
    expect(attempt("music.play(['C4:4'], wait=True)\nmusic.set_tempo(4, 120)\nmusic.play(['C4:4', 'R:2'], wait=True)")?.events).toEqual([
      [0, 'note:C4:4'], [1000, 'note:C4:4'], [1500, 'sleep:250'], [1750, 'end'],
    ]);
  });

  it.each([
    ['music.play without wait=True', "music.play(['C4:4'])"],
    ['music.play with wait=False', "music.play(['C4:4'], wait=False)"],
    ['music.play of a text, not a list', "music.play('C4:4', wait=True)"],
    ['a picture that is not 5 rows of 5 digits', 'display.show(Image("90000:00000:00000:00000:00000"))'],
    ['a pixel in a colour name', "display.set_pixel(0, 0, 'red')"],
    ['a pixel in an upper-case code (the generator writes lower case)', "display.set_pixel(0, 0, '#FF0000')"],
    ['a pixel outside the display', "display.set_pixel(5, 0, '#ff0000')"],
    ['a fill in a colour off the palette', "display.set_all('#123456')"],
    ['a scroll in a colour name', "display.scroll('Hi', color='red')"],
    ['a picture name the block does not offer', 'display.show(Image.SMILE)'],
    ['a picture with 4 rows', 'display.show(Image("00000:00000:00000:00000"))'],
    ['display.show of something that is not an Image', "display.show('00000:00000:00000:00000:00000')"],
    ['display.scroll of a list', 'display.scroll([1])'],
    ['a button that is not there', 'button_c.is_pressed()'],
    ['an API that is not in the module (display.set_brightness, C-11)', 'display.set_brightness(5)'],
    ['an unscripted read', 'light_level()'],
    // N17 B3.
    ['a melody without wait written out', 'music.play(music.ODE)'],
    ['a melody the module does not have', 'music.play(music.GREENSLEEVES, wait=False)'],
    ['a pitch of a text', "music.pitch('440', 500)"],
  ])('refuses %s', (_label, body) => {
    expect(attempt(body)?.error).not.toBeNull();
  });

  it('reads a melody with a reader of its own: JUMP_UP until done, then BA_DING in the background, cut by stop (N17 B3)', () => {
    expect(attempt('music.set_tempo(4, 120)\nmusic.play(music.JUMP_UP, wait=True)\nmusic.play(music.BA_DING, wait=False)\ntime.sleep_ms(200)\nmusic.stop()')?.events).toEqual([
      [0, 'note:C5:1'], [125, 'tone:587:125'], [250, 'tone:659:125'], [375, 'tone:698:125'], [500, 'tone:784:125'],
      [625, 'tone:988:125'], [750, 'tone:1319:75'], [825, 'end'],
    ]);
  });

  it('lets the preamble of IM-2 run, and the program that follows it', () => {
    expect(attempt('display.clear()')?.error).toBeNull();
  });
});

describe('the simulator shows a scroll the way the contract states it, and it matches the 1200 ms × n of the Python', () => {
  const scrollOf = async (message: string) => {
    const blocks = program([scrollText(text(message))]);
    const simulated = await simulateWithHardware(compileBlocks(blocks), {}, [message]);
    return simulated;
  };

  it.each([['Hi'], ['ABC'], ['n=7'], ['Hello, world!']])('"%s": column k at t = 200 k for k = 0 … 6n − 1, then a blank frame at 1200 n', async (message) => {
    const simulated = await scrollOf(message);
    const characters = charactersOf(message);
    const n = characters.length;
    expect(simulated.problems).toEqual([]);
    expect(simulated.frames).toHaveLength(6 * n + 1);
    for (let k = 0; k < 6 * n; k += 1) {
      expect(simulated.frames[k]?.[0], `time of column ${k}`).toBe(k * 200);
      expect(simulated.frames[k]?.[1], `column ${k}`).toEqual(scrollFrame(characters, k));
    }
    expect(simulated.frames[6 * n]?.[0]).toBe(1200 * n);
    expect(simulated.frames[6 * n]?.[1].pixels.every((pixel) => pixel === null)).toBe(true);
    // One event, and the program ends after the 1200 ms × n that the fake Python advances by.
    expect(simulated.events).toEqual([[0, `scroll:${message}`], [1200 * n, 'end']]);
  });

  it.skipIf(python === null)('"Hi", "ABC" and a number: the Python advances by the same 1200 ms × n and ends at the same time', async () => {
    const scenarios2: [string, Json, string[]][] = [
      ['Hi', program([scrollText(text('Hi'))]), ['Hi']],
      ['ABC', program([scrollText(text('ABC'))]), ['ABC']],
      ['-12', program([scrollNumber(num(-12))]), ['-12']],
    ];
    const results = python
      ? runUnderCpythonWithHardware(
          Object.fromEntries(
            scenarios2.map(([name, blocks]) => {
              const generated = generateYbcMicroPython(compileBlocks(blocks));
              if (!generated.ok) {
                throw new Error(JSON.stringify(generated.diagnostics));
              }
              return [name, { source: generated.source, script: {}, passes: 1 }];
            }),
          ),
        )
      : {};
    for (const [name, blocks, scrolls] of scenarios2) {
      const simulated = await simulateWithHardware(compileBlocks(blocks), {}, scrolls);
      expect(results[name]?.events, name).toEqual(simulated.events);
      expect(results[name]?.events.at(-1), name).toEqual([1200 * (scrolls[0]?.length ?? 0), 'end']);
    }
  });

  it('would notice a column in the wrong place: a scroll that skips a column is a problem', async () => {
    const ir = compileBlocks(program([scrollText(text('Hi'))]));
    const skipping = await simulateWithHardware(ir, {}, ['Ho']);
    expect(skipping.problems.length).toBeGreaterThan(0);
  });
});
