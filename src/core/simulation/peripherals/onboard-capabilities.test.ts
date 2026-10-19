import { describe, expect, it } from 'vitest';
import { blankFrame } from '../../capabilities/frame';
import { composeCapabilities } from '../../capabilities/compose';
import type { Capabilities } from '../../capabilities/io';
import { createRuntimeServices } from '../../capabilities/services';
import { localDeviceDefinitions } from '../../devices/local-catalog';
import { createDeviceRegistry } from '../../devices/registry';
import { capabilitiesOf } from '../../profiles/board-context';
import { createRunConsole } from '../../program/console';
import type { CapabilityFactory, RunEnvironment } from '../../run/run-session';
import { inputKindOfModel, splitPeripheralComponentId, type ComponentInput, type ComponentState } from '../simulate-circuit';
import { scrollFrame } from './display';
import { LIGHT_LEVEL_INITIAL } from './light';
import {
  accelerometerPartId, buttonPartId, buzzerPartId, createOnboardCapabilities, displayPartId, lightPartId, temperaturePartId,
} from './onboard-capabilities';
import { TEMPERATURE_INITIAL } from './temperature';

// The onboard parts of a Yolo:Bit-compatible board as capabilities (plan §10, YB-3). The factory is built against a
// recording stand-in for the frozen RunEnvironment (YB-CP amendment 1): it may read `input`, `takePresses` and
// `report` and the id of the board, and nothing else. `simulation()` and `drivePin()` throw if they are called, and a
// proxy records every property that is read, so a factory that reached for them could not pass unnoticed.

const registry = createDeviceRegistry(localDeviceDefinitions);
const ybcBoard = registry.get('ybc-board');
const onboard = ybcBoard.board?.onboard ?? [];

type Report = { id: string; state: ComponentState | null };

type Recording = {
  environment: RunEnvironment;
  /** The ids `input` was asked for, in order. */
  inputs: string[];
  /** The ids `takePresses` was asked for, in order. */
  presses: string[];
  /** The ids `sinceEvent` was asked for, in order (N17 B2). */
  events: string[];
  reports: Report[];
  /** Every property of the environment that was read, by name. */
  read: Set<string>;
};

function recordingEnvironment(
  boardId = 'ybc-board-1',
  world: {
    inputs?: Readonly<Record<string, ComponentInput>>;
    presses?: Readonly<Record<string, readonly number[]>>;
    /** How many ms ago each part's latest one-shot event was (N17 B2: a shake). */
    since?: Readonly<Record<string, number>>;
  } = {},
): Recording {
  const inputs: string[] = [];
  const presses: string[] = [];
  const events: string[] = [];
  const reports: Report[] = [];
  const read = new Set<string>();
  const queued = new Map(Object.entries(world.presses ?? {}).map(([id, counts]) => [id, [...counts]]));
  const target: RunEnvironment = {
    board: { id: boardId, deviceType: 'ybc-board', position: { x: 0, y: 0 } },
    capabilitySet: capabilitiesOf(ybcBoard),
    services: createRuntimeServices({ signal: new AbortController().signal, console: createRunConsole() }),
    input(componentId) {
      inputs.push(componentId);
      return world.inputs?.[componentId];
    },
    takePresses(componentId) {
      presses.push(componentId);
      return queued.get(componentId)?.shift() ?? 0;
    },
    sinceEvent(componentId) {
      events.push(componentId);
      return world.since?.[componentId];
    },
    report(componentId, state) {
      reports.push({ id: componentId, state });
    },
    simulation() {
      throw new Error('The onboard parts must not read the simulation');
    },
    drivePin() {
      throw new Error('The onboard parts must not drive a pin');
    },
    warn() {
      throw new Error('The onboard parts have no warning of their own');
    },
  };
  const environment = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'string') {
        read.add(property);
      }
      return Reflect.get(object, property, receiver) as unknown;
    },
  });
  return { environment, inputs, presses, events, reports, read };
}

/** Uses every capability once, so everything the factory can reach is reached. */
function exerciseAll(capabilities: Capabilities) {
  capabilities.display?.setFrame(blankFrame());
  capabilities.sound?.startTone(262);
  capabilities.sound?.stopTone();
  capabilities.buttons?.isPressed('a');
  capabilities.buttons?.isPressed('b');
  capabilities.buttons?.takePresses?.('a');
  capabilities.buttons?.takePresses?.('b');
  capabilities.light?.lightLevel();
  capabilities.temperature?.temperature();
  capabilities.motion?.acceleration('x');
  capabilities.motion?.gesture?.();
}

