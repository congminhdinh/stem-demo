import { useEffect, useRef, useState } from 'react';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { createAudioPlayer, type AudioPlayer } from './audio-player';
import { describeTone, toneHz } from './tone';

type SoundIndicatorProps = {
  /** The buzzer's state in the run snapshot (`<board>/buzzer`), as drawn; absent while idle or silent. Only for the text. */
  buzzer: ComponentState | undefined;
  /**
   * The frequency the buzzer plays, told at every change, as it happens (not at most once per frame like `buzzer`),
   * and undefined for silence. The sound follows this, because a note that ends and the next that starts in one task
   * are two notes to the ear, and a hidden tab draws no frames at all. Returns the way to stop listening.
   */
  tones: (listener: (hz: number | undefined) => void) => () => void;
};

/**
 * What the buzzer is doing as text, and the switch for hearing it. The text comes from the snapshot only
 * and says the same whether sound is on or not (the sound is never the only signal, plan §19). Sound is
 * off until the learner turns it on. An idle run has no buzzer state, so Stop silences the player at once.
 */
export function SoundIndicator({ buzzer, tones }: SoundIndicatorProps) {
  const hz = toneHz(buzzer);
  const [enabled, setEnabled] = useState(false);
  const player = useRef<AudioPlayer | null>(null);

  // The player lives as long as this component: a replaced or unloaded project cannot leave a sound behind.
  useEffect(() => {
    const created = createAudioPlayer();
    player.current = created;
    return () => {
      created.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => tones((tone) => player.current?.setTone(tone)), [tones]);

  // In the click handler itself, so the AudioContext starts from a user gesture.
  const toggle = () => setEnabled(player.current?.setEnabled(!enabled) ?? false);

  return (
    <div className="sound-indicator">
      {/* The label says what a click does and changes with the state; aria-pressed as well would announce the state twice. */}
      <button type="button" onClick={toggle}>
        {enabled ? 'Turn sound off' : 'Turn sound on'}
      </button>
      <span className={hz === undefined ? 'sound-state' : 'sound-state sound-state-playing'} data-testid="sound-indicator">
        {describeTone(hz)}
      </span>
    </div>
  );
}
