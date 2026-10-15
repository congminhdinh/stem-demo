import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ledOnSample from '../../samples/led-on.project.json';
import { projectDocumentSchema, type ProjectDocument } from '../circuit/document';
import type { Frame } from '../capabilities/frame';
import type { Capabilities } from '../capabilities/io';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import {
  buttonPresses, buttonPressed, clearDisplay, ifThen, images, lightLevel, num, playNote, print, program, rest, scrollNumber, scrollText, showImage, text, wait,
  type ImageRows, type Json,
} from '../program/__fixtures__/ybc-blocks';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import { scrollFrame } from '../simulation/peripherals/display';
import { simulateCircuit, type ComponentInput } from '../simulation/simulate-circuit';
import { at, seamDocument, seamProfiles, seamRegistry, ybcBoard } from './__fixtures__/seam-fixtures';
import { createRunSession, type CapabilityFactory, type RunEnvironment, type RunSession, type RunSnapshot } from './run-session';

// The onboard hardware through the production path (plan §10, YB-3, YB-CP amendment 1): a real Basic or Advanced document with the
// `ybc-board`, a real `RunSession`, and the production factory `createOnboardCapabilities`; fake timers drive the time. What
// the learner program shows, scrolls, sounds and reads is observed where the UI observes it: the snapshot, and the inputs
// the controls send with `setComponentInput`. The contract is §4 (display), §5 (buttons), §6 (light) and §8 (sound).

const registry = createDeviceRegistry(localDeviceDefinitions);
const boardId = 'ybc-board-1';
const part = (name: string) => `${boardId}/${name}`;
const display = part('display');
const buzzer = part('buzzer');
const buttonA = part('button-a');
const buttonB = part('button-b');
const lightPart = part('light');

const hold = (closed: boolean): ComponentInput => ({ kind: 'hold', closed });
const slider = (value: number): ComponentInput => ({ kind: 'slider', value });
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

/** A frame written out by hand from five rows of digits: a 1 is a red light, at column x of row y. */
const redFrame = (rows: ImageRows | readonly string[]): Frame => ({ pixels: [...rows.join('')].map((digit) => (digit === '1' ? '#FF0000' : null)) });
const blank = redFrame(['00000', '00000', '00000', '00000', '00000']);
const glyphs = (message: string) => [...message];

/** Contract §8.1 (EVD-21): the frequency of the 15 natural notes, as the contract writes the table. */
const contractHz: [string, number][] = [
  ['C3', 131], ['D3', 147], ['E3', 165], ['F3', 175], ['G3', 196], ['A3', 220], ['B3', 247], ['C4', 262], ['D4', 294], ['E4', 330],
  ['F4', 349], ['G4', 392], ['A4', 440], ['B4', 494], ['C5', 523],
];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const document = (blocks: Json, profile = 'ybc-basic'): ProjectDocument => fixtureDocument(profile, { blocks });

/** The production registry and profiles with the production factory; every environment and capability set is kept, to be probed later. */
function setup(wrap: (environment: RunEnvironment) => RunEnvironment = (environment) => environment) {
  const environments: RunEnvironment[] = [];
  const capabilities: Capabilities[] = [];
  const factory: CapabilityFactory = (environment) => {
    const given = wrap(environment);
    environments.push(environment);
    const made = createOnboardCapabilities(given);
    capabilities.push(made);
    return made;
  };
  const session = createRunSession(registry, { capabilities: factory });
  const published: { at: number; snapshot: RunSnapshot }[] = [];
  session.subscribe((snapshot) => published.push({ at: Date.now(), snapshot }));
  return { session, environments, capabilities, published };
}

const componentsOf = (session: RunSession) => session.getSnapshot().simulation?.components ?? {};
const frameOf = (session: RunSession): Frame | undefined => componentsOf(session)[display]?.frame;
const linesOf = (session: RunSession) => session.getSnapshot().console?.lines ?? [];
const frameKey = (snapshot: RunSnapshot) => JSON.stringify(snapshot.simulation?.components[display]?.frame ?? null);

