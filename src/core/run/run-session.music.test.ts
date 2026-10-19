import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../circuit/document';
import type { Frame } from '../capabilities/frame';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { fixtureDocument } from '../profiles/__fixtures__/test-profiles';
import {
  add, images, num, playMelody, playNote, playPitch, print, program, rest, showImage, stopSound, text, wait, type ImageRows, type Json,
} from '../program/__fixtures__/ybc-blocks';
import { createOnboardCapabilities } from '../simulation/peripherals/onboard-capabilities';
import { createRunSession, type RunSession, type RunSnapshot } from './run-session';

// N17 B3: the built-in melodies, the tone and stop through the production path: an Advanced document with the ybc-board, a real
// RunSession and the production factory; fake timers drive the time. The buzzer plays one sound at a time, as the micro:bit
// `music` module does: a melody that waits blocks the program until its last note; one in the background plays on timers of
// the run while the program goes on; a tone (music.pitch) does not wait (EVD-06: pitch returned in ≈1 ms) and sounds for its
// time; any new sound replaces the one that plays; stop and the program's Stop silence it at once (Review Focus 1).

const registry = createDeviceRegistry(localDeviceDefinitions);
const boardId = 'ybc-board-1';
const part = (name: string) => `${boardId}/${name}`;
const buzzer = part('buzzer');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const document = (blocks: Json, profile = 'ybc-advanced'): ProjectDocument => fixtureDocument(profile, { blocks });

function setup() {
  const session = createRunSession(registry, { capabilities: createOnboardCapabilities });
  const published: RunSnapshot[] = [];
  session.subscribe((snapshot) => published.push(snapshot));
  return { session, published };
}

const redFrame = (rows: ImageRows | readonly string[]): Frame => ({ pixels: [...rows.join('')].map((digit) => (digit === '1' ? '#FF0000' : null)) });
const componentsOf = (session: RunSession) => session.getSnapshot().simulation?.components ?? {};
const tone = (session: RunSession) => componentsOf(session)[buzzer];
const frameOf = (session: RunSession): Frame | undefined => componentsOf(session)[part('display')]?.frame;
const linesOf = (session: RunSession) => session.getSnapshot().console?.lines ?? [];
/** The tones the published snapshots held, in order, without repeats: what the sound follows. */
const tonesIn = (published: readonly RunSnapshot[]) =>
  published
    .map((snapshot) => snapshot.simulation?.components[buzzer]?.hz)
    .filter((hz, index, all) => index === 0 || hz !== all[index - 1]);