describe('createOnboardCapabilities', () => {
  it('returns exactly display, buttons, light and sound, and the temperature and motion of N17 B2, and no other capability', () => {
    const capabilities = createOnboardCapabilities(recordingEnvironment().environment);
    expect(Object.keys(capabilities).sort()).toEqual(['buttons', 'display', 'light', 'motion', 'sound', 'temperature']);
    for (const key of ['buttons', 'display', 'light', 'sound', 'temperature', 'motion'] as const) {
      expect(capabilities[key], key).toBeDefined();
    }
    for (const missing of ['digital', 'analogIn', 'pwm', 'servo', 'pulse'] as const) {
      expect(capabilities[missing], missing).toBeUndefined();
    }
  });

  it('builds without asking the run for anything and without reporting anything', () => {
    const { environment, inputs, presses, events, reports } = recordingEnvironment();
    createOnboardCapabilities(environment);
    // The run does not exist yet while the factory runs, so a report then would be ignored (amendment 1).
    expect([inputs, presses, events, reports]).toEqual([[], [], [], []]);
  });

  it('is built for the board it is given, again for each run, with nothing shared between two', () => {
    const first = createOnboardCapabilities(recordingEnvironment().environment);
    const second = createOnboardCapabilities(recordingEnvironment().environment);
    expect(first.display).not.toBe(second.display);
    expect(first.buttons).not.toBe(second.buttons);
  });
});

describe('what the factory reaches of the environment', () => {
  it('reads only input, takePresses, sinceEvent (N17 B2) and report, and the id of the board: never simulation() or drivePin()', () => {
    const { environment, read } = recordingEnvironment();
    // The stand-in throws if simulation() or drivePin() is called, so a call would fail this test at once.
    exerciseAll(createOnboardCapabilities(environment));
    expect([...read].sort()).toEqual(['board', 'input', 'report', 'sinceEvent', 'takePresses']);
    for (const untouched of ['simulation', 'drivePin', 'warn', 'services', 'capabilitySet']) {
      expect(read.has(untouched), untouched).toBe(false);
    }
  });

  it('uses the ids <boardId>/display, /button-a, /button-b, /light, /buzzer, /temperature and /accelerometer, each for its own part', () => {
    const { environment, inputs, presses, events, reports } = recordingEnvironment('ybc-board-1');
    const capabilities = createOnboardCapabilities(environment);

    capabilities.buttons?.isPressed('a');
    capabilities.buttons?.isPressed('b');
    capabilities.buttons?.takePresses?.('a');
    capabilities.buttons?.takePresses?.('b');
    capabilities.light?.lightLevel();
    capabilities.temperature?.temperature();
    capabilities.motion?.acceleration('z');
    capabilities.motion?.gesture?.();
    capabilities.display?.setFrame(blankFrame());
    capabilities.sound?.startTone(262);

    expect(inputs).toEqual([
      'ybc-board-1/button-a', 'ybc-board-1/button-b', 'ybc-board-1/light', 'ybc-board-1/temperature', 'ybc-board-1/accelerometer', 'ybc-board-1/accelerometer',
    ]);
    expect(presses).toEqual(['ybc-board-1/button-a', 'ybc-board-1/button-b']);
    expect(events).toEqual(['ybc-board-1/accelerometer']);
    expect(reports.map((report) => report.id)).toEqual(['ybc-board-1/display', 'ybc-board-1/buzzer']);
  });

  it('keeps a board id that has a slash intact: the part id is whatever follows the last slash', () => {
    const { environment, inputs, reports } = recordingEnvironment('saved/ybc');
    const capabilities = createOnboardCapabilities(environment);
    capabilities.light?.lightLevel();
    capabilities.display?.setFrame(blankFrame());
    expect(inputs).toEqual(['saved/ybc/light']);
    expect(reports.map((report) => report.id)).toEqual(['saved/ybc/display']);
    expect(splitPeripheralComponentId('saved/ybc/light')).toEqual({ boardId: 'saved/ybc', peripheralId: 'light' });
  });
});

