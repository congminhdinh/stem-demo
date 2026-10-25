// The common trace of the parity harness (N18 C2, ADR 0003 §7 condition 1): what each output pin does, as a list of events, and
// what the program printed. Both sides are reduced to it, then compared; nothing is compared cycle by cycle.
//
// A pin is in one of these states: an input (with or without its pull-up), a steady LOW or HIGH, or a waveform a timer makes:
// PWM of a duty on the 0..255 scale, a servo's pulses for an angle, or a tone. An event is the time a pin entered a state. On the
// simulator that time is exact (the program time after the Arduino call that changed it). On the board a waveform's start shows
// only at the timer's next period, so an event there may be known to lie within [fromUs, toUs]; a level change is exact
// (fromUs = toUs). Times are µs from the start of setup().

export type PinLogicalState =
  | { readonly kind: 'input'; readonly pullup: boolean }
  | { readonly kind: 'low' }
  | { readonly kind: 'high' }
  | { readonly kind: 'pwm'; readonly duty: number }
  | { readonly kind: 'servo'; readonly deg: number }
  | { readonly kind: 'tone'; readonly hz: number };

export type PinEvent = {
  readonly pin: string;
  readonly state: PinLogicalState;
  /** The earliest time the change can have happened. */
  readonly fromUs: number;
  /** The latest; equal to fromUs when the change is exact. */
  readonly toUs: number;
};

/** One line the program printed, with the time (µs from setup()) it was printed or its first byte left the USART. */
export type PrintedLine = { readonly atUs: number; readonly text: string };

export type WaveformKind = 'pwm' | 'servo' | 'tone';

export const isWaveform = (state: PinLogicalState): state is Extract<PinLogicalState, { kind: WaveformKind }> =>
  state.kind === 'pwm' || state.kind === 'servo' || state.kind === 'tone';

export const isExact = (event: PinEvent): boolean => event.fromUs === event.toUs;

/** `pwm 128`, `servo 90°`, `tone 1000 Hz`, `HIGH`, `INPUT_PULLUP`: for messages and reports. */
export function describeState(state: PinLogicalState): string {
  switch (state.kind) {
    case 'input':
      return state.pullup ? 'INPUT_PULLUP' : 'INPUT';
    case 'low':
      return 'LOW';
    case 'high':
      return 'HIGH';
    case 'pwm':
      return `pwm ${state.duty}`;
    case 'servo':
      return `servo ${state.deg}°`;
    case 'tone':
      return `tone ${Number(state.hz.toFixed(3))} Hz`;
  }
}

/** Drops events that repeat the state before them on the same pin (a write of the level a pin already has changes nothing). */
export function withoutRepeats(events: readonly PinEvent[]): PinEvent[] {
  const last = new Map<string, string>();
  const kept: PinEvent[] = [];
  for (const event of events) {
    const key = JSON.stringify(event.state);
    if (last.get(event.pin) !== key) {
      last.set(event.pin, key);
      kept.push(event);
    }
  }
  return kept;
}
