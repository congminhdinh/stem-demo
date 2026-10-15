import { describe, expect, it } from 'vitest';
import { createAudioPlayer, GAIN_CEILING, START_LEAD_S, type AudioContextLike } from './audio-player';

// The player against a fake AudioContext that records what it was asked to do, so the rules of the
// player (off by default, a gesture to turn it on, a volume ceiling, silence at once) are checked
// without a browser.

type FakeOscillator = {
  type: OscillatorType;
  frequency: { value: number };
  started: boolean;
  /** The time the oscillator was told to begin (on the clock of the context), or undefined for "now". */
  startedAt: number | undefined;
  stopped: boolean;
  disconnected: boolean;
  connect(destination: unknown): void;
  disconnect(): void;
  start(when?: number): void;
  stop(): void;
};

/** What the fake context says the time is, in seconds. */
const NOW = 10;

function createFakeContext() {
  const oscillators: FakeOscillator[] = [];
  const calls: string[] = [];
  const gain = { gain: { value: Number.NaN }, connect: () => calls.push('gain.connect'), disconnect: () => calls.push('gain.disconnect') };
  const context: AudioContextLike = {
    destination: 'destination',
    currentTime: NOW,
    createOscillator() {
      const oscillator: FakeOscillator = {
        type: 'sine',
        frequency: { value: 0 },
        started: false,
        startedAt: undefined,
        stopped: false,
        disconnected: false,
        connect: () => undefined,
        disconnect() {
          this.disconnected = true;
        },
        start(when) {
          this.started = true;
          this.startedAt = when;
        },
        stop() {
          this.stopped = true;
        },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => gain,
    resume: () => {
      calls.push('resume');
      return Promise.resolve();
    },
    close: () => {
      calls.push('close');
      return Promise.resolve();
    },
  };
  return { context, oscillators, gain, calls };
}

function setup() {
  const fake = createFakeContext();
  let created = 0;
  const player = createAudioPlayer(() => {
    created += 1;
    return fake.context;
  });
  return { ...fake, player, created: () => created };
}

/** The oscillators that are making sound right now: started, not stopped. */
const sounding = (oscillators: FakeOscillator[]) => oscillators.filter((oscillator) => oscillator.started && !oscillator.stopped);

describe('createAudioPlayer', () => {
  it('is silent by default and creates no AudioContext until sound is turned on', () => {
    const { player, oscillators, created } = setup();

    player.setTone(440);

    expect(created()).toBe(0);
    expect(oscillators).toHaveLength(0);
  });

  it('creates and resumes the AudioContext when sound is turned on, once', () => {
    const { player, calls, created } = setup();

    expect(player.setEnabled(true)).toBe(true);
    expect(player.setEnabled(false)).toBe(false);
    expect(player.setEnabled(true)).toBe(true);

    expect(created()).toBe(1);
    expect(calls.filter((call) => call === 'resume')).toHaveLength(2);
  });

  it('plays one oscillator at the tone, under the volume ceiling', () => {
    const { player, oscillators, gain } = setup();
    player.setEnabled(true);

    player.setTone(262);

    expect(sounding(oscillators)).toHaveLength(1);
    expect(sounding(oscillators)[0]?.frequency.value).toBe(262);
    expect(['sine', 'triangle']).toContain(sounding(oscillators)[0]?.type);
    expect(gain.gain.value).toBe(GAIN_CEILING);
    expect(GAIN_CEILING).toBeGreaterThan(0);
    expect(GAIN_CEILING).toBeLessThanOrEqual(0.2);
  });

  it('begins a note a few milliseconds after it is asked for, never sooner and never at once', () => {
    const { player, oscillators } = setup();
    player.setEnabled(true);

    player.setTone(262);

    expect(oscillators[0]?.startedAt).toBe(NOW + START_LEAD_S);
    expect(START_LEAD_S).toBeGreaterThan(0);
    expect(START_LEAD_S).toBeLessThanOrEqual(0.05);
  });

  it('plays two notes of one pitch in a row as two notes: the first is stopped at once, the second begins after a short silence', () => {
    const { player, oscillators, gain } = setup();
    player.setEnabled(true);

    // What the core does at the end of one note and the start of the next: both inside one task.
    player.setTone(262);
    player.setTone(undefined);
    player.setTone(262);

    expect(oscillators).toHaveLength(2);
    expect(oscillators[0]?.stopped).toBe(true);
    expect(oscillators[1]?.stopped).toBe(false);
    expect(oscillators[1]?.startedAt).toBeGreaterThan(NOW);
    expect(oscillators[1]?.frequency.value).toBe(262);
    expect(gain.gain.value).toBe(GAIN_CEILING);
  });

  it('changes the pitch of the sounding note without a second oscillator', () => {
    const { player, oscillators } = setup();
    player.setEnabled(true);
    player.setTone(262);

    player.setTone(294);

    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.frequency.value).toBe(294);
  });

  it('silences at once when the tone ends: gain 0 and the oscillator stopped', () => {
    const { player, oscillators, gain } = setup();
    player.setEnabled(true);
    player.setTone(262);

    player.setTone(undefined);

    expect(gain.gain.value).toBe(0);
    expect(oscillators[0]?.stopped).toBe(true);
    expect(oscillators[0]?.disconnected).toBe(true);
    expect(sounding(oscillators)).toHaveLength(0);
  });

  it('plays the next note on a fresh oscillator (a stopped one cannot start again)', () => {
    const { player, oscillators } = setup();
    player.setEnabled(true);
    player.setTone(262);
    player.setTone(undefined);

    player.setTone(330);

    expect(oscillators).toHaveLength(2);
    expect(sounding(oscillators)).toHaveLength(1);
    expect(sounding(oscillators)[0]?.frequency.value).toBe(330);
  });

  it('silences at once when sound is turned off, and plays the tone that is still sounding when it is turned on', () => {
    const { player, oscillators, gain } = setup();
    player.setEnabled(true);
    player.setTone(440);

    player.setEnabled(false);
    expect(gain.gain.value).toBe(0);
    expect(sounding(oscillators)).toHaveLength(0);

    player.setTone(494);
    expect(sounding(oscillators)).toHaveLength(0);

    player.setEnabled(true);
    expect(sounding(oscillators)).toHaveLength(1);
    expect(sounding(oscillators)[0]?.frequency.value).toBe(494);
    expect(gain.gain.value).toBe(GAIN_CEILING);
  });

  it('plays a tone that was given before sound was turned on', () => {
    const { player, oscillators } = setup();
    player.setTone(392);

    player.setEnabled(true);

    expect(sounding(oscillators)[0]?.frequency.value).toBe(392);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('treats %s Hz as silence', (hz) => {
    const { player, oscillators } = setup();
    player.setEnabled(true);
    player.setTone(440);

    player.setTone(hz);

    expect(sounding(oscillators)).toHaveLength(0);
  });

  it('stops everything and closes the context on dispose, once', () => {
    const { player, oscillators, gain, calls } = setup();
    player.setEnabled(true);
    player.setTone(440);

    player.dispose();
    player.dispose();

    expect(gain.gain.value).toBe(0);
    expect(sounding(oscillators)).toHaveLength(0);
    expect(calls.filter((call) => call === 'close')).toHaveLength(1);
  });

  it('does nothing after dispose', () => {
    const { player, oscillators, created } = setup();
    player.dispose();

    expect(player.setEnabled(true)).toBe(false);
    player.setTone(440);

    expect(created()).toBe(0);
    expect(oscillators).toHaveLength(0);
  });

  it('is not enabled when the browser cannot make an AudioContext', () => {
    const player = createAudioPlayer(() => {
      throw new Error('no audio');
    });

    expect(player.setEnabled(true)).toBe(false);
    expect(() => player.setTone(440)).not.toThrow();
  });

  it('survives a context that refuses to resume or to close', async () => {
    const fake = createFakeContext();
    const refusing: AudioContextLike = {
      ...fake.context,
      resume: () => Promise.reject(new Error('not allowed')),
      close: () => Promise.reject(new Error('already closed')),
    };
    const player = createAudioPlayer(() => refusing);

    player.setEnabled(true);
    player.dispose();
    // The rejections are handled inside the player: nothing is left for the test runner to report.
    await Promise.resolve();
  });

  // The player is called from inside the run (a snapshot listener): a Web Audio failure that escaped would end the
  // learner's program, so it only ever means silence.
  describe('when the browser audio fails', () => {
    it('does not throw when an oscillator cannot be created, and plays the next note once it can', () => {
      const fake = createFakeContext();
      let failures = 1;
      const create = fake.context.createOscillator.bind(fake.context);
      const flaky: AudioContextLike = {
        ...fake.context,
        createOscillator() {
          if (failures > 0) {
            failures -= 1;
            throw new DOMException('The context is closed', 'InvalidStateError');
          }
          return create();
        },
      };
      const player = createAudioPlayer(() => flaky);
      player.setEnabled(true);

      expect(() => player.setTone(262)).not.toThrow();
      expect(fake.gain.gain.value).toBe(0);
      expect(fake.oscillators).toHaveLength(0);

      expect(() => player.setTone(440)).not.toThrow();
      expect(sounding(fake.oscillators)).toHaveLength(1);
      expect(sounding(fake.oscillators)[0]?.frequency.value).toBe(440);
    });

    it('does not throw, and keeps no broken node, when an oscillator cannot start', () => {
      const fake = createFakeContext();
      let failures = 1;
      const create = fake.context.createOscillator.bind(fake.context);
      const flaky: AudioContextLike = {
        ...fake.context,
        createOscillator() {
          const oscillator = create();
          if (failures > 0) {
            failures -= 1;
            oscillator.start = () => {
              throw new DOMException('Cannot start', 'InvalidStateError');
            };
          }
          return oscillator;
        },
      };
      const player = createAudioPlayer(() => flaky);
      player.setEnabled(true);

      expect(() => player.setTone(262)).not.toThrow();
      expect(fake.gain.gain.value).toBe(0);
      expect(fake.oscillators[0]?.stopped).toBe(true);

      player.setTone(294);
      expect(fake.oscillators).toHaveLength(2);
      expect(sounding(fake.oscillators)).toEqual([fake.oscillators[1]]);
    });

    it('does not throw when a node cannot be stopped, and does not reuse it for the next note', () => {
      const fake = createFakeContext();
      const player = createAudioPlayer(() => fake.context);
      player.setEnabled(true);
      player.setTone(262);
      const first = fake.oscillators[0];
      expect(first).toBeDefined();
      if (first) {
        first.stop = () => {
          throw new DOMException('Cannot stop', 'InvalidStateError');
        };
      }

      expect(() => player.setTone(undefined)).not.toThrow();
      expect(fake.gain.gain.value).toBe(0);

      expect(() => player.setTone(330)).not.toThrow();
      expect(fake.oscillators).toHaveLength(2);
      expect(fake.oscillators[1]?.frequency.value).toBe(330);
    });

    it('does not throw when the context cannot resume, and does not throw when disposed with nodes that will not stop', () => {
      const fake = createFakeContext();
      const refusing: AudioContextLike = {
        ...fake.context,
        resume: () => {
          throw new DOMException('Cannot resume', 'InvalidStateError');
        },
        close: () => {
          throw new DOMException('Cannot close', 'InvalidStateError');
        },
      };
      const player = createAudioPlayer(() => refusing);

      expect(() => player.setEnabled(true)).not.toThrow();
      player.setTone(262);
      const node = fake.oscillators[0];
      if (node) {
        node.stop = () => {
          throw new DOMException('Cannot stop', 'InvalidStateError');
        };
      }

      expect(() => player.dispose()).not.toThrow();
      expect(() => player.setTone(440)).not.toThrow();
    });
  });
});

// YB3-A1: what the player owns (oscillator, gain node, AudioContext) is released one resource at a time, whatever
// happens to the others. The browser below writes every acquire and release to a log as `<context number>:<operation>`
// BEFORE it may throw, so a step that was attempted is in the log whether it failed or not; the tests read that log
// (cleanup accounting) and not only that nothing was thrown.

type Op =
  | 'createGain'
  | 'gain.connect'
  | 'gain.disconnect'
  | 'oscillator.connect'
  | 'oscillator.start'
  | 'oscillator.stop'
  | 'oscillator.disconnect'
  | 'context.close';

/**
 * A browser that numbers its AudioContexts from 1, logs every operation, and throws from the operations listed in
 * `failing`. The list is read when an operation is called, so a test can change it between two attempts.
 */
function createAccountingBrowser(failing: Op[] = []) {
  const log: string[] = [];
  const gains: { gain: { value: number } }[] = [];
  let contexts = 0;
  const createContext = (): AudioContextLike => {
    contexts += 1;
    const id = contexts;
    const step = (op: Op) => {
      log.push(`${id}:${op}`);
      if (failing.includes(op)) {
        throw new DOMException(`${op} failed`, 'InvalidStateError');
      }
    };
    return {
      destination: 'destination',
      currentTime: NOW,
      createGain() {
        step('createGain');
        const node = { gain: { value: Number.NaN }, connect: () => step('gain.connect'), disconnect: () => step('gain.disconnect') };
        gains.push(node);
        return node;
      },
      createOscillator: () => ({
        type: 'sine',
        frequency: { value: 0 },
        connect: () => step('oscillator.connect'),
        start: () => step('oscillator.start'),
        stop: () => step('oscillator.stop'),
        disconnect: () => step('oscillator.disconnect'),
      }),
      resume: () => Promise.resolve(),
      close() {
        step('context.close');
        return Promise.resolve();
      },
    };
  };
  return { createContext, log, gains, contextCount: () => contexts };
}

/** The entries of the log about one operation, in order. */
const entriesOf = (log: string[], op: Op) => log.filter((entry) => entry.endsWith(`:${op}`));

/** A player with sound turned on and a note sounding (context 1), and a view of the log from that point on: the cleanup only. */
function startPlaying(failing: Op[] = []) {
  const browser = createAccountingBrowser(failing);
  const player = createAudioPlayer(browser.createContext);
  expect(player.setEnabled(true)).toBe(true);
  player.setTone(262);
  const mark = browser.log.length;
  return { ...browser, player, failing, since: () => browser.log.slice(mark) };
}

/** Everything a sounding player owns, released in the order the player is meant to release it. */
const RELEASE_ALL = ['1:oscillator.stop', '1:oscillator.disconnect', '1:gain.disconnect', '1:context.close'];

describe('a start that fails half way releases what it got (YB3-A1, partial initialization)', () => {
  it('createGain throws after the context was created: the context is closed, once, and sound stays off', () => {
    const browser = createAccountingBrowser(['createGain']);
    const player = createAudioPlayer(browser.createContext);

    expect(player.setEnabled(true)).toBe(false);

    expect(browser.log).toEqual(['1:createGain', '1:context.close']);
    expect(() => player.setTone(262)).not.toThrow();
    expect(browser.log).toEqual(['1:createGain', '1:context.close']);
  });

  it('gain.connect throws: the gain node that was created is disconnected, then the context is closed', () => {
    const browser = createAccountingBrowser(['gain.connect']);
    const player = createAudioPlayer(browser.createContext);

    expect(player.setEnabled(true)).toBe(false);

    expect(browser.log).toEqual(['1:createGain', '1:gain.connect', '1:gain.disconnect', '1:context.close']);
  });

  it('gain.connect throws and the gain node will not disconnect either: the context is still closed', () => {
    const browser = createAccountingBrowser(['gain.connect', 'gain.disconnect']);
    const player = createAudioPlayer(browser.createContext);

    expect(() => player.setEnabled(true)).not.toThrow();

    expect(browser.log).toEqual(['1:createGain', '1:gain.connect', '1:gain.disconnect', '1:context.close']);
  });

  it('createGain throws and the context will not close: setEnabled still answers false and throws nothing', () => {
    const browser = createAccountingBrowser(['createGain', 'context.close']);
    const player = createAudioPlayer(browser.createContext);

    const answers: boolean[] = [];
    expect(() => answers.push(player.setEnabled(true))).not.toThrow();

    expect(answers).toEqual([false]);
    expect(browser.log).toEqual(['1:createGain', '1:context.close']);
  });

  it('a context that closes by rejecting its promise is handled, with nothing left unhandled', async () => {
    const browser = createAccountingBrowser(['createGain']);
    const rejecting = (): AudioContextLike => ({ ...browser.createContext(), close: () => Promise.reject(new Error('already closed')) });
    const player = createAudioPlayer(rejecting);

    expect(player.setEnabled(true)).toBe(false);
    // An unhandled rejection would be reported by the test runner as an error of this test.
    await Promise.resolve();

    expect(browser.log).toEqual(['1:createGain']);
  });

  it.each<Op>(['createGain', 'gain.connect'])('repeated failed attempts (%s throws) close every context they opened, once each', (op) => {
    const browser = createAccountingBrowser([op]);
    const player = createAudioPlayer(browser.createContext);
    const attemptsOf = (id: number) =>
      op === 'createGain' ? [`${id}:createGain`, `${id}:context.close`] : [`${id}:createGain`, `${id}:gain.connect`, `${id}:gain.disconnect`, `${id}:context.close`];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(player.setEnabled(true)).toBe(false);
    }

    expect(browser.contextCount()).toBe(5);
    expect(entriesOf(browser.log, 'context.close')).toEqual([1, 2, 3, 4, 5].map((id) => `${id}:context.close`));
    expect(browser.log).toEqual([1, 2, 3, 4, 5].flatMap(attemptsOf));
  });

  it('after failed attempts a working one keeps its context open, and dispose closes that one too, exactly once', () => {
    const failing: Op[] = ['createGain'];
    const browser = createAccountingBrowser(failing);
    const player = createAudioPlayer(browser.createContext);
    expect(player.setEnabled(true)).toBe(false);
    expect(player.setEnabled(true)).toBe(false);

    failing.length = 0;
    expect(player.setEnabled(true)).toBe(true);

    expect(browser.contextCount()).toBe(3);
    expect(entriesOf(browser.log, 'context.close')).toEqual(['1:context.close', '2:context.close']);

    player.dispose();
    player.dispose();

    expect(entriesOf(browser.log, 'context.close')).toEqual(['1:context.close', '2:context.close', '3:context.close']);
    expect(entriesOf(browser.log, 'gain.disconnect')).toEqual(['3:gain.disconnect']);
  });
});

describe('dispose releases every resource, each step on its own (YB3-A1, best-effort disposal)', () => {
  it('releases in order: oscillator stop, oscillator disconnect, gain disconnect, context close, each once', () => {
    const world = startPlaying();

    world.player.dispose();

    expect(world.since()).toEqual(RELEASE_ALL);
    expect(world.gains.map((node) => node.gain.value)).toEqual([0]);
  });

  const single: { failing: Op[] }[] = [
    { failing: ['oscillator.stop'] },
    { failing: ['oscillator.disconnect'] },
    { failing: ['gain.disconnect'] },
    { failing: ['context.close'] },
  ];
  it.each(single)('when $failing throws, the steps after it are still attempted', ({ failing }) => {
    const world = startPlaying(failing);

    expect(() => world.player.dispose()).not.toThrow();

    expect(world.since()).toEqual(RELEASE_ALL);
  });

  const several: { failing: Op[] }[] = [
    { failing: ['oscillator.stop', 'gain.disconnect'] },
    { failing: ['oscillator.disconnect', 'context.close'] },
    { failing: ['oscillator.stop', 'oscillator.disconnect', 'context.close'] },
    { failing: ['oscillator.stop', 'oscillator.disconnect', 'gain.disconnect', 'context.close'] },
  ];
  it.each(several)('when several steps throw independently ($failing), every one of the four is still attempted, once', ({ failing }) => {
    const world = startPlaying(failing);

    expect(() => world.player.dispose()).not.toThrow();

    expect(world.since()).toEqual(RELEASE_ALL);
  });

  it('with no note sounding there is no oscillator to release, and a gain node that will not disconnect does not keep the context open', () => {
    const browser = createAccountingBrowser(['gain.disconnect']);
    const player = createAudioPlayer(browser.createContext);
    player.setEnabled(true);
    const mark = browser.log.length;

    expect(() => player.dispose()).not.toThrow();

    expect(browser.log.slice(mark)).toEqual(['1:gain.disconnect', '1:context.close']);
  });

  it('a player that never turned sound on has nothing to release: dispose touches no context', () => {
    const browser = createAccountingBrowser();
    const player = createAudioPlayer(browser.createContext);

    player.dispose();

    expect(browser.log).toEqual([]);
    expect(browser.contextCount()).toBe(0);
  });

  it('disposing again, or using the player afterwards, attempts no cleanup a second time even when every step failed', () => {
    const world = startPlaying(['oscillator.stop', 'oscillator.disconnect', 'gain.disconnect', 'context.close']);

    expect(() => world.player.dispose()).not.toThrow();
    const afterFirst = world.since();
    expect(afterFirst).toEqual(RELEASE_ALL);

    world.player.dispose();
    world.player.dispose();
    expect(world.player.setEnabled(true)).toBe(false);
    world.player.setTone(440);
    expect(world.player.setEnabled(false)).toBe(false);
    world.player.setTone(undefined);

    expect(world.since()).toEqual(afterFirst);
    expect(world.contextCount()).toBe(1);
    expect(world.gains.map((node) => node.gain.value)).toEqual([0]);
  });

  it('twice on a working player: one release of each resource, not two', () => {
    const world = startPlaying();

    world.player.dispose();
    world.player.dispose();

    expect(world.since()).toEqual(RELEASE_ALL);
  });
});

describe('a node that will not stop or disconnect does not keep the rest from being released (YB3-A1)', () => {
  it.each<Op>(['oscillator.stop', 'oscillator.disconnect'])('when the tone ends and %s throws, both steps are attempted, the gain is 0 and the next note has a fresh oscillator', (op) => {
    const world = startPlaying([op]);

    expect(() => world.player.setTone(undefined)).not.toThrow();

    expect(world.since()).toEqual(['1:oscillator.stop', '1:oscillator.disconnect']);
    expect(world.gains.map((node) => node.gain.value)).toEqual([0]);

    world.failing.length = 0;
    expect(() => world.player.setTone(330)).not.toThrow();
    expect(entriesOf(world.log, 'oscillator.start')).toHaveLength(2);
    expect(world.gains.map((node) => node.gain.value)).toEqual([GAIN_CEILING]);
  });

  it.each<Op>(['oscillator.connect', 'oscillator.start'])('an oscillator that was created but fails at %s is stopped and disconnected, and not kept', (op) => {
    const failing: Op[] = [];
    const browser = createAccountingBrowser(failing);
    const player = createAudioPlayer(browser.createContext);
    player.setEnabled(true);
    // From here on the operation throws: the first note is the one that fails half way.
    failing.push(op);
    const mark = browser.log.length;

    expect(() => player.setTone(262)).not.toThrow();

    const reached = op === 'oscillator.connect' ? ['1:oscillator.connect'] : ['1:oscillator.connect', '1:oscillator.start'];
    expect(browser.log.slice(mark)).toEqual([...reached, '1:oscillator.stop', '1:oscillator.disconnect']);
    expect(browser.gains.map((node) => node.gain.value)).toEqual([0]);

    // The broken node was let go: the next note is made on a new oscillator (a second connect), and it sounds.
    failing.length = 0;
    expect(() => player.setTone(294)).not.toThrow();
    expect(entriesOf(browser.log, 'oscillator.connect')).toHaveLength(2);
    expect(browser.gains.map((node) => node.gain.value)).toEqual([GAIN_CEILING]);
  });
});