describe('display: a picture (C-06) and clear (C-09)', () => {
  it.each(['ybc-basic', 'ybc-advanced'])('%s: show image puts the exact frame in the snapshot: red lights at column x of row y, the others off', async (profile) => {
    const { session } = setup();
    expect(session.start(document(program([showImage(['00000', '00010', '00000', '00000', '00000'])]), profile))).toEqual({ ok: true });
    // The first snapshot is the powered board and has no state of the display yet (a part that never reported is off).
    expect(componentsOf(session)).toEqual({});
    await vi.advanceTimersByTimeAsync(0);
    const frame = frameOf(session);
    expect(frame).toEqual(redFrame(['00000', '00010', '00000', '00000', '00000']));
    // (3, 1) is column 3 of row 1 (EVD-06), which is index 1 × 5 + 3.
    expect(frame?.pixels[8]).toBe('#FF0000');
    expect(frame?.pixels.filter((pixel) => pixel !== null)).toHaveLength(1);
    expect(Object.keys(componentsOf(session))).toEqual([display]);
    expect(session.getSnapshot().status).toBe('finished');
    session.stop();
  });

  it.each([
    ['an L (rows and columns are not swapped)', ['10000', '10000', '10000', '10000', '11111']],
    ['the full frame', images.FULL],
    ['a ring', images.RING],
    ['a cross', images.CROSS],
    ['a dot', images.DOT],
    ['nothing lit', ['00000', '00000', '00000', '00000', '00000']],
  ] as [string, readonly string[]][])('shows %s exactly', async (_label, rows) => {
    const { session } = setup();
    session.start(document(program([showImage(rows as ImageRows)])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(redFrame(rows));
    expect(frameOf(session)?.pixels).toHaveLength(25);
    session.stop();
  });

  it('a picture replaces the whole frame, and clear turns all 25 lights off', async () => {
    const { session } = setup();
    session.start(document(program([showImage(images.FULL), wait(num(100)), showImage(images.DOT), wait(num(100)), clearDisplay()])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(redFrame(images.FULL));
    await vi.advanceTimersByTimeAsync(100);
    expect(frameOf(session)).toEqual(redFrame(images.DOT));
    await vi.advanceTimersByTimeAsync(100);
    const cleared = frameOf(session);
    expect(cleared).toEqual(blank);
    expect(cleared?.pixels).toHaveLength(25);
    expect(cleared?.pixels.every((pixel) => pixel === null)).toBe(true);
    // The display still has a state (all off), it is not removed.
    expect(Object.hasOwn(componentsOf(session), display)).toBe(true);
    session.stop();
  });

  it('a picture does not wait: the next statement runs at the same time', async () => {
    const { session } = setup();
    session.start(document(program([showImage(images.RING), print(text('next'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['next']);
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });
});

describe('display: a scrolling text (C-07, C-08)', () => {
  it('"Hi": a column every 200 ms from t = 0, an empty frame at 2400 ms, and the NEXT statement only after that', async () => {
    const { session, published } = setup();
    const characters = glyphs('Hi');
    const began = Date.now();
    session.start(document(program([scrollText(text('Hi')), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(0);
    for (let column = 0; column < 12; column += 1) {
      // At t = 200 × column the window is on that column, and it does not move before the next 200 ms.
      expect(Date.now() - began).toBe(200 * column);
      expect(frameOf(session), `column ${column}`).toEqual(scrollFrame(characters, column));
      expect(linesOf(session), `column ${column}`).toEqual([]);
      await vi.advanceTimersByTimeAsync(199);
      expect(frameOf(session), `column ${column} still`).toEqual(scrollFrame(characters, column));
      expect(linesOf(session)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
    }
    // t = 2400 = 1200 ms × 2: the frame is empty, and the print came after it.
    expect(Date.now() - began).toBe(2400);
    expect(frameOf(session)).toEqual(blank);
    expect(linesOf(session)).toEqual(['after']);
    expect(session.getSnapshot().status).toBe('finished');
    // Published: a new frame for each column that differs from the one before, at 200 ms × column, and the empty one at 2400. A
    // column that looks like the one before (the last columns of "i" are dark) is the same state of the display: it is not published again.
    const sequence = [...Array.from({ length: 12 }, (_, column) => scrollFrame(characters, column)), blank];
    const distinct = sequence.flatMap((frame, index) => (index === 0 || JSON.stringify(frame) !== JSON.stringify(sequence[index - 1]) ? [200 * index] : []));
    expect(distinct.length).toBeGreaterThan(10);
    const changes: number[] = [];
    let last = 'null';
    for (const { at: when, snapshot } of published) {
      const key = frameKey(snapshot);
      if (key !== 'null' && key !== last) {
        changes.push(when - began);
        last = key;
      }
    }
    expect(changes).toEqual(distinct);
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('every frame that was published while "Hi" scrolled is one of the 12 columns or the empty frame, in order, and none twice in a row', async () => {
    const { session, published } = setup();
    session.start(document(program([scrollText(text('Hi'))])));
    await vi.advanceTimersByTimeAsync(2400);
    const characters = glyphs('Hi');
    const seen: string[] = [];
    for (const { snapshot } of published) {
      const key = frameKey(snapshot);
      if (key !== 'null' && seen.at(-1) !== key) {
        seen.push(key);
      }
    }
    const sequence = [...Array.from({ length: 12 }, (_, column) => JSON.stringify(scrollFrame(characters, column))), JSON.stringify(blank)];
    expect(seen).toEqual(sequence.filter((key, index) => index === 0 || key !== sequence[index - 1]));
    session.stop();
  });

  it('a number scrolls as its text: -12 is "-", "1", "2" for 3600 ms', async () => {
    const { session } = setup();
    session.start(document(program([scrollNumber(num(-12)), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(scrollFrame(['-', '1', '2'], 0));
    await vi.advanceTimersByTimeAsync(3599);
    expect(linesOf(session)).toEqual([]);
    expect(frameOf(session)).toEqual(scrollFrame(['-', '1', '2'], 17));
    await vi.advanceTimersByTimeAsync(1);
    expect(frameOf(session)).toEqual(blank);
    expect(linesOf(session)).toEqual(['after']);
    session.stop();
  });

  it('one character is shown at once and stays: it does not block, and no timer is left', async () => {
    const { session } = setup();
    session.start(document(program([scrollText(text('A')), print(text('next'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(scrollFrame(['A'], 0));
    expect(linesOf(session)).toEqual(['next']);
    expect(session.getSnapshot().status).toBe('finished');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(frameOf(session)).toEqual(scrollFrame(['A'], 0));
    session.stop();
  });

  it('a one-digit number stays too', async () => {
    const { session } = setup();
    session.start(document(program([scrollNumber(num(7)), print(text('next'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(scrollFrame(['7'], 0));
    expect(linesOf(session)).toEqual(['next']);
    session.stop();
  });

  it('the empty text changes nothing: the picture before it stays, and there is no wait', async () => {
    const { session } = setup();
    session.start(document(program([showImage(images.RING), scrollText(text('')), print(text('next'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(redFrame(images.RING));
    expect(linesOf(session)).toEqual(['next']);
    session.stop();
  });

  it('a scroll replaces the picture that was there, and a picture after a one-character text replaces that', async () => {
    const { session } = setup();
    session.start(document(program([showImage(images.FULL), scrollText(text('A')), wait(num(50)), showImage(images.DOT)])));
    await vi.advanceTimersByTimeAsync(0);
    expect(frameOf(session)).toEqual(scrollFrame(['A'], 0));
    await vi.advanceTimersByTimeAsync(50);
    expect(frameOf(session)).toEqual(redFrame(images.DOT));
    session.stop();
  });

  it('a scroll of text outside the display’s characters made at run time is a fault of the program, shown as out-of-domain at the block', async () => {
    const { session } = setup();
    const scroll = scrollText({
      type: 'text_join',
      id: 'join-1',
      extraState: { itemCount: 2 },
      inputs: { ADD0: { block: text('a') }, ADD1: { block: text('é') } },
    });
    session.start(document(program([print(text('before')), scroll, print(text('after'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'out-of-domain', blockId: scroll.id } });
    expect(linesOf(session)).toEqual(['before']);
    expect(frameOf(session)).toBeUndefined();
    session.stop();
  });
});

describe('buttons: held (C-12) and counted (C-13)', () => {
  const click = (session: RunSession, id = buttonA) => {
    session.setComponentInput(id, hold(true));
    session.setComponentInput(id, hold(false));
  };

  it('three complete clicks during a sleep are all counted: the read prints 3, and the next read prints 0 (EVD-25)', async () => {
    const { session } = setup();
    session.start(document(program([wait(num(1000)), print(buttonPresses('A')), print(buttonPresses('A'))])));
    await vi.advanceTimersByTimeAsync(0);
    let now = 0;
    for (const at of [100, 200, 300]) {
      await vi.advanceTimersByTimeAsync(at - now);
      now = at;
      click(session);
    }
    // The three clicks were made at t = 100, 200 and 300, inside the sleep that ends at 1000.
    await vi.advanceTimersByTimeAsync(2000);
    expect(linesOf(session)).toEqual(['3', '0']);
    session.stop();
  });

  it('counts exactly the clicks made between two reads: 3, then 2, then 0', async () => {
    const { session } = setup();
    session.start(document(program([wait(num(100)), print(buttonPresses('A')), wait(num(100)), print(buttonPresses('A')), wait(num(100)), print(buttonPresses('A'))])));
    await vi.advanceTimersByTimeAsync(50);
    click(session);
    click(session);
    click(session);
    await vi.advanceTimersByTimeAsync(100);
    click(session);
    click(session);
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['3', '2', '0']);
    session.stop();
  });

  it('a button held across a read counts once: the read says 1, the next says 0 while it is still held, and is_pressed says True (EVD-17)', async () => {
    const { session } = setup();
    session.start(document(program([wait(num(100)), print(buttonPresses('A')), print(buttonPresses('A')), print(buttonPressed('A'))])));
    await vi.advanceTimersByTimeAsync(10);
    session.setComponentInput(buttonA, hold(true));
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['1', '0', 'True']);
    session.stop();
  });

  it('is_pressed is False after a click that has ended, but the click is still counted (EVD-09)', async () => {
    const { session } = setup();
    session.start(document(program([wait(num(100)), print(buttonPressed('A')), print(buttonPresses('A'))])));
    await vi.advanceTimersByTimeAsync(10);
    click(session);
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['False', '1']);
    session.stop();
  });

  it('polling with is_pressed sees True only while the button is held, and A and B are independent', async () => {
    const { session } = setup();
    session.start(
      document(
        program([], [
          ifThen(buttonPressed('A'), [print(text('A down'))], [print(text('A up'))]),
          ifThen(buttonPressed('B'), [print(text('B down'))]),
        ]),
      ),
    );
    // Iterations are at t = 0, 10, 20, …
    await vi.advanceTimersByTimeAsync(25);
    expect(linesOf(session)).toEqual(['A up', 'A up', 'A up']);
    session.setComponentInput(buttonA, hold(true));
    await vi.advanceTimersByTimeAsync(20);
    expect(linesOf(session).slice(3)).toEqual(['A down', 'A down']);
    session.setComponentInput(buttonA, hold(false));
    session.setComponentInput(buttonB, hold(true));
    await vi.advanceTimersByTimeAsync(10);
    expect(linesOf(session).slice(5)).toEqual(['A up', 'B down']);
    session.setComponentInput(buttonB, hold(false));
    await vi.advanceTimersByTimeAsync(10);
    expect(linesOf(session).slice(7)).toEqual(['A up']);
    session.stop();
  });

  it('keeps the two buttons’ counts apart', async () => {
    const { session } = setup();
    session.start(document(program([wait(num(100)), print(buttonPresses('B')), print(buttonPresses('A')), print(buttonPresses('B'))])));
    await vi.advanceTimersByTimeAsync(10);
    click(session, buttonB);
    click(session, buttonA);
    click(session, buttonA);
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['1', '2', '0']);
    session.stop();
  });

  it('a press before the run starts is lost, and a replacing run starts from 0: nothing is carried over', async () => {
    const { session } = setup();
    click(session);
    session.start(document(program([wait(num(100)), print(buttonPresses('A'))])));
    await vi.advanceTimersByTimeAsync(10);
    click(session);
    session.start(document(program([wait(num(100)), print(buttonPresses('A'))])));
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['0']);
    session.stop();
  });

  it('a slider sent to a button, and a hold sent to the display, the buzzer or the light, are ignored', async () => {
    const { session } = setup();
    session.start(document(program([wait(num(100)), print(buttonPresses('A')), print(buttonPressed('A')), print(lightLevel())])));
    await vi.advanceTimersByTimeAsync(10);
    session.setComponentInput(buttonA, slider(1));
    session.setComponentInput(display, hold(true));
    session.setComponentInput(buzzer, hold(true));
    session.setComponentInput(lightPart, hold(true));
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['0', 'False', '50']);
    session.stop();
  });
});

describe('light (C-15)', () => {
  /** Reads the light at t = 0, 100, 200, … so that a slider moved in between is what the next read sees. */
  const reads = (count: number) => program(Array.from({ length: count }, (_, index) => (index === 0 ? [print(lightLevel())] : [wait(num(100)), print(lightLevel())])).flat());

  it('is 50 before the learner moves the slider (the choice of the virtual environment, not a field of the contract)', async () => {
    const { session } = setup();
    session.start(document(reads(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['50']);
    session.stop();
  });

  it('reads the position of the slider at the moment of the read: 0, 100 and 75', async () => {
    const { session } = setup();
    session.start(document(reads(4)));
    await vi.advanceTimersByTimeAsync(50);
    session.setComponentInput(lightPart, slider(0));
    await vi.advanceTimersByTimeAsync(100);
    session.setComponentInput(lightPart, slider(100));
    await vi.advanceTimersByTimeAsync(100);
    session.setComponentInput(lightPart, slider(75));
    await vi.advanceTimersByTimeAsync(100);
    expect(linesOf(session)).toEqual(['50', '0', '100', '75']);
    session.stop();
  });

  it('a value outside 0..100 is clamped by the conversion of the board, not passed on: 150 reads 100, -20 reads 0', async () => {
    const { session } = setup();
    session.start(document(reads(3)));
    await vi.advanceTimersByTimeAsync(50);
    session.setComponentInput(lightPart, slider(150));
    await vi.advanceTimersByTimeAsync(100);
    session.setComponentInput(lightPart, slider(-20));
    await vi.advanceTimersByTimeAsync(100);
    expect(linesOf(session)).toEqual(['50', '100', '0']);
    session.stop();
  });

  it('an input that is not a whole number is not an input: the last good value stays', async () => {
    const { session } = setup();
    session.start(document(reads(3)));
    await vi.advanceTimersByTimeAsync(50);
    session.setComponentInput(lightPart, slider(33));
    await vi.advanceTimersByTimeAsync(100);
    session.setComponentInput(lightPart, { kind: 'slider', value: 33.5 });
    session.setComponentInput(lightPart, { kind: 'slider', value: Number.NaN });
    session.setComponentInput(lightPart, { kind: 'slider', value: '80' } as never);
    await vi.advanceTimersByTimeAsync(100);
    expect(linesOf(session)).toEqual(['50', '33', '33']);
    session.stop();
  });

  it('a hold sent to the light is ignored: the slider keeps its value', async () => {
    const { session } = setup();
    session.start(document(reads(3)));
    await vi.advanceTimersByTimeAsync(50);
    session.setComponentInput(lightPart, slider(20));
    await vi.advanceTimersByTimeAsync(100);
    session.setComponentInput(lightPart, hold(true));
    session.setComponentInput(lightPart, hold(false));
    await vi.advanceTimersByTimeAsync(100);
    expect(linesOf(session)).toEqual(['50', '20', '20']);
    session.stop();
  });

  it('a slider moved before the run starts is lost, and a replacing run is back at 50', async () => {
    const { session } = setup();
    session.setComponentInput(lightPart, slider(10));
    session.start(document(reads(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['50']);
    session.setComponentInput(lightPart, slider(90));
    session.start(document(reads(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['50']);
    session.stop();
  });

  it('reads change nothing in the snapshot: the light and the buttons report no state', async () => {
    const { session, published } = setup();
    session.start(document(program([print(lightLevel()), print(buttonPressed('A')), print(buttonPresses('B'))])));
    await vi.advanceTimersByTimeAsync(0);
    session.setComponentInput(lightPart, slider(10));
    session.setComponentInput(buttonA, hold(true));
    expect(componentsOf(session)).toEqual({});
    expect(published.every(({ snapshot }) => Object.keys(snapshot.simulation?.components ?? {}).length === 0)).toBe(true);
    session.stop();
  });
});

describe('sound: a note (C-50) and a rest (C-51)', () => {
  const tone = (session: RunSession) => componentsOf(session)[buzzer];

  it('the snapshot has { hz } while a note sounds and no entry after it; the next statement runs after ticks × 125 ms', async () => {
    const { session } = setup();
    session.start(document(program([playNote('C4', 4), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(tone(session)).toEqual({ hz: 262 });
    expect(linesOf(session)).toEqual([]);
    await vi.advanceTimersByTimeAsync(499);
    expect(tone(session)).toEqual({ hz: 262 });
    expect(linesOf(session)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(Object.hasOwn(componentsOf(session), buzzer)).toBe(false);
    expect(componentsOf(session)).toEqual({});
    expect(linesOf(session)).toEqual(['after']);
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it.each([1, 2, 4] as const)('a note of %i ticks lasts %i × 125 ms', async (ticks) => {
    const { session } = setup();
    session.start(document(program([playNote('A4', ticks), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(ticks * 125 - 1);
    expect(tone(session)).toEqual({ hz: 440 });
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toBeUndefined();
    expect(linesOf(session)).toEqual(['after']);
    session.stop();
  });

  it('sounds each of the 15 notes at its frequency of the contract, one after the other', async () => {
    const { session } = setup();
    session.start(document(program(contractHz.map(([note]) => playNote(note, 1)))));
    await vi.advanceTimersByTimeAsync(0);
    for (const [note, hz] of contractHz) {
      expect(tone(session), note).toEqual({ hz });
      await vi.advanceTimersByTimeAsync(125);
    }
    expect(tone(session)).toBeUndefined();
    expect(session.getSnapshot().status).toBe('finished');
    session.stop();
  });

  it('a rest is silence: there is never an entry for the buzzer, and the next statement waits ticks × 125 ms', async () => {
    const { session, published } = setup();
    session.start(document(program([rest(2), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(249);
    expect(linesOf(session)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(linesOf(session)).toEqual(['after']);
    expect(published.some(({ snapshot }) => Object.hasOwn(snapshot.simulation?.components ?? {}, buzzer))).toBe(false);
    session.stop();
  });

  it('between a note and a rest the tone is gone, and the buzzer reports nothing else (never a frame, never a value)', async () => {
    const { session, published } = setup();
    session.start(document(program([playNote('C4', 1), rest(1), playNote('E4', 1)])));
    await vi.advanceTimersByTimeAsync(130);
    expect(tone(session)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(125);
    expect(tone(session)).toEqual({ hz: 330 });
    await vi.advanceTimersByTimeAsync(125);
    expect(tone(session)).toBeUndefined();
    const states = published.flatMap(({ snapshot }) => (snapshot.simulation?.components[buzzer] ? [snapshot.simulation.components[buzzer]] : []));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => Object.keys(state).join() === 'hz')).toBe(true);
    session.stop();
  });
});

describe('Stop: the board is idle, nothing is published any more, and no timer is left', () => {
  /** The snapshots published since `from`, whatever they hold of the hardware. */
  const hardwareSince = (published: { snapshot: RunSnapshot }[], from: number) =>
    published.slice(from).filter(({ snapshot }) => Object.keys(snapshot.simulation?.components ?? {}).length > 0);

  it('during a scroll: idle, simulation null, nothing more, and no pending timer', async () => {
    const { session, published } = setup();
    session.start(document(program([scrollText(text('Hello')), print(text('never'))])));
    await vi.advanceTimersByTimeAsync(450);
    expect(frameOf(session)).toEqual(scrollFrame(glyphs('Hello'), 2));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
    expect(vi.getTimerCount()).toBe(0);
    const after = published.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(published).toHaveLength(after);
    expect(session.getSnapshot()).toEqual(idle);
  });

  it('during a note: idle, the tone is not left on, nothing more, and no pending timer', async () => {
    const { session, published } = setup();
    session.start(document(program([playNote('C4', 4), print(text('never'))])));
    await vi.advanceTimersByTimeAsync(100);
    expect(componentsOf(session)[buzzer]).toEqual({ hz: 262 });
    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
    expect(vi.getTimerCount()).toBe(0);
    const after = published.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(published).toHaveLength(after);
    expect(session.getSnapshot().simulation).toBeNull();
    expect(published.at(-1)?.snapshot).toEqual(idle);
  });

  it('during a rest, a wait and a forever of hardware: idle, and no pending timer', async () => {
    for (const blocks of [
      program([rest(4)]),
      program([wait(num(5000))]),
      program([], [showImage(images.RING), clearDisplay(), playNote('C3', 1)]),
    ]) {
      const { session, published } = setup();
      session.start(document(blocks));
      await vi.advanceTimersByTimeAsync(200);
      session.stop();
      expect(session.getSnapshot()).toEqual(idle);
      expect(vi.getTimerCount()).toBe(0);
      const after = published.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(published).toHaveLength(after);
    }
  });

  it('the frames and the tone of the stopped run never appear in the next run', async () => {
    const { session, published } = setup();
    session.start(document(program([scrollText(text('Hello'))])));
    await vi.advanceTimersByTimeAsync(450);
    session.stop();
    session.start(document(program([playNote('C4', 4)])));
    const from = published.length;
    await vi.advanceTimersByTimeAsync(0);
    expect(componentsOf(session)).toEqual({ [buzzer]: { hz: 262 } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hardwareSince(published, from).every(({ snapshot }) => !Object.hasOwn(snapshot.simulation?.components ?? {}, display))).toBe(true);

    session.stop();
    session.start(document(program([wait(num(100)), print(text('plain'))])));
    const second = published.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hardwareSince(published, second)).toEqual([]);
    expect(componentsOf(session)).toEqual({});
    session.stop();
  });
});

describe('replacing a run while a scroll or a note is in flight', () => {
  it('the new run’s snapshot has none of the old run’s frames, and the old run’s later columns publish nothing', async () => {
    const { session, published } = setup();
    session.start(document(program([scrollText(text('Hello world'))])));
    await vi.advanceTimersByTimeAsync(450);
    expect(frameOf(session)).toBeDefined();

    expect(session.start(document(program([wait(num(100)), print(text('second'))])))).toEqual({ ok: true });
    const from = published.length;
    expect(session.getSnapshot()).toMatchObject({ status: 'running' });
    expect(componentsOf(session)).toEqual({});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(componentsOf(session)).toEqual({});
    expect(linesOf(session)).toEqual(['second']);
    expect(published.slice(from).some(({ snapshot }) => Object.hasOwn(snapshot.simulation?.components ?? {}, display))).toBe(false);
    session.stop();
  });

  it('the new run’s snapshot has none of the old run’s tone, and the old run’s end of note publishes nothing', async () => {
    const { session, published } = setup();
    session.start(document(program([playNote('C4', 4), playNote('E4', 4)])));
    await vi.advanceTimersByTimeAsync(100);
    expect(componentsOf(session)[buzzer]).toEqual({ hz: 262 });

    session.start(document(program([rest(4), print(text('second'))])));
    const from = published.length;
    expect(componentsOf(session)).toEqual({});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(componentsOf(session)).toEqual({});
    expect(linesOf(session)).toEqual(['second']);
    expect(published.slice(from).some(({ snapshot }) => Object.hasOwn(snapshot.simulation?.components ?? {}, buzzer))).toBe(false);
    session.stop();
  });

  it('a note that replaces a scroll, and a scroll that replaces a note, each show only their own', async () => {
    const { session } = setup();
    session.start(document(program([scrollText(text('Hello world'))])));
    await vi.advanceTimersByTimeAsync(450);
    session.start(document(program([playNote('G4', 4)])));
    await vi.advanceTimersByTimeAsync(100);
    expect(componentsOf(session)).toEqual({ [buzzer]: { hz: 392 } });
    session.start(document(program([scrollText(text('Hi'))])));
    expect(componentsOf(session)).toEqual({});
    await vi.advanceTimersByTimeAsync(10);
    expect(Object.keys(componentsOf(session))).toEqual([display]);
    expect(frameOf(session)).toEqual(scrollFrame(glyphs('Hi'), 0));
    session.stop();
  });

  it('a run that replaced another one is stopped like any: idle and no timer', async () => {
    const { session } = setup();
    session.start(document(program([scrollText(text('Hello'))])));
    await vi.advanceTimersByTimeAsync(300);
    session.start(document(program([playNote('C4', 4)])));
    await vi.advanceTimersByTimeAsync(100);
    session.stop();
    expect(session.getSnapshot()).toEqual(idle);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('an environment and the capabilities of a run that is over do nothing', () => {
  it('after Stop, report, input and takePresses of the stale environment touch nothing, whatever the new run does', async () => {
    const { session, environments, published } = setup();
    session.start(document(program([wait(num(100))])));
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(lightPart, slider(10));
    const stale = environments[0] as RunEnvironment;
    expect(stale.input(buttonA)).toEqual(hold(true));
    session.stop();

    const before = published.length;
    stale.report(display, { frame: redFrame(images.FULL) });
    stale.report(buzzer, { hz: 440 });
    expect(stale.input(buttonA)).toBeUndefined();
    expect(stale.input(lightPart)).toBeUndefined();
    expect(stale.takePresses(buttonA)).toBe(0);
    expect(published).toHaveLength(before);
    expect(session.getSnapshot()).toEqual(idle);

    // A new run: the old environment still does nothing there, and reads nothing of it.
    session.start(document(program([wait(num(100))])));
    session.setComponentInput(buttonA, hold(true));
    stale.report(display, { frame: redFrame(images.FULL) });
    expect(componentsOf(session)).toEqual({});
    expect(stale.input(buttonA)).toBeUndefined();
    expect(stale.takePresses(buttonA)).toBe(0);
    expect((environments[1] as RunEnvironment).input(buttonA)).toEqual(hold(true));
    session.stop();
  });

  it('after Stop, the capabilities that were handed to the interpreter report nothing and read nothing', async () => {
    const { session, capabilities, published } = setup();
    session.start(document(program([wait(num(100))])));
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(lightPart, slider(10));
    const held = capabilities[0] as Capabilities;
    session.stop();

    const before = published.length;
    held.display?.setFrame(redFrame(images.FULL));
    held.sound?.startTone(440);
    held.sound?.stopTone();
    expect(held.buttons?.isPressed('a')).toBe(false);
    expect(held.buttons?.takePresses?.('a')).toBe(0);
    expect(published).toHaveLength(before);

    session.start(document(program([wait(num(100))])));
    held.display?.setFrame(redFrame(images.FULL));
    held.sound?.startTone(440);
    expect(componentsOf(session)).toEqual({});
    session.stop();
  });

  it('a late timer of a stale run cannot reach the new one: nothing is published by a run that was replaced', async () => {
    const { session, published } = setup();
    session.start(document(program([scrollText(text('Hello world'))])));
    await vi.advanceTimersByTimeAsync(250);
    session.start(document(program([wait(num(5000))])));
    const from = published.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(published.slice(from)).toEqual([]);
    session.stop();
  });
});

describe('reentrancy (R4): a subscriber that starts or stops from inside the snapshot of a report', () => {
  it('stop() from the snapshot of a display report: the session is idle, the run ends, nothing more is published, no timer is left', async () => {
    const { session, environments, published } = setup();
    let armed = true;
    session.subscribe((snapshot) => {
      if (armed && snapshot.simulation?.components[display]) {
        armed = false;
        session.stop();
      }
    });
    session.start(document(program([showImage(images.RING), wait(num(1000)), print(text('never'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toEqual(idle);
    const after = published.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(published).toHaveLength(after);
    expect(session.getSnapshot()).toEqual(idle);
    expect(vi.getTimerCount()).toBe(0);
    const services = (environments[0] as RunEnvironment).services;
    expect(services.signal.aborted).toBe(true);
    expect(services.scheduler.disposed).toBe(true);
    expect(published.filter(({ snapshot }) => snapshot.status === 'idle')).toHaveLength(1);
  });

  it('start() from the snapshot of a display report: the later call stands, with none of the old frame, and the old run’s resources are gone', async () => {
    const { session, environments } = setup();
    let armed = true;
    session.subscribe((snapshot) => {
      if (armed && snapshot.simulation?.components[display]) {
        armed = false;
        expect(session.start(document(program([wait(num(100)), print(text('second'))])))).toEqual({ ok: true });
      }
    });
    session.start(document(program([showImage(images.RING), wait(num(1000)), print(text('first'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(environments).toHaveLength(2);
    expect(session.getSnapshot()).toMatchObject({ status: 'running' });
    expect(componentsOf(session)).toEqual({});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(linesOf(session)).toEqual(['second']);
    expect(componentsOf(session)).toEqual({});
    expect(session.getSnapshot().status).toBe('finished');

    const [first, second] = environments as [RunEnvironment, RunEnvironment];
    expect(first.services.signal.aborted).toBe(true);
    expect(first.services.scheduler.disposed).toBe(true);
    expect(second.services.signal.aborted).toBe(false);
    expect(second.services.scheduler.disposed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
    expect(second.services.signal.aborted).toBe(true);
  });

  it('stop() from the snapshot of a note starting: the tone is not left on and the session is idle', async () => {
    const { session, environments, published } = setup();
    let armed = true;
    session.subscribe((snapshot) => {
      if (armed && snapshot.simulation?.components[buzzer]) {
        armed = false;
        session.stop();
      }
    });
    session.start(document(program([playNote('C4', 4), print(text('never'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toEqual(idle);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.getSnapshot()).toEqual(idle);
    expect(published.at(-1)?.snapshot).toEqual(idle);
    expect(vi.getTimerCount()).toBe(0);
    expect((environments[0] as RunEnvironment).services.signal.aborted).toBe(true);
  });

  it('start() from the snapshot of a note starting: the new run stands without the old tone', async () => {
    const { session, environments, published } = setup();
    let armed = true;
    session.subscribe((snapshot) => {
      if (armed && snapshot.simulation?.components[buzzer]) {
        armed = false;
        session.start(document(program([print(text('second'))])));
      }
    });
    session.start(document(program([playNote('C4', 4), print(text('first'))])));
    await vi.advanceTimersByTimeAsync(0);
    const from = published.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(linesOf(session)).toEqual(['second']);
    expect(componentsOf(session)).toEqual({});
    expect(environments).toHaveLength(2);
    expect((environments[0] as RunEnvironment).services.signal.aborted).toBe(true);
    // After the tone of the first run, the first run published nothing at all.
    expect(published.slice(from).some(({ snapshot }) => Object.hasOwn(snapshot.simulation?.components ?? {}, buzzer))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('a run that is stopped while its tone is sounding and writes to the console as it ends: a subscriber that starts then leaves the new run standing, without the tone', async () => {
    // As the audio adapter of the UI might: something of the run turns itself off when the run's signal aborts, and says so on the console.
    const { session, environments, published } = setup((environment) => {
      environment.services.signal.addEventListener('abort', () => environment.services.console.write('cleanup'));
      return environment;
    });
    session.start(document(program([playNote('C4', 4), print(text('never'))])));
    await vi.advanceTimersByTimeAsync(100);
    expect(componentsOf(session)[buzzer]).toEqual({ hz: 262 });
    // Reading the snapshot makes the next console write a new notice (one notice per burst).
    session.getSnapshot();

    let armed = true;
    session.subscribe(() => {
      if (armed) {
        armed = false;
        expect(session.start(document(program([wait(num(100)), print(text('second'))])))).toEqual({ ok: true });
      }
    });
    const before = published.length;
    expect(() => session.stop()).not.toThrow();

    // The later call stands: the stop did not clear it or publish idle over it.
    expect(published.slice(before).some(({ snapshot }) => snapshot.status === 'idle')).toBe(false);
    expect(session.getSnapshot().status).toBe('running');
    expect(componentsOf(session)).toEqual({});
    expect(environments).toHaveLength(2);
    const [first, second] = environments as [RunEnvironment, RunEnvironment];
    expect(first.services.signal.aborted).toBe(true);
    expect(first.services.scheduler.disposed).toBe(true);
    expect(second.services.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    // The old run’s end of note (it turns the tone off in its `finally`) reached nobody, and nothing of the old run is in the new one.
    expect(linesOf(session)).toEqual(['second']);
    expect(componentsOf(session)).toEqual({});
    // The notice of the old run’s console write goes out with the old snapshot (its tone included); from the new run’s first snapshot on, no tone.
    const sounding = (entry: { snapshot: RunSnapshot }) => Object.hasOwn(entry.snapshot.simulation?.components ?? {}, buzzer);
    const afterNotice = published.slice(before);
    const firstOfNewRun = afterNotice.findIndex((entry) => !sounding(entry));
    expect(firstOfNewRun).toBeGreaterThanOrEqual(0);
    expect(afterNotice.slice(firstOfNewRun).some(sounding)).toBe(false);
    session.stop();
  });

  it('the last of several calls from one notice stands: start, stop, start leaves the third run alive', async () => {
    const { session, environments } = setup();
    let armed = true;
    session.subscribe((snapshot) => {
      if (armed && snapshot.simulation?.components[display]) {
        armed = false;
        session.start(document(program([wait(num(100))])));
        session.stop();
        session.start(document(program([wait(num(100)), print(text('third'))])));
      }
    });
    session.start(document(program([showImage(images.RING), print(text('first'))])));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(linesOf(session)).toEqual(['third']);
    expect(componentsOf(session)).toEqual({});
    expect(environments).toHaveLength(3);
    const [a, b, c] = environments as [RunEnvironment, RunEnvironment, RunEnvironment];
    expect([a, b].every((environment) => environment.services.signal.aborted && environment.services.scheduler.disposed)).toBe(true);
    expect(c.services.signal.aborted).toBe(false);
    session.stop();
  });
});

describe('the frozen frame validator: a capability that is given a frame that is not 5 × 5 colours throws', () => {
  const badFrames: [string, unknown][] = [
    ['a sparse frame (25 holes)', { pixels: new Array(25) }],
    ['a short frame', { pixels: Array.from({ length: 24 }, () => null) }],
    ['a long frame', { pixels: Array.from({ length: 26 }, () => null) }],
    ['a colour that is not a hex code', { pixels: Array.from({ length: 25 }, () => 'red') }],
    ['a lower-case hex code', { pixels: Array.from({ length: 25 }, () => '#ff0000') }],
    ['a frame with no pixels', {}],
    ['null', null],
  ];

  it.each(badFrames)('the display capability of the factory refuses %s', async (_label, frame) => {
    const { session, capabilities, published } = setup();
    session.start(document(program([wait(num(100))])));
    const before = published.length;
    expect(() => capabilities[0]?.display?.setFrame(frame as Frame)).toThrow();
    expect(published).toHaveLength(before);
    expect(Object.keys(componentsOf(session))).toEqual([]);
    session.stop();
  });

  it('a run whose display is given a sparse frame ends with internal-error at the block, and never shows the text of the exception', async () => {
    // A factory that sparsifies every frame before the production display gets it.
    const error = createRunSession(registry, {
      capabilities: (environment) => {
        const real = createOnboardCapabilities(environment);
        return { ...real, display: { setFrame: () => real.display?.setFrame({ pixels: new Array(25) }) } } as Capabilities;
      },
    });
    const shown = showImage(images.RING);
    error.start(document(program([print(text('before')), shown, print(text('never'))])));
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = error.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toEqual({ message: 'Unexpected runtime error.', blockId: shown.id, code: 'internal-error' });
    expect(JSON.stringify(snapshot)).not.toMatch(/25 pixels|TypeError|colour or off/);
    expect(snapshot.console?.lines).toEqual(['before']);
    expect(Object.hasOwn(snapshot.simulation?.components ?? {}, display)).toBe(false);
    error.stop();
  });
});

describe('snapshots are copies: nothing a consumer does to one reaches the run or a later snapshot', () => {
  it('a subscriber that wrecks the frame of the snapshot it received changes nothing in the next one', async () => {
    const { session } = setup();
    let armed = true;
    session.subscribe((snapshot) => {
      const state = snapshot.simulation?.components[display];
      if (armed && state?.frame) {
        armed = false;
        const pixels = state.frame.pixels as unknown[];
        pixels[0] = '#00FF00';
        pixels[12] = '#0000FF';
        pixels.length = 3;
        state.hz = 1;
      }
    });
    session.start(document(program([showImage(images.RING), wait(num(100)), playNote('C4', 1), wait(num(300)), clearDisplay()])));
    await vi.advanceTimersByTimeAsync(0);
    // The next snapshots are made from the state of the run, which the subscriber could not reach.
    await vi.advanceTimersByTimeAsync(100);
    expect(componentsOf(session)[display]).toEqual({ frame: redFrame(images.RING) });
    expect(componentsOf(session)[buzzer]).toEqual({ hz: 262 });
    await vi.advanceTimersByTimeAsync(425);
    expect(componentsOf(session)[display]).toEqual({ frame: blank });
    session.stop();
  });

  it('the snapshot that getSnapshot returns after a picture is a new object each time the display changes, never the one before', async () => {
    const { session } = setup();
    session.start(document(program([showImage(images.RING), wait(num(100)), showImage(images.CROSS)])));
    await vi.advanceTimersByTimeAsync(0);
    const first = session.getSnapshot();
    const firstFrame = frameOf(session);
    await vi.advanceTimersByTimeAsync(100);
    const second = session.getSnapshot();
    expect(second).not.toBe(first);
    expect(frameOf(session)).not.toBe(firstFrame);
    expect(first.simulation?.components[display]?.frame).toEqual(redFrame(images.RING));
    expect(second.simulation?.components[display]?.frame).toEqual(redFrame(images.CROSS));
    session.stop();
  });
});

describe('what a program without hardware, and a generic project, look like', () => {
  it('a program with no hardware has the components it had before: none, and no key with a slash', async () => {
    const { session, published, environments } = setup();
    session.start(document(program([print(num(1)), wait(num(100)), print(num(2))], [print(text('tick'))])));
    await vi.advanceTimersByTimeAsync(300);
    expect(componentsOf(session)).toEqual({});
    expect(published.every(({ snapshot }) => Object.keys(snapshot.simulation?.components ?? {}).every((key) => !key.includes('/')))).toBe(true);
    expect(environments).toHaveLength(1);
    expect(Object.keys(session.getSnapshot()).sort()).toEqual(['console', 'diagnostics', 'error', 'simulation', 'status']);
    session.stop();
  });

  it('a generic project runs as it did: the factory is not called, no console, no onboard state, the same simulation byte for byte', () => {
    let calls = 0;
    const session = createRunSession(registry, {
      capabilities: (environment) => {
        calls += 1;
        return createOnboardCapabilities(environment);
      },
    });
    const sample = projectDocumentSchema.parse(ledOnSample);
    expect(session.start(sample)).toEqual({ ok: true });
    const direct = simulateCircuit(sample.circuit, registry, { powered: true, pinOutputs: {}, contacts: {} });
    expect(calls).toBe(0);
    expect(JSON.stringify(session.getSnapshot().simulation)).toBe(JSON.stringify(direct));
    expect(Object.keys(session.getSnapshot()).sort()).toEqual(['diagnostics', 'error', 'simulation', 'status']);
    expect(Object.keys(session.getSnapshot().simulation?.components ?? {}).every((key) => !key.includes('/'))).toBe(true);
    // The board inputs of an onboard part are not a thing for a generic board.
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(lightPart, slider(5));
    expect(JSON.stringify(session.getSnapshot().simulation)).toBe(JSON.stringify(direct));
    session.stop();
  });
});

describe('a component of the circuit with the id of an onboard part wins over the part', () => {
  const sessionWithSeams = () => {
    const published: RunSnapshot[] = [];
    const session = createRunSession(seamRegistry, { profiles: seamProfiles, capabilities: createOnboardCapabilities });
    session.subscribe((snapshot) => published.push(snapshot));
    return { session, published };
  };
  const seamProgram = (blocks: Json): ProjectDocument => ({ ...seamDocument([ybcBoard, { id: display, deviceType: 'test-ybc-led', position: at }]), program: { blocks } });

  it('an LED called <board>/display keeps its own state, and the program’s pictures do not replace it', async () => {
    const { session, published } = sessionWithSeams();
    expect(session.start(seamProgram(program([showImage(images.FULL), wait(num(100)), scrollText(text('Hi'))])))).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(componentsOf(session)).toEqual({ [display]: { lit: false } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(componentsOf(session)).toEqual({ [display]: { lit: false } });
    expect(published.every((snapshot) => JSON.stringify(snapshot.simulation?.components ?? {}) === JSON.stringify({ [display]: { lit: false } }))).toBe(true);
    // The program itself ran: the scroll took its 2400 ms and the run finished.
    expect(session.getSnapshot().status).toBe('finished');
    // And the reports of the display, which the circuit's LED shadows, published nothing: the powered board, then the end of the run.
    expect(published.map((snapshot) => snapshot.status)).toEqual(['running', 'finished']);
    session.stop();
  });

  it('a push button called <board>/button-a is that contact: it closes, and the board’s button A is never pressed', async () => {
    const { session } = sessionWithSeams();
    const document2: ProjectDocument = {
      ...seamDocument([ybcBoard, { id: buttonA, deviceType: 'test-ybc-button', position: at }]),
      program: { blocks: program([wait(num(100)), print(buttonPressed('A')), print(buttonPresses('A'))]) },
    };
    session.start(document2);
    await vi.advanceTimersByTimeAsync(10);
    session.setComponentInput(buttonA, hold(true));
    expect(componentsOf(session)[buttonA]).toEqual({ closed: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(linesOf(session)).toEqual(['False', '0']);
    session.stop();
  });
});

describe('RunSession knows no feature of the board; the production factory is the one that reports', () => {
  /** The code of a source file without its comments (a name in a comment explains, it does not decide). */
  const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const sessionSource = readFileSync(new URL('./run-session.ts', import.meta.url), 'utf8');
  const featureNames = /display|buzzer|button-a|button_a|light|music|scroll|tone|sound/i;

  it('has no name of a hardware feature in its code', () => {
    expect(sessionSource.length).toBeGreaterThan(5000);
    expect(withoutComments(sessionSource).match(featureNames)).toBeNull();
    for (const name of ['createDisplayCapability', 'createButtonCapability', 'createMusicCapability', 'createLightCapability']) {
      expect(sessionSource, name).not.toContain(name);
    }
  });

  it('would notice a feature in code and not in a comment (the scan is not blind)', () => {
    expect(withoutComments('const a = 1; // the display\n/* a buzzer\nand a scroll */\nconst b = 2;\n').match(featureNames)).toBeNull();
    expect(withoutComments("const display = 'x'; // fine\n").match(featureNames)).not.toBeNull();
    expect(withoutComments('function createLightCapability() {}\n').match(featureNames)).not.toBeNull();
    expect(withoutComments('const url = "a://light";\n').match(featureNames)).not.toBeNull();
  });

  it('adds no state of its own: with a factory that provides nothing, a program of prints has no component, and a hardware program fails as internal-error', async () => {
    const session = createRunSession(registry, { capabilities: () => ({}) });
    session.start(document(program([print(num(1)), wait(num(50))])));
    await vi.advanceTimersByTimeAsync(100);
    expect(componentsOf(session)).toEqual({});
    session.stop();

    const shown = showImage(images.RING);
    session.start(document(program([shown])));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'internal-error', blockId: shown.id } });
    expect(componentsOf(session)).toEqual({});
    session.stop();
  });

  it('only the display and the buzzer report, and only through the environment: buttons and light report nothing, whatever the program does', async () => {
    const reported = new Set<string>();
    const { session } = setup((environment) => ({
      ...environment,
      report(componentId, state) {
        reported.add(componentId);
        environment.report(componentId, state);
      },
    }));
    session.start(
      document(
        program([
          showImage(images.RING),
          print(buttonPressed('A')),
          print(buttonPresses('B')),
          print(lightLevel()),
          scrollText(text('Hi')),
          scrollNumber(num(5)),
          playNote('C4', 1),
          rest(1),
          clearDisplay(),
        ]),
      ),
    );
    session.setComponentInput(buttonA, hold(true));
    session.setComponentInput(lightPart, slider(20));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.getSnapshot().status).toBe('finished');
    expect([...reported].sort()).toEqual([buzzer, display].sort());
    session.stop();
  });
});