describe('the part ids against the definition of ybc-board', () => {
  const ids = {
    display: displayPartId,
    'button-a': buttonPartId('a'),
    'button-b': buttonPartId('b'),
    light: lightPartId,
    buzzer: buzzerPartId,
    temperature: temperaturePartId,
    accelerometer: accelerometerPartId,
  };

  it('are the ids of the onboard parts of the definition, which the factory uses and no other', () => {
    expect(Object.values(ids)).toEqual(Object.keys(ids));
    expect(onboard.map((part) => part.id)).toEqual(Object.keys(ids));

    const { environment, inputs, presses, events, reports } = recordingEnvironment('b');
    exerciseAll(createOnboardCapabilities(environment));
    const touched = new Set([...inputs, ...presses, ...events, ...reports.map((report) => report.id)].map((id) => splitPeripheralComponentId(id)?.peripheralId));
    expect([...touched].sort()).toEqual(onboard.map((part) => part.id).sort());
  });

  it('are the parts of the right models and capabilities: a display, two buttons, a light sensor, a buzzer, a temperature sensor, an accelerometer', () => {
    const part = (id: string) => onboard.find((candidate) => candidate.id === id);
    expect(part(displayPartId)).toMatchObject({ model: 'matrix-display', capability: 'display' });
    expect(part(buttonPartId('a'))).toMatchObject({ model: 'button', capability: 'buttons' });
    expect(part(buttonPartId('b'))).toMatchObject({ model: 'button', capability: 'buttons' });
    expect(part(lightPartId)).toMatchObject({ model: 'light-sensor', capability: 'light' });
    expect(part(buzzerPartId)).toMatchObject({ model: 'buzzer', capability: 'sound' });
    expect(part(temperaturePartId)).toMatchObject({ model: 'temperature-sensor', capability: 'temperature' });
    expect(part(accelerometerPartId)).toMatchObject({ model: 'accelerometer', capability: 'motion' });
  });

  it('are read for input exactly where the model takes an input, and reported where it takes none', () => {
    const { environment, inputs, presses, events, reports } = recordingEnvironment();
    exerciseAll(createOnboardCapabilities(environment));
    const modelOf = (id: string) => onboard.find((part) => part.id === splitPeripheralComponentId(id)?.peripheralId)?.model ?? '';
    const takesInput = (id: string) => Object.hasOwn(inputKindOfModel, modelOf(id));
    expect([...inputs, ...presses, ...events].every(takesInput)).toBe(true);
    expect(reports.map((report) => report.id).some(takesInput)).toBe(false);
  });
});

describe('the display', () => {
  it('reports { frame } as the state of the display part when a frame is set', () => {
    const { environment, reports } = recordingEnvironment('b');
    const frame = scrollFrame(['A'], 0);
    createOnboardCapabilities(environment).display?.setFrame(frame);
    expect(reports).toEqual([{ id: 'b/display', state: { frame } }]);
  });

  it('reports the frames one after the other, the last one standing', () => {
    const { environment, reports } = recordingEnvironment('b');
    const display = createOnboardCapabilities(environment).display;
    display?.setFrame(scrollFrame(['A'], 0));
    display?.setFrame(blankFrame());
    expect(reports).toHaveLength(2);
    expect(reports[1]).toEqual({ id: 'b/display', state: { frame: blankFrame() } });
  });
});

describe('the buzzer', () => {
  it('reports { hz } while a note sounds and null when it stops', () => {
    const { environment, reports } = recordingEnvironment('b');
    const sound = createOnboardCapabilities(environment).sound;
    sound?.startTone(440);
    sound?.stopTone();
    expect(reports).toEqual([
      { id: 'b/buzzer', state: { hz: 440 } },
      { id: 'b/buzzer', state: null },
    ]);
  });
});

describe('the buttons', () => {
  it('read the hold of each button from the run', () => {
    const { environment } = recordingEnvironment('b', { inputs: { 'b/button-a': { kind: 'hold', closed: true }, 'b/button-b': { kind: 'hold', closed: false } } });
    const buttons = createOnboardCapabilities(environment).buttons;
    expect(buttons?.isPressed('a')).toBe(true);
    expect(buttons?.isPressed('b')).toBe(false);
  });

  it('take the presses the run counted, for the button asked, and the run starts the count again', () => {
    const { environment } = recordingEnvironment('b', { presses: { 'b/button-a': [3], 'b/button-b': [1, 2] } });
    const buttons = createOnboardCapabilities(environment).buttons;
    expect(buttons?.takePresses?.('a')).toBe(3);
    expect(buttons?.takePresses?.('a')).toBe(0);
    expect(buttons?.takePresses?.('b')).toBe(1);
    expect(buttons?.takePresses?.('b')).toBe(2);
  });
});

