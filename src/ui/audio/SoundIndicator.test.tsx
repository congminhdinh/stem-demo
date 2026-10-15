// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { GAIN_CEILING } from './audio-player';
import { SoundIndicator } from './SoundIndicator';

// The indicator against a fake AudioContext put in the global scope: what the learner reads comes from the
// snapshot alone, and what they hear is the player's, which is off until the toggle is clicked.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  resumed = 0;
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
    this.resumed += 1;
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  /** What can be heard: oscillators started and not stopped. */
  sounding() {
    return this.oscillators.filter((oscillator) => oscillator.started && !oscillator.stopped);
  }
}

/** The feed of tones the indicator listens to (App makes it from the session's snapshots): `emit` is a change of the buzzer as it happens. */
let listeners: Set<(hz: number | undefined) => void>;
const tones = (listener: (hz: number | undefined) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const emit = (hz: number | undefined) => act(async () => listeners.forEach((listener) => listener(hz)));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  listeners = new Set();
  FakeAudioContext.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (buzzer: ComponentState | undefined, strict = false) =>
  act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <SoundIndicator buzzer={buzzer} tones={tones} />
        </StrictMode>
      ) : (
        <SoundIndicator buzzer={buzzer} tones={tones} />
      ),
    ),
  );
const toggle = () => container.querySelector<HTMLButtonElement>('button') as HTMLButtonElement;
const indicator = () => container.querySelector('[data-testid="sound-indicator"]')?.textContent;
const click = () => act(async () => toggle().click());
const context = () => FakeAudioContext.instances[0] as FakeAudioContext;

describe('SoundIndicator', () => {
  it('starts with sound off: a native toggle that says so, no audio created, and a text that says silent', async () => {
    await render(undefined);

    expect(toggle().type).toBe('button');
    expect(toggle().textContent).toBe('Turn sound on');
    // The label says what a click does and changes with the state: aria-pressed as well would announce the state twice.
    expect(toggle().hasAttribute('aria-pressed')).toBe(false);
    expect(indicator()).toBe('Silent');
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('says what the buzzer plays, from the snapshot, whether or not sound is on', async () => {
    await render({ hz: 262 });
    expect(indicator()).toBe('Playing 262 Hz');
    expect(FakeAudioContext.instances).toHaveLength(0);

    await click();
    expect(indicator()).toBe('Playing 262 Hz');

    await render(undefined);
    expect(indicator()).toBe('Silent');
  });

  it('does not make a sound until the learner clicks: the click creates and resumes the audio, and the toggle says so', async () => {
    await render({ hz: 330 });
    await emit(330);
    expect(FakeAudioContext.instances).toHaveLength(0);

    await click();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context().resumed).toBe(1);
    expect(toggle().textContent).toBe('Turn sound off');
    expect(toggle().hasAttribute('aria-pressed')).toBe(false);
    // The note that is already sounding is heard, at the ceiling volume.
    expect(context().sounding().map((oscillator) => oscillator.frequency.value)).toEqual([330]);
    expect(context().gain.gain.value).toBe(GAIN_CEILING);
  });

  it('follows the feed: the next note changes the sound, and an idle run (Stop) silences at once', async () => {
    await render(undefined);
    await click();

    await emit(262);
    expect(context().sounding().map((oscillator) => oscillator.frequency.value)).toEqual([262]);
    await emit(294);
    expect(context().sounding().map((oscillator) => oscillator.frequency.value)).toEqual([294]);

    await emit(undefined);
    expect(context().sounding()).toHaveLength(0);
    expect(context().gain.gain.value).toBe(0);
  });

  it('hears two notes of one pitch as two notes, though the drawn buzzer (one snapshot per frame) never shows the silence between them', async () => {
    // The frame showed the buzzer sounding and nothing else: the text prop does not change at all.
    await render({ hz: 262 });
    await click();

    await emit(262);
    await emit(undefined);
    await emit(262);

    expect(indicator()).toBe('Playing 262 Hz');
    expect(context().oscillators).toHaveLength(2);
    expect(context().oscillators[0]?.stopped).toBe(true);
    expect(context().sounding()).toHaveLength(1);
    // The second note begins a moment after "now" on the clock of the context: the short silence between the two.
    expect(context().oscillators[1]?.startedAt).toBeGreaterThan(context().currentTime);
  });

  it('turns the sound off with the toggle, at once, while the indicator goes on saying what plays', async () => {
    await render({ hz: 440 });
    await emit(440);
    await click();
    expect(context().sounding()).toHaveLength(1);

    await click();

    expect(toggle().textContent).toBe('Turn sound on');
    expect(context().sounding()).toHaveLength(0);
    expect(indicator()).toBe('Playing 440 Hz');
  });

  it('works under StrictMode, where the effects run twice: one context, one listener, and the first player is gone', async () => {
    await render({ hz: 262 }, true);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(listeners.size).toBe(1);

    await click();
    await emit(262);

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(context().sounding()).toHaveLength(1);
  });

  it('leaves no sound and no listener behind when it goes away (another project is loaded)', async () => {
    await render({ hz: 262 });
    await click();
    await emit(262);
    expect(context().sounding()).toHaveLength(1);
    expect(listeners.size).toBe(1);

    await act(async () => root.render(<div />));

    expect(context().sounding()).toHaveLength(0);
    expect(context().gain.gain.value).toBe(0);
    expect(context().closed).toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('stays off, and says so, in a browser with no audio', async () => {
    vi.unstubAllGlobals();
    await render({ hz: 262 });

    await click();

    expect(toggle().textContent).toBe('Turn sound on');
    expect(indicator()).toBe('Playing 262 Hz');
  });
});
