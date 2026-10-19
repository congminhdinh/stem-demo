import { describe, expect, it } from 'vitest';
import {
  clearDisplay, colour, images, num, playNote, print, program, rest, scrollNumber, scrollText, scrollTextIn, setPixel, showImage, text, wait,
  type ImageRows, type Json,
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
  ])('refuses %s', (_label, body) => {
    expect(attempt(body)?.error).not.toBeNull();
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
