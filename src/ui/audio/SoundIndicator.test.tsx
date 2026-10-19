// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { GAIN_CEILING } from './audio-player';
import { SoundIndicator } from './SoundIndicator';
import { SOUND_PREFERENCE_KEY } from './sound-preference';
import { useBuzzerSound } from './use-buzzer-sound';

// The buzzer's sound and its switch (N17 B3), against a fake AudioContext put in the global scope (jsdom has none). What the
// learner reads comes from the snapshot alone. What they hear is the player's: on from the start (kept for the tab), started by
// the click of Run (or Check: the app calls the same `unlock` in both handlers), never before a gesture, and turned off and on by
// the switch. The harness is the app's wiring in small: the hook, the indicator, and a Run button that unlocks in its click.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** True while a click is being dispatched: from the first capture listener (document) to the last bubble one (window). */
const gesture = { active: false };
const startGesture = () => {
  gesture.active = true;
};
const endGesture = () => {
  gesture.active = false;
};

class FakeOscillator {
  type = 'sine';
  frequency = { value: 0 };
  started = false;
  startedAt: number | undefined;
  stopped = false;
  connect() {}
  disconnect() {}
  start(when?: number) {
    this.started = true;
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  destination = {};
  currentTime = 5;
  oscillators: FakeOscillator[] = [];
  gain = { gain: { value: Number.NaN }, connect() {}, disconnect() {} };
  closed = false;
  /** Whether each resume came inside a click (the gesture the browser asks for). */
  resumes: boolean[] = [];
  /** Whether the context was made inside a click. */
  createdInGesture = gesture.active;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    return this.gain;
  }
  resume() {
    this.resumes.push(gesture.active);
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  /** What can be heard: oscillators started and not stopped. */
  sounding() {
    return this.oscillators.filter((oscillator) => oscillator.started && !oscillator.stopped).map((oscillator) => oscillator.frequency.value);
  }
}

/** The feed of tones (App makes it from the session's snapshots): `emit` is a change of the buzzer as it happens. */
let listeners: Set<(hz: number | undefined) => void>;
const tones = (listener: (hz: number | undefined) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const emit = (hz: number | undefined) => act(async () => listeners.forEach((listener) => listener(hz)));

function Board({ buzzer, feed = tones, defaultOn = true }: { buzzer: ComponentState | undefined; feed?: typeof tones; defaultOn?: boolean }) {
  const sound = useBuzzerSound(feed, defaultOn);
  return (
    <>
      <button type="button" data-testid="run" onClick={() => sound.unlock()}>
        Run
      </button>
      <SoundIndicator buzzer={buzzer} sound={sound} />
    </>
  );
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  listeners = new Set();
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  sessionStorage.clear();
  document.addEventListener('click', startGesture, true);
  window.addEventListener('click', endGesture);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.removeEventListener('click', startGesture, true);
  window.removeEventListener('click', endGesture);
  vi.unstubAllGlobals();
});

const render = (buzzer: ComponentState | undefined, options: { strict?: boolean; feed?: typeof tones; defaultOn?: boolean } = {}) =>
  act(async () => {
    const board = <Board buzzer={buzzer} {...(options.feed ? { feed: options.feed } : {})} {...(options.defaultOn === undefined ? {} : { defaultOn: options.defaultOn })} />;
    root.render(options.strict ? <StrictMode>{board}</StrictMode> : board);
  });
const toggle = () => container.querySelector<HTMLButtonElement>('.sound-indicator button') as HTMLButtonElement;
const indicator = () => container.querySelector('[data-testid="sound-indicator"]')?.textContent;
const clickToggle = () => act(async () => toggle().click());
const clickRun = () => act(async () => container.querySelector<HTMLButtonElement>('[data-testid="run"]')?.click());
const context = () => FakeAudioContext.instances[0] as FakeAudioContext;

describe('the sound of the buzzer (N17 B3: on from the start, started by Run or Check)', () => {
  it('starts with sound on: the switch says a click turns it off, and nothing is made before a gesture, whatever plays', async () => {
    await render({ hz: 330 });
    await emit(330);

    expect(toggle().type).toBe('button');
    expect(toggle().textContent).toBe('Turn sound off');
    // The label says what a click does and changes with the state: aria-pressed as well would announce the state twice.
    expect(toggle().hasAttribute('aria-pressed')).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('is started by the click of Run: the context is made and resumed inside that gesture, and the note that plays is heard', async () => {
    await render({ hz: 330 });
    await emit(330);

    await clickRun();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context().createdInGesture).toBe(true);
    expect(context().resumes).toEqual([true]);
    expect(context().sounding()).toEqual([330]);
    expect(context().gain.gain.value).toBe(GAIN_CEILING);
  });

  it('resumes the one context at every Run, each inside its click', async () => {
    await render(undefined);

    await clickRun();
    await clickRun();
    await clickRun();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context().resumes).toEqual([true, true, true]);
  });

  it('says what the buzzer plays, from the snapshot, whether or not sound is on or started; with sound off, that it is not heard', async () => {
    await render({ hz: 262 });
    expect(indicator()).toBe('Playing 262 Hz');

    // Fix 6 (N17 c6): the learner who turned the sound off still reads that the program plays, and why nothing is heard.
    await clickToggle();
    expect(indicator()).toBe('Playing 262 Hz (sound off)');

    await render(undefined);
    expect(indicator()).toBe('Silent');
  });

  it('follows the feed: the next note changes the sound, and an idle run (Stop) silences at once', async () => {
    await render(undefined);
    await clickRun();

    await emit(262);
    expect(context().sounding()).toEqual([262]);
    await emit(294);
    expect(context().sounding()).toEqual([294]);

    await emit(undefined);
    expect(context().sounding()).toEqual([]);
    expect(context().gain.gain.value).toBe(0);
  });

  it('hears two notes of one pitch as two notes, though the drawn buzzer (one snapshot per frame) never shows the silence between them', async () => {
    await render({ hz: 262 });
    await clickRun();

    await emit(262);
    await emit(undefined);
    await emit(262);

    expect(indicator()).toBe('Playing 262 Hz');
    expect(context().oscillators).toHaveLength(2);
    expect(context().oscillators[0]?.stopped).toBe(true);
    expect(context().sounding()).toHaveLength(1);
    expect(context().oscillators[1]?.startedAt).toBeGreaterThan(context().currentTime);
  });

  it('is turned off by the switch at once, and Run then makes no sound', async () => {
    await render({ hz: 440 });
    await emit(440);
    await clickRun();
    expect(context().sounding()).toEqual([440]);

    await clickToggle();

    expect(toggle().textContent).toBe('Turn sound on');
    expect(context().sounding()).toEqual([]);
    // Still playing in the run, and the text says it is not heard (Fix 6, N17 c6).
    expect(indicator()).toBe('Playing 440 Hz (sound off)');
    await clickRun();
    await emit(523);
    expect(context().sounding()).toEqual([]);
  });

  it('keeps the learner’s choice for the tab: off stays off after a reload, and a Run makes no context', async () => {
    await render(undefined);
    await clickToggle();
    expect(sessionStorage.getItem(SOUND_PREFERENCE_KEY)).toBe('off');

    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ hz: 262 });
    await emit(262);
    expect(toggle().textContent).toBe('Turn sound on');
    await clickRun();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('is turned on again by the switch, which is a gesture too: the context is made and resumed in its click', async () => {
    sessionStorage.setItem(SOUND_PREFERENCE_KEY, 'off');
    await render({ hz: 392 });
    await emit(392);

    await clickToggle();

    expect(toggle().textContent).toBe('Turn sound off');
    expect(sessionStorage.getItem(SOUND_PREFERENCE_KEY)).toBe('on');
    expect(context().createdInGesture).toBe(true);
    expect(context().resumes).toEqual([true]);
    expect(context().sounding()).toEqual([392]);
  });

  it('starts off when the app asks it to and nothing is kept', async () => {
    await render(undefined, { defaultOn: false });
    expect(toggle().textContent).toBe('Turn sound on');
    await clickRun();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('works under StrictMode, where the effects run twice: one context, one listener, and the first player is gone', async () => {
    await render({ hz: 262 }, { strict: true });
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(listeners.size).toBe(1);

    await clickRun();
    await emit(262);

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context().sounding()).toEqual([262]);
  });

  it('leaves no sound and no listener behind when it goes away (another project is loaded)', async () => {
    await render({ hz: 262 });
    await clickRun();
    await emit(262);
    expect(context().sounding()).toEqual([262]);
    expect(listeners.size).toBe(1);

    await act(async () => root.render(<div />));

    expect(context().sounding()).toEqual([]);
    expect(context().gain.gain.value).toBe(0);
    expect(context().closed).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('leaves no tone of the old feed when the feed changes (another board): silence until the new one says otherwise', async () => {
    const other = new Set<(hz: number | undefined) => void>();
    const otherFeed = (listener: (hz: number | undefined) => void) => {
      other.add(listener);
      return () => {
        other.delete(listener);
      };
    };
    await render({ hz: 262 });
    await clickRun();
    await emit(262);

    await render(undefined, { feed: otherFeed });

    expect(listeners.size).toBe(0);
    expect(other.size).toBe(1);
    expect(context().sounding()).toEqual([]);
  });

  it('stays off, and says so, in a browser with no audio: the switch cannot turn it on and Run does nothing', async () => {
    vi.unstubAllGlobals();
    await render({ hz: 262 });
    expect(toggle().textContent).toBe('Turn sound on');

    await clickToggle();
    await clickRun();

    expect(toggle().textContent).toBe('Turn sound on');
    expect(indicator()).toBe('Playing 262 Hz (sound off)');
  });
});
