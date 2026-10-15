// The sound of the buzzer, as a UI adapter (plan §11.5, §20): the core reports a frequency in the snapshot
// and this plays it. It holds no meaning of its own: the tone it is given is the tone it plays, one
// oscillator at a time, and silence is the default in every sense. Sound is off until a click turns it on
// (the browser lets an AudioContext start only from a user gesture), the volume has a ceiling, and a tone
// that ends, a sound that is turned off or a player that is disposed is silenced at once, not faded (a new note, on
// the other hand, begins a few milliseconds late: START_LEAD_S).
// Sound only presents the run: a Web Audio call that fails makes the player silent and never throws, because the
// player is called from inside the run (a snapshot listener), where a throw would end the learner's program.
// What the player owns (oscillator, gain node, context) is released one resource at a time, each step on its own, so
// a step that fails never keeps the ones after it from running, and a start that fails half way lets go of what it got.
// No global AudioContext, no listener and no timer: whoever owns the player calls it.

export type AudioParamLike = { value: number };

export type OscillatorLike = {
  type: OscillatorType;
  readonly frequency: AudioParamLike;
  connect(destination: unknown): unknown;
  disconnect(): void;
  /** `when` is on the clock of the context, in seconds; left out it is now. */
  start(when?: number): void;
  stop(): void;
};

export type GainLike = {
  readonly gain: AudioParamLike;
  connect(destination: unknown): unknown;
  disconnect(): void;
};

/** The part of `AudioContext` the player uses; a test passes a fake that has only this. */
export type AudioContextLike = {
  readonly destination: unknown;
  /** Seconds on the context's own clock. */
  readonly currentTime: number;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  resume(): Promise<void>;
  close(): Promise<void>;
};

export type AudioPlayer = {
  /**
   * Turns sound on or off and returns whether it is on. Turning it on must be called from a user gesture
   * (a click): that is when the AudioContext is created and resumed. It returns false when the browser
   * has no audio to give.
   */
  setEnabled(enabled: boolean): boolean;
  /** The tone to play, in Hz; undefined is silence. Remembered while sound is off, played when it is turned on. */
  setTone(hz: number | undefined): void;
  /** Stops everything and closes the context. Safe to call twice; the player does nothing afterwards. */
  dispose(): void;
};

/** A modest ceiling for a gain node (1 is full scale): a note must never be a shock, on any speaker. */
export const GAIN_CEILING = 0.1;

/**
 * A note begins this long after it is asked for. The core ends one note and starts the next in the same task, so
 * without it two notes of one pitch would run into each other as a single long tone; with it there is a short silence
 * between them, as when a player lifts and presses a key again. It is how the sound is performed (presentation,
 * contract §6.3), not what the board plays. Stopping is never delayed.
 */
export const START_LEAD_S = 0.015;

const defaultContext = (): AudioContextLike => new AudioContext();

/**
 * One cleanup step, on its own: a step that throws must not keep the steps after it from running, since every
 * resource the player owns has to be released whatever became of the others. Best effort: there is nothing more to do
 * for a resource the browser will not release.
 */
const attempt = (step: () => void): void => {
  try {
    step();
  } catch {
    // Swallowed on purpose; the learner's program must not end because a Web Audio node would not let go.
  }
};

/** Lets go of the gain node and then of the context, each tried on its own; one that is missing is skipped. A close that rejects is handled too. */
const release = (gain: GainLike | null | undefined, owner: AudioContextLike | null | undefined): void => {
  attempt(() => {
    if (gain) {
      gain.disconnect();
    }
  });
  attempt(() => {
    if (owner) {
      owner.close().catch(() => undefined);
    }
  });
};

export function createAudioPlayer(createContext: () => AudioContextLike = defaultContext): AudioPlayer {
  let context: AudioContextLike | null = null;
  let master: GainLike | null = null;
  let oscillator: OscillatorLike | null = null;
  let enabled = false;
  let tone: number | undefined;
  let disposed = false;

  // Gain first, then the oscillator: the sound is gone even if stopping the node were to fail. The node is let go
  // before it is stopped, so one that cannot be stopped is not kept for the next note. Stopping and disconnecting are
  // tried separately, so a node that will not stop is still disconnected. It never throws.
  const silence = () => {
    const node = oscillator;
    oscillator = null;
    attempt(() => {
      if (master) {
        master.gain.value = 0;
      }
    });
    if (node) {
      attempt(() => node.stop());
      attempt(() => node.disconnect());
    }
  };

  // The context and the gain node the player needs to make a sound. When making them fails half way, what was already
  // made is released (the context is closed, a gain node that was created is disconnected), so that repeated failed
  // attempts to turn sound on do not leave a trail of open contexts. It never throws: the answer is null.
  const open = (): { context: AudioContextLike; gain: GainLike } | null => {
    let created: AudioContextLike | undefined;
    let gain: GainLike | undefined;
    try {
      created = createContext();
      gain = created.createGain();
      gain.gain.value = 0;
      gain.connect(created.destination);
      return { context: created, gain };
    } catch {
      release(gain, created);
      return null;
    }
  };

  const apply = () => {
    if (!context || !master || !enabled || tone === undefined) {
      silence();
      return;
    }
    if (!oscillator) {
      oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.connect(master);
      oscillator.frequency.value = tone;
      oscillator.start(context.currentTime + START_LEAD_S);
    } else {
      oscillator.frequency.value = tone;
    }
    master.gain.value = GAIN_CEILING;
  };

  // `apply`, and when it fails silence (which never throws): whatever goes wrong with the browser's audio, nothing is thrown.
  const refresh = () => {
    try {
      apply();
    } catch {
      silence();
    }
  };

  return {
    setEnabled(next) {
      if (disposed) {
        return false;
      }
      if (next && !context) {
        const opened = open();
        if (!opened) {
          return false;
        }
        context = opened.context;
        master = opened.gain;
      }
      enabled = next;
      if (next) {
        try {
          context?.resume().catch(() => undefined);
        } catch {
          // A context that cannot resume stays silent; the text indicator still tells what the buzzer does.
        }
      }
      refresh();
      return enabled;
    },
    setTone(hz) {
      if (disposed) {
        return;
      }
      tone = hz !== undefined && Number.isFinite(hz) && hz > 0 ? hz : undefined;
      refresh();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      enabled = false;
      tone = undefined;
      // Oscillator stop, oscillator disconnect, gain disconnect, context close: each tried once, on its own, whatever
      // became of the one before. The references are dropped after that; a second dispose returns at the top and
      // tries nothing again.
      silence();
      const gain = master;
      const owner = context;
      master = null;
      context = null;
      release(gain, owner);
    },
  };
}
