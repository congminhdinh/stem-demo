import { capabilityKeys, type Capabilities, type CapabilityKey } from './io';

// Capability composition (YB plan §10, YB-CP deliverable 6): a board offers only the capabilities it
// really has, and a program only ever reaches those. The board context says which ones (its pin
// `capabilities` and onboard `capability` ids, a `CapabilitySet`); an implementation that offers more
// than the board has is dropped, never handed to the program.

const known = new Set<string>(capabilityKeys);

/** The capability keys a board context's set names, in the order of `capabilityKeys`. Unknown ids are not capabilities. */
export function availableCapabilityKeys(set: readonly string[]): CapabilityKey[] {
  const names = new Set(set);
  return capabilityKeys.filter((key) => names.has(key));
}

/** The keys of `required` the board does not have: the `capability-unavailable` of the compiler (plan §10), once ops exist. */
export function missingCapabilities(set: readonly string[], required: readonly CapabilityKey[]): CapabilityKey[] {
  const names = new Set(set);
  return required.filter((key) => !names.has(key));
}

export type ComposedCapabilities = {
  /** Only what the board has. */
  capabilities: Capabilities;
  /** Implementations offered for a capability the board does not have. */
  rejected: CapabilityKey[];
};

export function composeCapabilities(set: readonly string[], provided: Capabilities): ComposedCapabilities {
  const allowed = new Set<string>(availableCapabilityKeys(set));
  const capabilities: Capabilities = {};
  const rejected: CapabilityKey[] = [];
  for (const key of Object.keys(provided)) {
    if (!known.has(key) || provided[key as CapabilityKey] === undefined) {
      continue;
    }
    if (allowed.has(key)) {
      Object.assign(capabilities, { [key]: provided[key as CapabilityKey] });
    } else {
      rejected.push(key as CapabilityKey);
    }
  }
  return { capabilities, rejected };
}
