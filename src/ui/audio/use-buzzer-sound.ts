import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, type AudioPlayer } from './audio-player';
import { readSoundOn, writeSoundOn } from './sound-preference';

// The sound of the buzzer for the app (N17 B3): one player for as long as the app is up, the tones it follows, and the
// learner's switch. Sound is on from the start (`defaultOn`; the learner's choice for the tab wins) and starts with the click of
// Run or Check: the app calls `unlock` in those handlers, synchronously, since a browser lets an AudioContext start only from a
// user gesture. That works in a frame too (the lab inside the LMS): the click is a gesture of the frame's own document. The
// switch turns sound off at once and on again (a click as well, so it unlocks too).

/** The feed of the buzzer's tones (App makes it from the run's snapshots): undefined is silence. Returns the way to stop listening. */
export type ToneFeed = (listener: (hz: number | undefined) => void) => () => void;

export type BuzzerSound = {
  /** Whether sound is on (the switch): what a click of the switch would turn off. */
  readonly on: boolean;
  /** The switch, from its click: off silences at once; on starts the sound in that gesture. Kept for the tab. */
  toggle(): void;
  /** From the click of Run or Check: starts the sound when it is on. */
  unlock(): void;
};

/** Whether the browser can make sound at all: without Web Audio the switch stays off and says so. */
const audioAvailable = () => typeof globalThis.AudioContext === 'function';

export function useBuzzerSound(tones: ToneFeed, defaultOn: boolean): BuzzerSound {
  const [on, setOn] = useState(() => audioAvailable() && readSoundOn(defaultOn));
  const player = useRef<AudioPlayer | null>(null);
  // What the player is made with (the effect runs once): the switch as it is when the app starts.
  const initiallyOn = useRef(on);

  // The player lives as long as the app: a replaced or unloaded project cannot leave a sound behind (its run stops, and the feed
  // says silence), and the player itself is disposed when the app goes.
  useEffect(() => {
    const created = createAudioPlayer(undefined, { enabled: initiallyOn.current });
    player.current = created;
    return () => {
      created.dispose();
      player.current = null;
    };
  }, []);

  // A feed that goes (another board, the app unmounting) leaves no tone of its own behind.
  useEffect(() => {
    const stop = tones((tone) => player.current?.setTone(tone));
    return () => {
      stop();
      player.current?.setTone(undefined);
    };
  }, [tones]);

  const toggle = useCallback(() => {
    const wanted = !on;
    const next = player.current?.setEnabled(wanted) ?? false;
    setOn(next);
    // Kept only when it is what the learner asked for: a browser that cannot make sound does not turn the choice into "off".
    if (next === wanted) {
      writeSoundOn(next);
    }
  }, [on]);

  const unlock = useCallback(() => player.current?.unlock(), []);

  return { on, toggle, unlock };
}