describe('the light sensor', () => {
  it('reads the slider of the light part as the level', () => {
    const { environment } = recordingEnvironment('b', { inputs: { 'b/light': { kind: 'slider', value: 80 } } });
    expect(createOnboardCapabilities(environment).light?.lightLevel()).toBe(80);
  });

  it('reads the initial level when the slider was never moved, or when the input is not a slider', () => {
    expect(createOnboardCapabilities(recordingEnvironment('b').environment).light?.lightLevel()).toBe(LIGHT_LEVEL_INITIAL);
    const held = recordingEnvironment('b', { inputs: { 'b/light': { kind: 'hold', closed: true } } });
    expect(createOnboardCapabilities(held.environment).light?.lightLevel()).toBe(LIGHT_LEVEL_INITIAL);
  });

  it('does not read the slider of another part', () => {
    const { environment } = recordingEnvironment('b', { inputs: { 'b/button-a': { kind: 'slider', value: 10 } } });
    expect(createOnboardCapabilities(environment).light?.lightLevel()).toBe(LIGHT_LEVEL_INITIAL);
  });
});

describe('the temperature sensor and the accelerometer (N17 B2)', () => {
  it('read their own parts: the slider of the temperature, the tilt and the shake of the accelerometer', () => {
    const { environment } = recordingEnvironment('b', {
      inputs: { 'b/temperature': { kind: 'slider', value: 33 }, 'b/accelerometer': { kind: 'tilt', x: 0, y: -900 } },
      since: { 'b/accelerometer': 400 },
    });
    const capabilities = createOnboardCapabilities(environment);
    expect(capabilities.temperature?.temperature()).toBe(33);
    expect(capabilities.motion?.acceleration('y')).toBe(-900);
    expect(capabilities.motion?.gesture?.()).toBe('shake');
  });

  it('read 25 °C and lying flat when nothing was given, and do not read another part’s input', () => {
    const { environment } = recordingEnvironment('b', { inputs: { 'b/light': { kind: 'slider', value: 10 }, 'b/button-a': { kind: 'tilt', x: 900, y: 0 } } });
    const capabilities = createOnboardCapabilities(environment);
    expect(capabilities.temperature?.temperature()).toBe(TEMPERATURE_INITIAL);
    expect(['x', 'y', 'z'].map((axis) => capabilities.motion?.acceleration(axis as 'x'))).toEqual([0, 0, -1024]);
    expect(capabilities.motion?.gesture?.()).toBe('face_up');
  });
});

describe('composing with the capabilities of another phase', () => {
  const headerPins: CapabilityFactory = () => ({
    digital: { digitalWrite: () => undefined, digitalRead: () => 0 },
  });

  it('keeps all seven keys when a second factory that only returns { digital } is spread in, in either order', () => {
    const { environment } = recordingEnvironment();
    const onboardParts = createOnboardCapabilities(environment);
    const pins = headerPins(environment);
    const first = { ...onboardParts, ...pins };
    const second = { ...pins, ...onboardParts };
    for (const composed of [first, second]) {
      expect(Object.keys(composed).sort()).toEqual(['buttons', 'digital', 'display', 'light', 'motion', 'sound', 'temperature']);
      // YB-3 is not the only producer of capabilities: its parts stay its own and the pins stay the other factory's.
      expect(composed.digital).toBe(pins.digital);
      expect(composed.display).toBe(onboardParts.display);
      expect(composed.buttons).toBe(onboardParts.buttons);
      expect(composed.light).toBe(onboardParts.light);
      expect(composed.sound).toBe(onboardParts.sound);
    }
  });

  it('is kept whole by the board it is for, and dropped whole by a board without the parts', () => {
    const { environment } = recordingEnvironment();
    const provided = { ...createOnboardCapabilities(environment), ...headerPins(environment) };

    const onYbc = composeCapabilities(capabilitiesOf(ybcBoard), provided);
    expect(onYbc.rejected).toEqual([]);
    expect(Object.keys(onYbc.capabilities).sort()).toEqual(['buttons', 'digital', 'display', 'light', 'motion', 'sound', 'temperature']);

    const onGeneric = composeCapabilities(['digital'], provided);
    expect(onGeneric.rejected.sort()).toEqual(['buttons', 'display', 'light', 'motion', 'sound', 'temperature']);
    expect(Object.keys(onGeneric.capabilities)).toEqual(['digital']);
  });
});