describe('a melody in the background (wait=False): the program goes on while it plays', () => {
  it('sounds its first note at once, runs the statements after it at the same time, then plays note by note on its own', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('JUMP_UP', 'background'), print(text('after')), showImage(images.FULL)])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['after']);
    expect(frameOf(session)).toEqual(redFrame(images.FULL));
    expect(tone(session)).toEqual({ hz: 523 });
    // The program has nothing more to do; the melody is the run's and plays on.
    expect(session.getSnapshot().status).toBe('finished');
    for (const hz of [587, 659, 698, 784]) {
      await vi.advanceTimersByTimeAsync(125);
      expect(tone(session)).toEqual({ hz });
    }
    await vi.advanceTimersByTimeAsync(125);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('plays alongside a forever loop, which keeps its own time', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('ODE', 'background')], [print(text('tick')), wait(num(100))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(tone(session)).toEqual({ hz: 330 });
    expect(linesOf(session)).toEqual(['tick']);
    // Ode to joy: E E F G, four ticks each.
    await vi.advanceTimersByTimeAsync(1000);
    expect(tone(session)).toEqual({ hz: 349 });
    expect(linesOf(session).length).toBeGreaterThanOrEqual(9);
    await vi.advanceTimersByTimeAsync(500);
    expect(tone(session)).toEqual({ hz: 392 });
    session.stop();
  });

  it('plays two notes of one pitch as two notes: the tone is gone between them, for the ear', async () => {
    const { session, published } = setup();
    session.start(document(program([playMelody('ODE', 'background')])));
    await vi.advanceTimersByTimeAsync(1100);
    // E, (silence), E, (silence), F.
    expect(tonesIn(published.filter((snapshot) => snapshot.simulation))).toEqual([undefined, 330, undefined, 330, undefined, 349]);
    session.stop();
  });

  it('is replaced by a new melody: the one that played stops where it was', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('ODE', 'background'), wait(num(200)), playMelody('JUMP_DOWN', 'background'), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(199);
    expect(tone(session)).toEqual({ hz: 330 });
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toEqual({ hz: 784 });
    expect(linesOf(session)).toEqual(['after']);
    await vi.advanceTimersByTimeAsync(125 * 4);
    expect(tone(session)).toEqual({ hz: 523 });
    await vi.advanceTimersByTimeAsync(125);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it.each([
    ['a note', playNote('A4', 2), 440],
    ['a tone', playPitch(num(1000), num(250)), 1000],
  ])('is ended by %s: the buzzer plays one sound at a time', async (_name, sound, hz) => {
    const { session } = setup();
    session.start(document(program([playMelody('BIRTHDAY', 'background'), wait(num(100)), sound])));
    await vi.advanceTimersByTimeAsync(100);
    expect(tone(session)).toEqual({ hz });
    await vi.advanceTimersByTimeAsync(250);
    expect(tone(session)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('is ended by a rest too: the rest is silence for its ticks', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('BIRTHDAY', 'background'), wait(num(100)), rest(2), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(100);
    expect(tone(session)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    expect(linesOf(session)).toEqual(['after']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(tone(session)).toBeUndefined();
    session.stop();
  });
});

describe('a melody until done (wait=True): the program waits for its last note', () => {
  it('plays POWER_UP (9 ticks, 1125 ms) and only then runs the next statement', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('POWER_UP', 'wait'), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(tone(session)).toEqual({ hz: 392 });
    await vi.advanceTimersByTimeAsync(375);
    expect(tone(session)).toEqual({ hz: 784 });
    await vi.advanceTimersByTimeAsync(1124 - 375);
    expect(linesOf(session)).toEqual([]);
    expect(tone(session)).toEqual({ hz: 784 });
    await vi.advanceTimersByTimeAsync(1);
    expect(linesOf(session)).toEqual(['after']);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('keeps its rests: DADADADUM is silent for 2 ticks, then G4', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('DADADADUM', 'wait'), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(249);
    expect(tone(session)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toEqual({ hz: 392 });
    await vi.advanceTimersByTimeAsync(32 * 125 - 250 - 1);
    expect(linesOf(session)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(linesOf(session)).toEqual(['after']);
    session.stop();
  });

  it('ends a melody that plays in the background before it starts', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('BIRTHDAY', 'background'), wait(num(100)), playMelody('BA_DING', 'wait'), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(100);
    expect(tone(session)).toEqual({ hz: 988 });
    await vi.advanceTimersByTimeAsync(500);
    expect(linesOf(session)).toEqual(['after']);
    expect(tone(session)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(tone(session)).toBeUndefined();
    session.stop();
  });
});

describe('a tone (music.pitch(hz, ms)): it does not wait, and sounds for its time', () => {
  it('sounds 440 Hz for 500 ms while the program goes on at once (EVD-06)', async () => {
    const { session } = setup();
    session.start(document(program([playPitch(num(440), num(500)), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['after']);
    expect(tone(session)).toEqual({ hz: 440 });
    await vi.advanceTimersByTimeAsync(499);
    expect(tone(session)).toEqual({ hz: 440 });
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('is replaced by the next tone at once', async () => {
    const { session } = setup();
    session.start(document(program([playPitch(num(1000), num(300)), wait(num(100)), playPitch(num(200), num(300))])));
    await vi.advanceTimersByTimeAsync(100);
    expect(tone(session)).toEqual({ hz: 200 });
    await vi.advanceTimersByTimeAsync(299);
    expect(tone(session)).toEqual({ hz: 200 });
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toBeUndefined();
    session.stop();
  });

  it('of 0 ms is no sound at all', async () => {
    const { session, published } = setup();
    session.start(document(program([playPitch(num(440), num(0)), print(text('after'))])));
    await vi.advanceTimersByTimeAsync(10);
    expect(linesOf(session)).toEqual(['after']);
    expect(published.some((snapshot) => Object.hasOwn(snapshot.simulation?.components ?? {}, buzzer))).toBe(false);
    session.stop();
  });

  it.each([
    [19, 100, 'between 20 and 20000'],
    [20001, 100, 'between 20 and 20000'],
    [440, -1, 'between 0 and 60000'],
    [440, 60001, 'between 0 and 60000'],
  ])('computed as %i Hz for %i ms is outside the domain: the program ends with out-of-domain at the block, and nothing sounds', async (hz, ms, said) => {
    const { session } = setup();
    session.start(document(program([playMelody('ODE', 'background'), wait(num(100)), playPitch(add(num(hz), num(0)), add(num(ms), num(0)))])));
    await vi.advanceTimersByTimeAsync(100);
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.error?.code).toBe('out-of-domain');
    expect(snapshot.error?.message).toContain(said);
    // An error ends the sound with the program: nothing plays on under the message.
    expect(tone(session)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });
});

describe('stop (music.stop()): silence at once', () => {
  it('ends a melody in the background where it is, and the program goes on', async () => {
    const { session, published } = setup();
    session.start(document(program([playMelody('BIRTHDAY', 'background'), wait(num(300)), stopSound(), print(text('stopped')), wait(num(1000))])));
    await vi.advanceTimersByTimeAsync(299);
    expect(tone(session)).toEqual({ hz: 262 });
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toBeUndefined();
    expect(linesOf(session)).toEqual(['stopped']);
    const from = published.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(published.slice(from).some((snapshot) => Object.hasOwn(snapshot.simulation?.components ?? {}, buzzer))).toBe(false);
    expect(session.getSnapshot().status).toBe('finished');
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('ends a long tone', async () => {
    const { session } = setup();
    session.start(document(program([playPitch(num(440), num(60000)), wait(num(100)), stopSound()])));
    await vi.advanceTimersByTimeAsync(99);
    expect(tone(session)).toEqual({ hz: 440 });
    await vi.advanceTimersByTimeAsync(1);
    expect(tone(session)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('with nothing playing changes nothing', async () => {
    const { session, published } = setup();
    session.start(document(program([stopSound(), print(text('ok'))])));
    await vi.advanceTimersByTimeAsync(0);
    expect(linesOf(session)).toEqual(['ok']);
    expect(session.getSnapshot().status).toBe('finished');
    expect(published.some((snapshot) => Object.hasOwn(snapshot.simulation?.components ?? {}, buzzer))).toBe(false);
    session.stop();
  });
});

describe('Stop of the program silences everything at once, and the next run starts clean (Review Focus 1)', () => {
  /** Stops at `atMs`, then checks the session is idle, publishes nothing more and leaves no timer. */
  async function stopsSilently(blocks: Json, atMs: number) {
    const { session, published } = setup();
    session.start(document(blocks));
    await vi.advanceTimersByTimeAsync(atMs);
    expect(tone(session)).toBeDefined();
    session.stop();
    expect(session.getSnapshot()).toEqual({ status: 'idle', diagnostics: [], error: null, simulation: null });
    expect(vi.getTimerCount()).toBe(0);
    const from = published.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(published.slice(from)).toEqual([]);
    return session;
  }

  it('mid melody in the background, while the program waits', async () => {
    await stopsSilently(program([playMelody('BIRTHDAY', 'background'), wait(num(10_000))]), 200);
  });

  it('mid melody in the background, after the program finished', async () => {
    await stopsSilently(program([playMelody('PRELUDE', 'background')]), 300);
  });

  it('mid melody that waits', async () => {
    await stopsSilently(program([playMelody('PRELUDE', 'wait'), print(text('never'))]), 300);
  });

  it('mid tone', async () => {
    await stopsSilently(program([playPitch(num(440), num(60000)), wait(num(60000))]), 100);
  });

  it('and a new run after it has no sound until it makes one', async () => {
    const session = await stopsSilently(program([playMelody('NYAN', 'background'), wait(num(10_000))]), 300);
    session.start(document(program([print(text('fresh')), wait(num(100))])));
    await vi.advanceTimersByTimeAsync(50);
    expect(linesOf(session)).toEqual(['fresh']);
    expect(tone(session)).toBeUndefined();
    session.stop();
  });

  it('a new run that replaces a playing one ends its melody too', async () => {
    const { session } = setup();
    session.start(document(program([playMelody('NYAN', 'background'), wait(num(10_000))])));
    await vi.advanceTimersByTimeAsync(300);
    session.start(document(program([print(text('fresh')), wait(num(5_000))])));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tone(session)).toBeUndefined();
    session.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the Basic board', () => {
  it('has no melody, tone or stop block: a Basic document with one does not start', () => {
    for (const block of [playMelody('ODE', 'wait'), playPitch(num(440), num(100)), stopSound()]) {
      const { session } = setup();
      const result = session.start(document(program([block]), 'ybc-basic'));
      expect(result.ok, String(block.type)).toBe(false);
      expect(session.getSnapshot().status).toBe('idle');
    }
  });
});
