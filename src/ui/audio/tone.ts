import type { ComponentState } from '../../core/simulation/simulate-circuit';

// What the snapshot says about the buzzer, read for the UI (plan §11.5): the core knows the frequency
// and when it sounds, and everything here (the drawn buzzer, the text indicator, the audio) only reads that.

/** The tone a buzzer state says is sounding, in Hz; anything but a positive finite number is silence. */
export function toneHz(state: ComponentState | undefined): number | undefined {
  const hz = state?.hz;
  return typeof hz === 'number' && Number.isFinite(hz) && hz > 0 ? hz : undefined;
}

/** "262 Hz": the notes of the contract are whole numbers (§8.1), so rounding only guards the reading. */
export const formatHz = (hz: number) => `${Math.round(hz)} Hz`;

/** The text indicator: what is sounding, whether or not sound is turned on. */
export const describeTone = (hz: number | undefined) => (hz === undefined ? 'Silent' : `Playing ${formatHz(hz)}`);
