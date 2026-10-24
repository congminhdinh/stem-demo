import { ANALOG_NATIVE_MAX, percentToNative } from './conversions';
import type { SimulationResult } from './simulate-circuit';

// What a program sees on a header pin of a Yolo:Bit-compatible board (YB plan §11.1, contract C-24 and C-25):
// the signal of the net the pin is on, read from the simulation of the run. Pure functions of a result.
//
// The simulator never guesses a signal the evidence does not define. A net nothing drives (floating), two
// drivers on one net (conflict) and a net at an analog level read as on/off are all a signal a program
// cannot read; the reader of the pin stops the program with `out-of-domain` (domain guard, plan §6.2).

export type PinSignal =
  | { kind: 'high' }
  | { kind: 'low' }
  | { kind: 'analog'; percent: number }
  | { kind: 'floating' }
  | { kind: 'conflict' };

/** The signal on the port of a component (a board pin's `portId`): that of the net the port is on. */
export function pinSignal(result: SimulationResult, componentId: string, portId: string): PinSignal {
  const net = result.nets.find((candidate) =>
    candidate.ports.some((port) => port.componentId === componentId && port.portId === portId),
  );
  switch (net?.level) {
    case 'high':
      return { kind: 'high' };
    case 'low':
      return { kind: 'low' };
    case 'analog':
      return { kind: 'analog', percent: net.analogPercent ?? 0 };
    case 'conflict':
      return { kind: 'conflict' };
    default:
      // A port that is on no net of the result cannot happen for a valid document; it reads as undriven.
      return { kind: 'floating' };
  }
}

/**
 * The native analog value of a signal (contract C-25, C-Q6 = A): a high net is the top of the scale, a low one
 * 0, a wiper its position converted by `percentToNative(p, N)`. N is the board's top (N18 R2.1, `boardScaleOf`),
 * 4095 unless given. Null when the signal has no value.
 */
export function analogValueOf(signal: PinSignal, nativeMax: number = ANALOG_NATIVE_MAX): number | null {
  switch (signal.kind) {
    case 'high':
      return nativeMax;
    case 'low':
      return 0;
    case 'analog':
      return percentToNative(signal.percent, nativeMax);
    default:
      return null;
  }
}
