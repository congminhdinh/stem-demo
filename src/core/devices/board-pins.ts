import type { DeviceDefinition } from './device-definition';

// Which pins of a board a program may use (YB plan §8.1, §12). A pin is usable for a capability when the
// board's data gives it that capability (digital when it lists none) and it is not reserved. This is the
// one place that rule is written: the blocks' dropdowns, the compiler and the run all ask it.

/** The pin capabilities a board's data can name (the schema's list). */
export type PinCapabilityId = 'digital' | 'analogIn' | 'pwm' | 'servo' | 'pulse';

/** The ones a program reaches in this phase: PWM is EXCLUDED (C-26), servo is YB-7 (C-27), pulse is EXCLUDED (C-28). */
export type HeaderPinCapability = Extract<PinCapabilityId, 'digital' | 'analogIn'>;

/** The names of the pins of `definition` a program may use for `capability`, in board order. */
export function usablePins(definition: DeviceDefinition, capability: PinCapabilityId): string[] {
  const reserved = new Set(definition.board?.reservedPins ?? []);
  return (definition.board?.pins ?? [])
    .filter((pin) => !reserved.has(pin.name) && (pin.capabilities ?? ['digital']).includes(capability))
    .map((pin) => pin.name);
}

/**
 * What the compiler must know about the board a program is for (plan §10: "the compiler takes the capability
 * set"): the capability ids the board has, and the pins usable for each pin capability a construct needs.
 */
export type BoardTarget = {
  capabilities: readonly string[];
  pins: Readonly<Record<HeaderPinCapability, readonly string[]>>;
};

export function boardTargetOf(definition: DeviceDefinition, capabilities: readonly string[]): BoardTarget {
  return {
    capabilities,
    pins: {
      digital: usablePins(definition, 'digital'),
      analogIn: usablePins(definition, 'analogIn'),
    },
  };
}

/** A target with no capability at all: what a compile gets when nobody says which board the program is for. */
export const noBoardTarget: BoardTarget = {
  capabilities: [],
  pins: { digital: [], analogIn: [] },
};
