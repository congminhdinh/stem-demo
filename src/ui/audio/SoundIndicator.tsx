import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { useText } from '../i18n/text';
import { formatHz, toneHz } from './tone';
import type { BuzzerSound } from './use-buzzer-sound';

type SoundIndicatorProps = {
  /** The buzzer's state in the run snapshot (`<board>/buzzer`), as drawn; absent while idle or silent. Only for the text. */
  buzzer: ComponentState | undefined;
  /** The app's sound (useBuzzerSound): whether it is on, and the switch. */
  sound: Pick<BuzzerSound, 'on' | 'toggle'>;
};

/**
 * What the buzzer is doing as text, and the switch for hearing it (N17 B3: a mute switch; the sound is on from the start and is
 * started by Run or Check). The text comes from the snapshot only and says the same whether sound is on or not (the sound is never
 * the only signal, plan §19). An idle run has no buzzer state, so Stop silences at once.
 */
export function SoundIndicator({ buzzer, sound }: SoundIndicatorProps) {
  const hz = toneHz(buzzer);
  const t = useText();

  return (
    <div className="sound-indicator">
      {/* The label says what a click does and changes with the state; aria-pressed as well would announce the state twice. */}
      <button type="button" onClick={sound.toggle}>
        {sound.on ? t('sound.turnOff') : t('sound.turnOn')}
      </button>
      <span className={hz === undefined ? 'sound-state' : 'sound-state sound-state-playing'} data-testid="sound-indicator">
        {hz === undefined ? t('sound.silent') : t('sound.playing', { hz: formatHz(hz) })}
      </span>
    </div>
  );
}
