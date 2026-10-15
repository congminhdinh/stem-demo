import type { ButtonId, ButtonIO } from '../../capabilities/io';
import type { ComponentInput } from '../simulate-circuit';

// The two onboard buttons (contract §5): `is_pressed()` is true while the button is held at the call, not latched
// (C-12), and `get_presses()` is the number of presses since the last read, which also starts the count again from
// 0 (C-13). Both live in the run: the latest input is read with `input`, and the presses are counted by the run when
// the input arrives, so a press that began and ended between two reads is not lost. Nothing here counts, listens or
// remembers: A+B (C-47) is EXCLUDED and has no id, events (C-14) are DEFERRED.

export type ButtonParts = {
  /** The latest input of the button, or undefined when it was never touched in this run. */
  input(button: ButtonId): ComponentInput | undefined;
  /** The presses of the button since the last call; reading resets (the frozen `RunEnvironment.takePresses`). */
  takePresses(button: ButtonId): number;
};

export function createButtonIO(parts: ButtonParts): ButtonIO {
  return {
    isPressed(button) {
      const input = parts.input(button);
      return input?.kind === 'hold' && input.closed;
    },
    takePresses(button) {
      return parts.takePresses(button);
    },
  };
}
