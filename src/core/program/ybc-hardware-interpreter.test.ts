import { describe, expect, it } from 'vitest';
import { blankFrame, type Frame } from '../capabilities/frame';
import type { ButtonId, Capabilities } from '../capabilities/io';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { imageFrame, scrollFrame } from '../simulation/peripherals/display';
import {
  and, bool, buttonPressed, buttonPresses, clearDisplay, countUp, getVar, images, join, lightLevel, num, or, playNote, print,
  program, repeat, rest, scrollNumber, scrollText, setVar, showImage, text, wait, whileLoop, add, ifThen, type ImageRows, type Json,
} from './__fixtures__/ybc-blocks';
import { runYbc } from './__fixtures__/run-ybc';
import { createBlockPackCatalog } from './block-packs';
import { compileYbcProgram } from './compile-ybc-program';
import { timerSleep, type Sleep } from './interpreter';
import type { YbcRunOutcome } from './ybc-interpreter';
import type { Expr, YbcProgramIR, YbcStatement } from './ybc-ir';

// The interpreter against the hardware contract (YB-3, contract §4–§8, plan §9.3, §18.3): compile real block JSON, run it
// with fake capabilities and a fake clock that only the program's own sleeps advance, and read what each capability was
// asked and WHEN. Nothing here uses the real peripherals (those are tested apart); the timings below are the contract's:
// a scrolling text is 1200 ms per character (200 ms per column, 6 columns per character), a note is 125 ms per tick.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const exposed = packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []);
const prog = (statements: Json[], forever?: Json[]) => program(statements, forever, ['x', 'y', 'z', 'i']);

/** Contract §8.1 (EVD-21): the frequency of the 15 natural notes C3…C5, as the contract writes them (not read back from the code). */
const contractHz: Record<string, number> = {
  C3: 131, D3: 147, E3: 165, F3: 175, G3: 196, A3: 220, B3: 247, C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523,
};
/** Contract C-50: IM-4 fixes the tempo to (4, 120), so one tick lasts 125 ms. */
const TICK_MS = 125;
/** Contract §4.2: one column every 200 ms, 6 columns per character. */
const COLUMN_MS = 200;
const SCROLL_MS_PER_CHARACTER = 1200;

/** A picture from five rows of digits, written independently of `imageFrame`: red where the digit is 1. */
const redFrame = (rows: readonly string[]): Frame => ({ pixels: [...rows.join('')].map((digit) => (digit === '1' ? '#FF0000' : null)) });
const glyphs = (text: string) => [...text];

type Entry = [at: number, what: string];
type Answers = { pressed?: Partial<Record<ButtonId, unknown[]>>; presses?: Partial<Record<ButtonId, unknown[]>>; light?: unknown[] };

type WorldOptions = {
  /** Every sleep waits for Stop. */
  blocking?: boolean;
  /** Stop is pressed inside the n-th sleep. */
  stopAtSleep?: number;
  /** Stop is pressed inside the n-th frame. */
  stopAtFrame?: number;
  /** Stop is pressed as a tone starts. */
  stopAtTone?: boolean;
  /** A pause that never looks at Stop: only the budget of the interpreter can notice it. */
  deaf?: boolean;
  /** A timer that wakes up late: the n-th sleep (counting from 1) lasts this many ms longer than asked. */
  late?: (n: number) => number;
};

/**
 * One run's world: fake capabilities that log every call with the fake time, answers read from a script, and a `sleep` that moves
 * the clock instead of waiting.
 */
function createWorld(answers: Answers = {}, options: WorldOptions = {}) {
  let now = 0;
  const log: Entry[] = [];
  const frames: [at: number, frame: Frame][] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  const queues = {
    pressed: { a: [...(answers.pressed?.a ?? [])], b: [...(answers.pressed?.b ?? [])] },
    presses: { a: [...(answers.presses?.a ?? [])], b: [...(answers.presses?.b ?? [])] },
    light: [...(answers.light ?? [])],
  };
  const note = (what: string) => log.push([now, what]);
  const next = (queue: unknown[], what: string): unknown => {
    if (queue.length === 0) {
      throw new Error(`unscripted read: ${what}`);
    }
    return queue.shift();
  };
  let stopRun: () => void = () => {};

  const capabilities: Capabilities = {
    display: {
      setFrame(frame) {
        frames.push([now, frame]);
        note('frame');
        if (frames.length === options.stopAtFrame) {
          stopRun();
        }
      },
    },
    buttons: {
      isPressed(id) {
        note(`pressed ${id}`);
        return next(queues.pressed[id], `pressed ${id}`) as boolean;
      },
      takePresses(id) {
        note(`presses ${id}`);
        return next(queues.presses[id], `presses ${id}`) as number;
      },
    },
    light: {
      lightLevel() {
        note('light');
        return next(queues.light, 'light') as number;
      },
    },
    sound: {
      startTone(hz) {
        note(`start ${hz}`);
        if (options.stopAtTone) {
          stopRun();
        }
      },
      stopTone() {
        note('stop');
      },
    },
  };

  const sleep: Sleep = (ms, signal) => {
    sleeps.push(ms);
    note(`sleep ${ms}`);
    if (options.deaf) {
      // A pause that never notices Stop: the next step of the budget has to.
      now += ms;
      return Promise.resolve();
    }
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    const stopsHere = sleeps.length === options.stopAtSleep;
    if (options.blocking || stopsHere) {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        if (stopsHere) {
          stopRun();
        }
      });
    }
    now += ms + (options.late?.(sleeps.length) ?? 0);
    return Promise.resolve();
  };

  return {
    capabilities,
    log,
    frames,
    sleeps,
    lines,
    now: () => now,
    sleep,
    sink: {
      write(line: string) {
        lines.push(line);
        note(`print ${line}`);
      },
    },
    attach(running: { stop(): void }) {
      stopRun = () => running.stop();
    },
    /** What the script still holds: a read that was not made leaves its answer here. */
    unread: () => ({ pressed: queues.pressed, presses: queues.presses, light: queues.light }),
  };
}

