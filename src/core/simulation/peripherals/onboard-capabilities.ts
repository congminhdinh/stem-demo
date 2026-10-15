import type { CapabilityFactory } from '../../run/run-session';
import { peripheralComponentId } from '../simulate-circuit';
import { createButtonIO } from './buttons';
import { createDisplayIO } from './display';
import { createLightIO } from './light';
import { createSoundIO } from './sound';

// The onboard parts of a Yolo:Bit-compatible board as capabilities (plan §10, YB-3): the display, the two buttons,
// the light sensor and the buzzer. This is the factory the composition root hands to `createRunSession`. It uses
// only what the frozen `RunEnvironment` gives (YB-CP amendment 1): `input` and `takePresses` to read the world,
// `report` to show state, and nothing else. It returns exactly its own capability keys, so a factory that adds the
// header pins (YB-4) composes with it by key; `RunSession` does not know any of them by name.

/** The ids of the onboard parts (`ybc-board.json`); the definition is the source, a test pins the two together. */
export const displayPartId = 'display';
export const buzzerPartId = 'buzzer';
export const lightPartId = 'light';
export const buttonPartId = (button: 'a' | 'b') => `button-${button}`;

export const createOnboardCapabilities: CapabilityFactory = (environment) => {
  const part = (partId: string) => peripheralComponentId(environment.board.id, partId);
  return {
    display: createDisplayIO((state) => environment.report(part(displayPartId), state)),
    buttons: createButtonIO({
      input: (button) => environment.input(part(buttonPartId(button))),
      takePresses: (button) => environment.takePresses(part(buttonPartId(button))),
    }),
    light: createLightIO(() => environment.input(part(lightPartId))),
    sound: createSoundIO((state) => environment.report(part(buzzerPartId), state)),
  };
};
