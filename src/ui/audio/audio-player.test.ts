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