type World = ReturnType<typeof createWorld>;

function compile(blocks: Json): YbcProgramIR {
  const compiled = compileYbcProgram(blocks, exposed);
  if (!compiled.ok) {
    throw new Error(`Does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return compiled.ir;
}

function start(ir: YbcProgramIR, world: World, capabilities: Capabilities = world.capabilities) {
  const running = runYbc(ir, { sleep: world.sleep, console: world.sink, now: world.now }, capabilities);
  world.attach(running);
  return running;
}

/** Runs the program to its end (the fake sleeps do not wait) and says how it ended. */
async function run(blocks: Json, answers: Answers = {}, options: Parameters<typeof createWorld>[1] = {}) {
  const world = createWorld(answers, options);
  const running = start(compile(blocks), world);
  const outcome = await running.done;
  return { world, outcome };
}

/** The log without the time, for the tests that care about order only. */
const calls = (world: World) => world.log.map(([, what]) => what);
const silent = { write() {} };
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Waits (in real time, a millisecond at a time) for something the program does on its own. */
async function until(condition: () => boolean, what: string) {
  for (let attempt = 0; attempt < 2000 && !condition(); attempt += 1) {
    await pause(1);
  }
  expect(condition(), what).toBe(true);
}

describe('each hardware operation calls its capability with the exact arguments', () => {
  it('display.show passes the frame of the picture: the learner’s squares in red, row by row from the top left', async () => {
    const { world, outcome } = await run(prog([showImage(images.CROSS)]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.frames).toHaveLength(1);
    const [[at, frame]] = world.frames as [[number, Frame]];
    expect(at).toBe(0);
    // Written out by hand: cell (column x, row y) is index y * 5 + x.
    const lit = new Set([0, 4, 6, 8, 12, 16, 18, 20, 24]);
    expect(frame.pixels).toEqual(Array.from({ length: 25 }, (_, index) => (lit.has(index) ? '#FF0000' : null)));
    expect(frame).toEqual(redFrame(images.CROSS));
    expect(frame).toEqual(imageFrame([...images.CROSS.join('')].map((digit) => digit === '1')));
    expect(world.sleeps).toEqual([]);
  });

  it('display.show puts a square at column x of row y at index y × 5 + x: (3, 1) is 8 and (0, 4) is 20, not their mirror images', async () => {
    const { world } = await run(prog([showImage(['00000', '00010', '00000', '00000', '10000'])]));
    const [[, frame]] = world.frames as [[number, Frame]];
    expect(frame.pixels.flatMap((pixel, index) => (pixel === '#FF0000' ? [index] : []))).toEqual([8, 20]);
    expect(frame.pixels.every((pixel) => pixel === null || pixel === '#FF0000')).toBe(true);
  });

  it('display.show of a picture with no square lit is a blank frame, and an unlit checkbox that Blockly left out is off', async () => {
    const empty: ImageRows = ['00000', '00000', '00000', '00000', '00000'];
    const { world } = await run(prog([showImage(empty)]));
    expect(world.frames).toEqual([[0, blankFrame()]]);
    // Blockly does not save the fields of an unchecked box that was never touched: the compiler reads a missing one as off.
    const block = showImage(images.DOT);
    const partial: Json = { ...block, fields: { R2C2: true } };
    const second = await run(prog([partial]));
    expect(second.world.frames).toEqual([[0, redFrame(images.DOT)]]);
  });

  it('display.show replaces the whole frame, and display.clear turns every light off (25 nulls)', async () => {
    const { world } = await run(prog([showImage(images.FULL), showImage(images.RING), clearDisplay()]));
    expect(world.frames.map(([, frame]) => frame)).toEqual([redFrame(images.FULL), redFrame(images.RING), blankFrame()]);
    expect(world.frames[2]?.[1].pixels).toHaveLength(25);
    expect(world.frames[2]?.[1].pixels.every((pixel) => pixel === null)).toBe(true);
    expect(world.sleeps).toEqual([]);
  });

  it('a note starts the tone with the contract frequency and stops it after ticks × 125 ms; a rest never starts one', async () => {
    const { world } = await run(prog([playNote('C4', 4), rest(2), playNote('A4', 1)]));
    expect(world.log).toEqual([
      [0, 'start 262'],
      [0, 'sleep 500'],
      [500, 'stop'],
      [500, 'sleep 250'],
      [750, 'start 440'],
      [750, 'sleep 125'],
      [875, 'stop'],
    ]);
  });

  it('reads call the capability of the right button and part', async () => {
    const { world, outcome } = await run(
      prog([
        setVar('x', buttonPresses('B')),
        print(buttonPressed('A')),
        setVar('y', lightLevel()),
        print(getVar('x')),
        print(getVar('y')),
      ]),
      { presses: { b: [4] }, pressed: { a: [true] }, light: [77] },
    );
    expect(outcome).toEqual({ status: 'finished' });
    expect(calls(world)).toEqual(['presses b', 'pressed a', 'print True', 'light', 'print 4', 'print 77']);
  });
});

describe('a scrolling text (C-07, C-08): 200 ms per column, 6 columns per character, then a blank frame', () => {
  /** The frames that `text` must produce when it starts at `from`: column k at from + 200 k, and the blank frame at from + 1200 n. */
  function expectScroll(frames: [number, Frame][], text: string, from: number) {
    const characters = glyphs(text);
    const columns = characters.length * 6;
    expect(frames).toHaveLength(columns + 1);
    expect(frames.map(([at]) => at)).toEqual(Array.from({ length: columns + 1 }, (_, k) => from + k * COLUMN_MS));
    for (let k = 0; k < columns; k += 1) {
      expect(frames[k]?.[1], `column ${k}`).toEqual(scrollFrame(characters, k));
    }
    expect(frames[columns]?.[1]).toEqual(blankFrame());
    expect(frames[columns]?.[0]).toBe(from + SCROLL_MS_PER_CHARACTER * characters.length);
  }

  it('"Hi": frames at t = 0, 200, … 2200 and a blank frame at 2400 (1200 ms × 2); the next statement runs at 2400', async () => {
    const { world, outcome } = await run(prog([scrollText(text('Hi')), print(text('after'))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.frames.map(([at]) => at)).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400]);
    expectScroll(world.frames, 'Hi', 0);
    expect(world.sleeps).toEqual(Array.from({ length: 12 }, () => COLUMN_MS));
    // The print is the NEXT statement: it comes after the blank frame and not before.
    expect(world.log.at(-1)).toEqual([2400, 'print after']);
    expect(calls(world).indexOf('print after')).toBe(calls(world).length - 1);
  });

  it('the first column shows the first character against column 0, and the window moves one column to the left each step', async () => {
    const { world } = await run(prog([scrollText(text('Hi'))]));
    const [[, first], [, second]] = world.frames as [[number, Frame], [number, Frame]];
    expect(first).toEqual(scrollFrame(['H', 'i'], 0));
    // Step 1 is step 0 shifted one column: column x of step 1 is column x + 1 of step 0 (the window is wider than the glyph only at the end).
    const wide = scrollFrame(['H', 'i'], 0);
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        expect(second.pixels[row * 5 + column]).toBe(wide.pixels[row * 5 + column + 1]);
      }
    }
    expect(first.pixels.some((pixel) => pixel === '#FF0000')).toBe(true);
    expect(first.pixels.every((pixel) => pixel === null || pixel === '#FF0000')).toBe(true);
  });

  it('three characters take 3 × 1200 ms (EVD-07: "ABC" 3596 ms, "100" 3602 ms)', async () => {
    const { world } = await run(prog([scrollText(text('ABC'))]));
    expectScroll(world.frames, 'ABC', 0);
    expect(world.now()).toBe(3600);
  });

  it('one character is shown at once, stays, and does not block: one frame, no wait', async () => {
    const { world, outcome } = await run(prog([scrollText(text('A')), print(text('next'))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.frames).toEqual([[0, scrollFrame(['A'], 0)]]);
    expect(world.sleeps).toEqual([]);
    expect(world.log).toEqual([[0, 'frame'], [0, 'print next']]);
  });

  it('the empty text shows nothing and does not wait (EVD-17: scroll("") changes nothing)', async () => {
    const { world, outcome } = await run(prog([showImage(images.DOT), scrollText(text('')), print(text('next'))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.frames).toEqual([[0, redFrame(images.DOT)]]);
    expect(world.sleeps).toEqual([]);
    expect(calls(world)).toEqual(['frame', 'print next']);
  });

  it('a number is shown as its text: -12 scrolls as "-", "1", "2" for 3600 ms', async () => {
    const { world } = await run(prog([scrollNumber(num(-12))]));
    expectScroll(world.frames, '-12', 0);
    expect(world.frames[0]?.[1]).toEqual(scrollFrame(['-', '1', '2'], 0));
  });

  it('a one-digit number stays like a one-character text, and 100 takes 3 × 1200 ms', async () => {
    const one = await run(prog([scrollNumber(num(7))]));
    expect(one.world.frames).toEqual([[0, scrollFrame(['7'], 0)]]);
    expect(one.world.sleeps).toEqual([]);
    const hundred = await run(prog([scrollNumber(num(100))]));
    expectScroll(hundred.world.frames, '100', 0);
  });

  it('scrolls a computed value, and a join, as the text they are', async () => {
    const { world } = await run(prog([setVar('x', num(7)), scrollText(join(text('n='), getVar('x'))), scrollNumber(add(getVar('x'), num(8)))]));
    const first = world.frames.slice(0, 19);
    expectScroll(first, 'n=7', 0);
    expectScroll(world.frames.slice(19), '15', 3600);
  });

  it('a second scroll starts where the first ended', async () => {
    const { world } = await run(prog([scrollText(text('Hi')), scrollText(text('Ok'))]));
    expectScroll(world.frames.slice(0, 13), 'Hi', 0);
    expectScroll(world.frames.slice(13), 'Ok', 2400);
  });

  describe('with timers that wake up late (plan §19: a frame within ±20 ms of its time)', () => {
    const TOLERANCE_MS = 20;
    const longText = 'HELLO WORLD';

    it('does not add the lateness of every column up: 3 ms late each time is still on time at column 66', async () => {
      const { world, outcome } = await run(prog([scrollText(text(longText))]), {}, { late: () => 3 });
      expect(outcome).toEqual({ status: 'finished' });
      const columns = glyphs(longText).length * 6;
      expect(world.frames).toHaveLength(columns + 1);
      world.frames.forEach(([at], k) => {
        expect(Math.abs(at - k * COLUMN_MS), `frame ${k}`).toBeLessThanOrEqual(TOLERANCE_MS);
      });
      // Every wait is shortened by the lateness of the one before, never lengthened, and never negative.
      expect(Math.max(...world.sleeps)).toBeLessThanOrEqual(COLUMN_MS);
      expect(Math.min(...world.sleeps)).toBeGreaterThanOrEqual(0);
    });

    it('makes up for one long wake-up in the next waits, and the statement after the text still starts within the tolerance', async () => {
      const { world } = await run(prog([scrollText(text(longText)), print(text('after'))]), {}, { late: (n) => (n === 10 ? 150 : 0) });
      const columns = glyphs(longText).length * 6;
      const at = (k: number) => world.frames[k]?.[0] ?? Number.NaN;
      expect(at(10) - 10 * COLUMN_MS).toBe(150);
      // The next wait is shorter by the 150 ms, so the text is back on its grid at the following column.
      expect(at(11) - 11 * COLUMN_MS).toBeLessThanOrEqual(0);
      expect(world.log.at(-1)).toEqual([columns * COLUMN_MS, 'print after']);
    });

    it('does not burst out the frames of a stall of more than a column (a hidden tab): the text goes on at 200 ms per column from there', async () => {
      const { world } = await run(prog([scrollText(text(longText))]), {}, { late: (n) => (n === 10 ? 5000 : 0) });
      const times = world.frames.map(([at]) => at);
      const gaps = times.slice(1).map((at, k) => at - (times[k] ?? 0));
      // The stalled wait is the only long gap; every other gap, before and after it, is a whole column.
      expect(gaps.filter((gap) => gap !== COLUMN_MS)).toEqual([COLUMN_MS + 5000]);
      expect(world.frames).toHaveLength(glyphs(longText).length * 6 + 1);
    });
  });

  it('a text of 1000 characters (the limit) is bounded by steps, not by recursion: 6000 columns, 1 200 000 ms, no stack growth', async () => {
    const long = 'a'.repeat(1000);
    const { world, outcome } = await run(prog([scrollText(text(long)), print(text('done'))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.frames).toHaveLength(6001);
    expect(world.sleeps).toHaveLength(6000);
    expect(world.now()).toBe(1_200_000);
    expect(world.frames[6000]).toEqual([1_200_000, blankFrame()]);
    expect(world.frames[5999]?.[1]).toEqual(scrollFrame(glyphs(long), 5999));
    expect(world.lines).toEqual(['done']);
  });
});

describe('a dynamic text outside the display’s characters is a fault of the program (domain guard)', () => {
  it('stops with out-of-domain at the scroll block, keeps what was shown and printed before, and runs nothing after', async () => {
    const scroll = scrollText(join(text('a'), text('é')));
    const { world, outcome } = await run(prog([print(text('before')), showImage(images.RING), scroll, print(text('after'))]));
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: scroll.id });
    expect(world.lines).toEqual(['before']);
    // The picture stays; nothing of the text was drawn and nothing waited.
    expect(world.frames).toEqual([[0, redFrame(images.RING)]]);
    expect(world.sleeps).toEqual([]);
  });

  it.each([
    ['an accented letter', 'é'],
    ['a letter beyond the BMP', '😀'],
    ['a Vietnamese letter', 'ư'],
  ])('refuses %s in a joined text', async (_label, character) => {
    const scroll = scrollText(join(text('x'), text(character)));
    const { world, outcome } = await run(prog([scroll]));
    expect(outcome).toMatchObject({ status: 'error', code: 'out-of-domain', blockId: scroll.id });
    expect(world.frames).toEqual([]);
  });

  it('accepts the whole range from space (0x20) to ~ (0x7E) when joined', async () => {
    const edge = scrollText(join(text(' '), text('~')));
    const { outcome, world } = await run(prog([edge]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.frames).toHaveLength(13);
  });
});

describe('a note (C-50) and a rest (C-51): the length is in ticks of 125 ms', () => {
  const notes = Object.entries(contractHz);
  const cases = notes.flatMap(([note, hz]) => ([1, 2, 4] as const).map((ticks): [string, 1 | 2 | 4, number] => [note, ticks, hz]));

  it('covers the 15 notes of the contract and the 3 lengths', () => {
    expect(notes).toHaveLength(15);
    expect(cases).toHaveLength(45);
  });

  it.each(cases)('%s for %i ticks (%i Hz): startTone(hz) at t, stopTone() at t + 125 × ticks, and the statement waits exactly that', async (note, ticks, hz) => {
    // After a wait of 40 ms, so that the note is measured from the moment it starts and not from zero.
    const t = 40;
    const { world, outcome } = await run(prog([wait(num(t)), playNote(note, ticks), print(text('next'))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.log).toEqual([
      [0, `sleep ${t}`],
      [t, `start ${hz}`],
      [t, `sleep ${TICK_MS * ticks}`],
      [t + TICK_MS * ticks, 'stop'],
      [t + TICK_MS * ticks, 'print next'],
    ]);
  });

  it.each([1, 2, 4] as const)('a rest of %i ticks only waits ticks × 125 ms: no tone, no stop, no frame', async (ticks) => {
    const { world, outcome } = await run(prog([rest(ticks), print(text('next'))]));
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.log).toEqual([
      [0, `sleep ${TICK_MS * ticks}`],
      [TICK_MS * ticks, 'print next'],
    ]);
  });

  it('plays a melody one note after the other, each starting when the last ended', async () => {
    const { world } = await run(prog([playNote('C4', 4), playNote('E4', 4), rest(4), playNote('C5', 2)]));
    const starts = world.log.filter(([, what]) => what.startsWith('start')).map(([at, what]) => [at, what]);
    expect(starts).toEqual([[0, 'start 262'], [500, 'start 330'], [1500, 'start 523']]);
    expect(world.now()).toBe(1750);
  });
});

describe('Stop', () => {
  it('during a note calls stopTone() (the finally), ends the run as stopped, and nothing is shown afterwards', async () => {
    const world = createWorld({}, { blocking: true });
    const running = start(compile(prog([playNote('C4', 4), showImage(images.RING), print(text('never'))])), world);
    await settle();
    expect(calls(world)).toEqual(['start 262', 'sleep 500']);
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(calls(world)).toEqual(['start 262', 'sleep 500', 'stop']);
    expect(world.frames).toEqual([]);
    expect(world.lines).toEqual([]);
    await settle();
    expect(calls(world)).toEqual(['start 262', 'sleep 500', 'stop']);
  });

  it('a tone that was reported but whose report then failed (a listener of the snapshot threw) is still stopped', async () => {
    const world = createWorld();
    const sound = world.capabilities.sound;
    expect(sound).toBeDefined();
    const failing: Capabilities = {
      ...world.capabilities,
      sound: {
        startTone(hz) {
          sound?.startTone(hz);
          throw new Error('a listener of the snapshot failed');
        },
        stopTone: () => sound?.stopTone(),
      },
    };
    const outcome = await start(compile(prog([playNote('C4', 4), print(text('never'))])), world, failing).done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error' });
    expect(calls(world)).toEqual(['start 262', 'stop']);
    expect(world.lines).toEqual([]);
  });

  it('during a rest ends the run without ever having started a tone', async () => {
    const world = createWorld({}, { blocking: true });
    const running = start(compile(prog([rest(4), showImage(images.RING)])), world);
    await settle();
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(calls(world)).toEqual(['sleep 500']);
  });

  it('during a scroll stops after the current column: no further frame and no blank frame', async () => {
    // Stop is pressed inside the third sleep: columns 0, 1 and 2 were drawn, the one after them is not.
    const world = createWorld({}, { stopAtSleep: 3 });
    const running = start(compile(prog([scrollText(text('Hello')), showImage(images.RING), print(text('never'))])), world);
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(world.frames.map(([, frame]) => frame)).toEqual([0, 1, 2].map((k) => scrollFrame(glyphs('Hello'), k)));
    expect(world.frames.map(([at]) => at)).toEqual([0, 200, 400]);
    await settle();
    expect(world.frames).toHaveLength(3);
    expect(world.lines).toEqual([]);
  });

  it('is seen at the next column by the budget even when a pause does not notice it: every column is a step', async () => {
    const world = createWorld({}, { stopAtFrame: 3, deaf: true });
    const running = start(compile(prog([scrollText(text('Hello')), print(text('never'))])), world);
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(world.frames.map(([, frame]) => frame)).toEqual([0, 1, 2].map((k) => scrollFrame(glyphs('Hello'), k)));
    expect(world.lines).toEqual([]);
  });

  it('is seen at the next statement by the budget even when the pause of a note did not notice it, and the tone is off', async () => {
    const world = createWorld({}, { deaf: true, stopAtTone: true });
    const running = start(compile(prog([playNote('C4', 1), showImage(images.RING), playNote('E4', 1)])), world);
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(calls(world)).toEqual(['start 262', 'sleep 125', 'stop']);
    expect(world.frames).toEqual([]);
  });

  it('before a scroll starts shows nothing', async () => {
    const world = createWorld();
    const running = start(compile(prog([scrollText(text('Hello'))])), world);
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(world.frames).toEqual([]);
  });

  it('in real time ends a long scroll within 100 ms, not after the text', async () => {
    const world = createWorld();
    const running = runYbc(compile(prog([scrollText(text('Hello, world! '.repeat(20)))])), { sleep: timerSleep, console: world.sink }, world.capabilities);
    await until(() => world.frames.length > 0, 'the first column');
    const pressed = performance.now();
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(performance.now() - pressed).toBeLessThan(100);
    // The text has 1680 columns at 200 ms each; Stop did not wait for them.
    expect(world.frames.length).toBeLessThan(20);
  });

  it('in real time ends a note within 100 ms and silences it', async () => {
    const world = createWorld();
    const running = runYbc(compile(prog([playNote('C4', 4)])), { sleep: timerSleep, console: world.sink }, world.capabilities);
    await until(() => calls(world).length > 0, 'the tone');
    expect(calls(world)).toEqual(['start 262']);
    const pressed = performance.now();
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(performance.now() - pressed).toBeLessThan(100);
    expect(calls(world)).toEqual(['start 262', 'stop']);
  });
});

describe('reads: once per evaluation, left to right, short-circuit', () => {
  it('reads a part once each time the expression is evaluated, in the order the expression is written', async () => {
    const { world } = await run(
      prog([setVar('x', add(buttonPresses('A'), add(lightLevel(), buttonPresses('B'))))]),
      { presses: { a: [1], b: [3] }, light: [20] },
    );
    expect(calls(world)).toEqual(['presses a', 'light', 'presses b']);
    const again = await run(
      prog([repeat(num(3), [print(lightLevel())])]),
      { light: [5, 6, 7] },
    );
    expect(calls(again.world)).toEqual(['light', 'print 5', 'light', 'print 6', 'light', 'print 7']);
  });

  it('a condition is read once per evaluation: an if reads once, a while reads before each pass and once more to leave', async () => {
    const once = await run(prog([ifThen(buttonPressed('A'), [print(text('yes'))]), print(text('end'))]), { pressed: { a: [true] } });
    expect(calls(once.world)).toEqual(['pressed a', 'print yes', 'print end']);
    const looping = await run(prog([whileLoop(buttonPressed('B'), [print(text('tick'))])]), { pressed: { b: [true, true, false] } });
    expect(calls(looping.world)).toEqual(['pressed b', 'print tick', 'pressed b', 'print tick', 'pressed b']);
  });

  it('and / or do not read the right side when the left side decides', async () => {
    const { world, outcome } = await run(
      prog([
        print(and(bool(false), buttonPressed('A'))),
        print(or(bool(true), buttonPressed('B'))),
        print(and(buttonPressed('A'), buttonPressed('B'))),
        print(or(buttonPressed('A'), buttonPressed('B'))),
        print(and(buttonPressed('A'), buttonPressed('B'))),
      ]),
      { pressed: { a: [true, true, false], b: [false] } },
    );
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.lines).toEqual(['False', 'True', 'False', 'True', 'False']);
    // False and … / True or …: no read. A true, then B (false): both. A true or …: B not read. A false and …: B not read.
    expect(calls(world).filter((what) => what.startsWith('pressed'))).toEqual(['pressed a', 'pressed b', 'pressed a', 'pressed a']);
    expect(world.unread().pressed).toEqual({ a: [], b: [] });
  });

  it('count up reads its bounds once each, start first, so a changing count gives an empty range (plan §18.3): [2, 0] runs zero times', async () => {
    const loop = countUp('i', buttonPresses('A'), buttonPresses('A'), 1, [print(getVar('i'))]);
    const { world, outcome } = await run(prog([loop, print(text('end'))]), { presses: { a: [2, 0] } });
    expect(outcome).toEqual({ status: 'finished' });
    expect(calls(world)).toEqual(['presses a', 'presses a', 'print end']);
    expect(world.lines).toEqual(['end']);
  });

  it('count up with presses [1, 3] counts 1, 2, 3 and still reads twice, not once per pass', async () => {
    const loop = countUp('i', buttonPresses('A'), buttonPresses('A'), 1, [print(getVar('i'))]);
    const { world } = await run(prog([loop]), { presses: { a: [1, 3] } });
    expect(world.lines).toEqual(['1', '2', '3']);
    expect(calls(world).filter((what) => what === 'presses a')).toHaveLength(2);
  });
});

describe('a part the factory did not provide, or an answer outside the contract, is an internal error and never a throw', () => {
  /** The statement to run, and the block the fault must name: the statement itself, or the read inside a print. */
  const operations: [label: string, statement: Json, at: Json][] = [];
  const add1 = (label: string, statement: Json) => operations.push([label, statement, statement]);
  const addRead = (label: string, read: Json) => operations.push([label, print(read), read]);
  add1('show image', showImage(images.RING));
  add1('clear', clearDisplay());
  add1('scroll text', scrollText(text('Hi')));
  add1('scroll number', scrollNumber(num(5)));
  add1('play note', playNote('C4', 1));
  addRead('button is pressed', buttonPressed('A'));
  addRead('presses of a button', buttonPresses('A'));
  addRead('light level', lightLevel());

  it.each(operations)('%s without its capability: internal-error at the block, nothing else touched', async (_label, statement, at) => {
    const world = createWorld();
    const running = start(compile(prog([print(text('before')), statement, print(text('after'))])), world, {});
    const outcome = await running.done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: at.id });
    expect(world.lines).toEqual(['before']);
    expect(world.frames).toEqual([]);
  });

  it('a capability set that has the other parts but not the one the block needs is still an internal error', async () => {
    const world = createWorld();
    const { display, buttons, light } = world.capabilities;
    const block = playNote('C4', 1);
    const outcome = await start(compile(prog([block])), world, { display, buttons, light }).done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: block.id });
  });

  it('a button part that cannot count presses is an internal error for get_presses and still serves is_pressed', async () => {
    const world = createWorld({ pressed: { a: [true] } });
    const pressedOnly: Capabilities = { buttons: { isPressed: () => true } };
    const block = buttonPresses('A');
    const failing = await start(compile(prog([print(block)])), world, pressedOnly).done;
    expect(failing).toMatchObject({ status: 'error', code: 'internal-error', blockId: block.id });
    const working = createWorld();
    expect(await start(compile(prog([print(buttonPressed('A'))])), working, pressedOnly).done).toEqual({ status: 'finished' });
    expect(working.lines).toEqual(['True']);
  });

  it.each([101, 50.5, Number.NaN, -1, Number.POSITIVE_INFINITY, 1000, 0.5])('a light level of %s is internal-error at the read', async (answer) => {
    const block = lightLevel();
    const { world, outcome } = await run(prog([print(text('before')), print(block), print(text('after'))]), { light: [answer] });
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: block.id });
    expect(world.lines).toEqual(['before']);
  });

  it.each([0, 1, 50, 99, 100])('a light level of %i is accepted, the whole range 0..100 included', async (answer) => {
    const { world, outcome } = await run(prog([print(lightLevel())]), { light: [answer] });
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.lines).toEqual([String(answer)]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0.5, 2 ** 53])('a press count of %s is internal-error at the read', async (answer) => {
    const block = buttonPresses('B');
    const { world, outcome } = await run(prog([print(block)]), { presses: { b: [answer] } });
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: block.id });
    expect(world.lines).toEqual([]);
  });

  it.each([0, 1, 7, 1000])('a press count of %i is accepted', async (answer) => {
    const { world, outcome } = await run(prog([print(buttonPresses('A'))]), { presses: { a: [answer] } });
    expect(outcome).toEqual({ status: 'finished' });
    expect(world.lines).toEqual([String(answer)]);
  });

  it('never leaks the text of an exception: a capability that throws becomes the generic message', async () => {
    const world = createWorld();
    const throwing: Capabilities = {
      display: {
        setFrame() {
          throw new TypeError('secret detail about the display');
        },
      },
    };
    const block = showImage(images.RING);
    const outcome = await start(compile(prog([block])), world, throwing).done;
    expect(outcome).toEqual({ status: 'error', code: 'internal-error', message: 'Unexpected runtime error.', blockId: block.id });
  });
});

describe('operands that the compiler would have refused are internal errors too (a defence in the interpreter, not a behaviour to rely on)', () => {
  const id = 'hand';
  const ir = (statement: YbcStatement): YbcProgramIR => ({ onStart: [statement], forever: null, variables: [] });
  const intExpr: Expr = { type: 'int', kind: 'int', value: 1, blockId: 'one' };
  const strExpr: Expr = { type: 'str', kind: 'str', value: 'x', blockId: 'text' };
  const note = (note: string, ticks: number) => ({ kind: 'call', op: 'sound.playNote', operand: { kind: 'note', note, ticks }, blockId: id }) as unknown as YbcStatement;
  const restOf = (ticks: number) => ({ kind: 'call', op: 'sound.rest', operand: { kind: 'rest', ticks }, blockId: id }) as unknown as YbcStatement;
  const readButton = (button: string) =>
    ({ kind: 'print', value: { type: 'bool', kind: 'read', op: 'button.isPressed', operand: { kind: 'button', button }, blockId: 'read' }, blockId: id }) as unknown as YbcStatement;

  it.each([
    ['a note C6 (above the domain)', note('C6', 1)],
    ['a note that is an Object.prototype member', note('constructor', 1)],
    ['a flat note', note('DB4', 1)],
    ['a note of 3 ticks', note('C4', 3)],
    ['a note of 8 ticks (the editor’s inconsistent :8)', note('C4', 8)],
    ['a note of 0 ticks', note('C4', 0)],
    ['a rest of 3 ticks', restOf(3)],
    ['a rest of 0.5 ticks', restOf(0.5)],
  ])('%s: no tone, no wait', async (_label, statement) => {
    const world = createWorld();
    const outcome = await start(ir(statement), world).done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: id });
    expect(world.log).toEqual([]);
  });

  it.each(['AB', 'C', 'a', '', 'constructor'])('a button named %j is not a button', async (button) => {
    const world = createWorld({ pressed: { a: [true], b: [true] } });
    const outcome = await start(ir(readButton(button)), world).done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error' });
    expect(world.log).toEqual([]);
  });

  it.each(['hack.it', 'display.shw', '__proto__', 'constructor', 'toString', ''])('a call to the unknown op %j is an internal error, not a statement skipped in silence', async (op) => {
    const world = createWorld();
    const unknown = { kind: 'call', op, blockId: id } as unknown as YbcStatement;
    const outcome = await start(ir(unknown), world).done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: id });
    expect(world.log).toEqual([]);
  });

  it('a scroll of text given an int, and a scroll of a number given a text, are internal errors', async () => {
    const world = createWorld();
    const textOfInt = { kind: 'call', op: 'display.scrollText', args: [intExpr], blockId: id } as unknown as YbcStatement;
    expect(await start(ir(textOfInt), world).done).toMatchObject({ status: 'error', code: 'internal-error', blockId: id });
    const numberOfText = { kind: 'call', op: 'display.scrollNumber', args: [strExpr], blockId: id } as unknown as YbcStatement;
    expect(await start(ir(numberOfText), world).done).toMatchObject({ status: 'error', code: 'internal-error', blockId: id });
    expect(world.frames).toEqual([]);
  });

  it.each([24, 26, 0])('a picture of %i squares is an internal error and draws nothing', async (cells) => {
    const world = createWorld();
    const show = { kind: 'call', op: 'display.show', operand: { kind: 'image', image: { source: 'custom', pixels: Array.from({ length: cells }, () => true) } }, blockId: id } as unknown as YbcStatement;
    const outcome = await start(ir(show), world).done;
    expect(outcome).toMatchObject({ status: 'error', code: 'internal-error', blockId: id });
    expect(world.frames).toEqual([]);
  });
});

describe('the execution budget with hardware in the loop', () => {
  it('a tight "while true: x = light level" loop stays stoppable within 100 ms of real time, and gives the browser control', async () => {
    let reads = 0;
    let yields = 0;
    const capabilities: Capabilities = {
      light: {
        lightLevel() {
          reads += 1;
          return 50;
        },
      },
    };
        const running = runYbc(
      compile(prog([whileLoop(bool(true), [setVar('x', lightLevel())])])),
      {
        sleep: timerSleep,
        console: silent,
        yieldNow: () => {
          yields += 1;
          return new Promise((resolve) => setTimeout(resolve, 0));
        },
      },
      capabilities,
    );
    await pause(40);
    const pressed = performance.now();
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(performance.now() - pressed).toBeLessThan(100);
    expect(reads).toBeGreaterThan(10);
    expect(yields).toBeGreaterThan(0);
  });

  it('a tight loop that reads a button is stoppable the same way', async () => {
    let reads = 0;
    const capabilities: Capabilities = {
      buttons: {
        isPressed() {
          reads += 1;
          return false;
        },
      },
    };
    const running = runYbc(
      compile(prog([whileLoop(or(buttonPressed('A'), bool(true)), [])])),
      { sleep: timerSleep, console: silent },
      capabilities,
    );
    await pause(30);
    const pressed = performance.now();
    running.stop();
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(performance.now() - pressed).toBeLessThan(100);
    expect(reads).toBeGreaterThan(0);
  });

  it('a forever of hardware statements repeats with exactly one 10 ms yield per pass, and the hardware adds none', async () => {
    const world = createWorld({}, { stopAtSleep: 4 });
    const running = start(compile(prog([], [showImage(images.RING), clearDisplay()])), world);
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(world.sleeps).toEqual([10, 10, 10, 10]);
    expect(world.frames.map(([at]) => at)).toEqual([0, 0, 10, 10, 20, 20, 30, 30]);
    expect(world.frames.map(([, frame]) => frame)).toEqual(Array.from({ length: 4 }, () => [redFrame(images.RING), blankFrame()]).flat());
  });

  it('a forever with a note pauses for the note, then for the 10 ms yield, every pass', async () => {
    const world = createWorld({}, { stopAtSleep: 6 });
    const running = start(compile(prog([], [playNote('C4', 1)])), world);
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(world.sleeps).toEqual([125, 10, 125, 10, 125, 10]);
    expect(calls(world).filter((what) => what === 'start 262')).toHaveLength(3);
    expect(calls(world).filter((what) => what === 'stop')).toHaveLength(3);
  });

  it('a forever with a scroll pauses a column at a time, then once for the yield', async () => {
    const world = createWorld({}, { stopAtSleep: 13 });
    const running = start(compile(prog([], [scrollText(text('Hi'))])), world);
    expect(await running.done).toEqual({ status: 'stopped' });
    expect(world.sleeps).toEqual([...Array.from({ length: 12 }, () => COLUMN_MS), 10]);
  });

  it('a program that ends in on start with hardware finishes: the board stays powered, there is nothing more to run', async () => {
    const { outcome, world } = await run(prog([showImage(images.DOT), playNote('C3', 1)]));
    expect(outcome).toEqual({ status: 'finished' } satisfies YbcRunOutcome);
    expect(world.log).toEqual([[0, 'frame'], [0, 'start 131'], [0, 'sleep 125'], [125, 'stop']]);
  });
});
