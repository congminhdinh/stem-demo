import type { CapabilityFactory } from '../../run/run-session';
import { peripheralComponentId } from '../simulate-circuit';
import { createMotionIO } from './accelerometer';
import { createButtonIO } from './buttons';
import { createDisplayIO } from './display';
import { createLightIO } from './light';
import { createSoundIO } from './sound';
import { createTemperatureIO } from './temperature';

// The onboard parts of a Yolo:Bit-compatible board as capabilities (plan §10, YB-3): the display, the two buttons,
// the light sensor and the buzzer, and since N17 B2 the temperature sensor and the accelerometer. This is the factory the
// composition root hands to `createRunSession`. It uses only what the `RunEnvironment` gives (YB-CP amendment 1): `input`,
// `takePresses` and `sinceEvent` (N17 B2: when the board was last shaken) to read the world, `report` to show state, and
// nothing else. It returns exactly its own capability keys, so a factory that adds the
// header pins (YB-4) composes with it by key; `RunSession` does not know any of them by name.

/** The ids of the onboard parts (`ybc-board.json`); the definition is the source, a test pins the two together. */
export const displayPartId = 'display';
export const buzzerPartId = 'buzzer';
export const lightPartId = 'light';
export const temperaturePartId = 'temperature';
export const accelerometerPartId = 'accelerometer';
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
    temperature: createTemperatureIO(() => environment.input(part(temperaturePartId))),
    motion: createMotionIO({
      input: () => environment.input(part(accelerometerPartId)),
      sinceEvent: () => environment.sinceEvent(part(accelerometerPartId)),
    }),
  };
};
