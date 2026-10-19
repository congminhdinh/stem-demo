import { describe, expect, expectTypeOf, it } from 'vitest';
import { blankFrame } from '../capabilities/frame';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import {
  copyComponentInput, eventKindOfModel, inputKindOfModel, isComponentInput, peripheralComponentId, sameComponentState, simulateCircuit, splitPeripheralComponentId,
  type ComponentInput, type ComponentState, type SimulationInputs, type SimulationResult, type ToneState,
} from './simulate-circuit';

// YB-CP deliverables 2 and 3: the runtime input representation and the snapshot / peripheral state shape (plan §11.2-§11.4).

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('ComponentInput (plan §11.3)', () => {
  it.each<[string, unknown, boolean]>([
    ['hold, closed', { kind: 'hold', closed: true }, true],
    ['hold, open', { kind: 'hold', closed: false }, true],
    ['slider, whole number', { kind: 'slider', value: 42 }, true],
    ['slider, zero', { kind: 'slider', value: 0 }, true],
    ['tilt', { kind: 'tilt', x: -1, y: 0.5 }, true],
    ['gesture', { kind: 'gesture' }, true],
    ['hold without closed', { kind: 'hold' }, false],
    ['hold with a string', { kind: 'hold', closed: 'yes' }, false],
    ['slider, fraction', { kind: 'slider', value: 1.5 }, false],
    ['slider, NaN', { kind: 'slider', value: NaN }, false],
    ['slider, string', { kind: 'slider', value: '3' }, false],
    ['tilt, missing y', { kind: 'tilt', x: 1 }, false],
    ['tilt, NaN', { kind: 'tilt', x: NaN, y: 0 }, false],
    ['unknown kind', { kind: 'shake' }, false],
    ['no kind', {}, false],
    ['null', null, false],
    ['a string', 'hold', false],
  ])('%s', (_label, value, valid) => {
    expect(isComponentInput(value)).toBe(valid);
  });

  it('has exactly the four controls of the plan, and a hold is what a push button already takes', () => {
    expectTypeOf<ComponentInput['kind']>().toEqualTypeOf<'hold' | 'slider' | 'tilt' | 'gesture'>();
    const press: ComponentInput = { kind: 'hold', closed: true };
    expect(press).toEqual({ kind: 'hold', closed: true });
  });
});

describe('component ids of onboard parts: <board>/<peripheral>', () => {
  it('joins and splits them, at the last slash', () => {
    expect(peripheralComponentId('ybc-board-1', 'button-a')).toBe('ybc-board-1/button-a');
    expect(splitPeripheralComponentId('ybc-board-1/button-a')).toEqual({ boardId: 'ybc-board-1', peripheralId: 'button-a' });
    expect(splitPeripheralComponentId('odd/id/with/slashes/light')).toEqual({ boardId: 'odd/id/with/slashes', peripheralId: 'light' });
  });

  it('does not take a plain component id, or an id with an empty side, for a peripheral', () => {
    for (const id of ['led', 'button', '', '/', '/light', 'board/']) {
      expect(splitPeripheralComponentId(id), id).toBeNull();
    }
  });

  it('is never produced by the current simulation: no onboard part has a model at YB-CP', () => {
    const board = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 0, y: 0 } };
    const result = simulateCircuit({ components: [board], wires: [] }, registry, { powered: true, pinOutputs: {} });
    expect(Object.keys(result.components).filter((id) => id.includes('/'))).toEqual([]);
  });
});

describe('copyComponentInput: the run’s own copy of an input (CP-A3)', () => {
  const inputs: ComponentInput[] = [
    { kind: 'hold', closed: true },
    { kind: 'hold', closed: false },
    { kind: 'slider', value: 42 },
    { kind: 'tilt', x: -1, y: 0.5 },
    { kind: 'gesture' },
  ];

  it.each(inputs)('copies %j into a distinct object that says the same', (input) => {
    const copy = copyComponentInput(input);
    expect(copy).toEqual(input);
    expect(copy).not.toBe(input);
  });

  it('shares nothing with the original: editing either leaves the other alone', () => {
    const original = { kind: 'slider' as const, value: 10 };
    const copy = copyComponentInput(original) as { kind: 'slider'; value: number };
    original.value = 77;
    expect(copy.value).toBe(10);
    copy.value = 5;
    expect(original.value).toBe(77);
  });

  it('keeps only what the kind says, in one order, so equal inputs are equal as text', () => {
    const noisy = { source: 'keyboard', closed: true, kind: 'hold' } as ComponentInput;
    expect(JSON.stringify(copyComponentInput(noisy))).toBe('{"kind":"hold","closed":true}');
    expect(JSON.stringify(copyComponentInput({ y: 2, x: 1, kind: 'tilt' } as ComponentInput))).toBe(JSON.stringify(copyComponentInput({ kind: 'tilt', x: 1, y: 2 })));
  });
});

describe('sameComponentState: the same state whatever the order of its properties (CP-A4)', () => {
  const frame = (pixel: string | null = null) => ({ pixels: Array.from({ length: 25 }, (_, index) => (index === 12 ? pixel : null)) }) as NonNullable<ComponentState['frame']>;

  it('does not depend on the order the properties were written in', () => {
    expect(sameComponentState({ hz: 440, value: 1, lit: true }, { lit: true, value: 1, hz: 440 })).toBe(true);
    expect(sameComponentState({ frame: frame('#FF0000'), hz: 1 }, { hz: 1, frame: frame('#FF0000') })).toBe(true);
  });

  it('takes a property that is undefined for a property that is absent, and an empty state for an empty state', () => {
    expect(sameComponentState({ value: 1, hz: undefined }, { value: 1 })).toBe(true);
    expect(sameComponentState({ frame: undefined }, {})).toBe(true);
    expect(sameComponentState({}, {})).toBe(true);
  });

  it.each<[string, ComponentState, ComponentState]>([
    ['a scalar', { hz: 440 }, { hz: 441 }],
    ['a scalar against none', { hz: 440 }, {}],
    ['a different property', { hz: 1 }, { value: 1 }],
    ['one pixel', { frame: frame('#FF0000') }, { frame: frame('#00FF00') }],
    ['a pixel on against off', { frame: frame('#FF0000') }, { frame: frame(null) }],
    ['a frame against none', { frame: frame() }, {}],
    ['a frame that is shorter', { frame: frame() }, { frame: { pixels: frame().pixels.slice(0, 24) } }],
    ['a false against none (lit)', { lit: false }, {}],
  ])('tells %s apart', (_label, a, b) => {
    expect(sameComponentState(a, b)).toBe(false);
    expect(sameComponentState(b, a)).toBe(false);
  });

  it('tells a sparse frame from a blank one: a hole is not an off pixel', () => {
    expect(sameComponentState({ frame: { pixels: new Array(25) } }, { frame: frame() })).toBe(false);
  });

  it('knows every field of ComponentState: a change of any of them is a difference', () => {
    const scalars = ['lit', 'closed', 'brightness', 'value', 'hz', 'angle'] as const;
    // If ComponentState gains a field, the type test of the snapshot shape fails first and this list is revisited.
    expectTypeOf<keyof ComponentState>().toEqualTypeOf<(typeof scalars)[number] | 'frame'>();
    for (const key of scalars) {
      const a = { [key]: key === 'lit' || key === 'closed' ? true : 1 } as ComponentState;
      const b = { [key]: key === 'lit' || key === 'closed' ? false : 2 } as ComponentState;
      expect(sameComponentState(a, b), key).toBe(false);
      expect(sameComponentState(a, { ...a }), key).toBe(true);
    }
  });

  it('is safe in the direction that matters: a property it does not know, when it differs, is a difference, and NaN is the same as NaN', () => {
    expect(sameComponentState({ hz: 1, extra: 1 } as ComponentState, { hz: 1, extra: 2 } as ComponentState)).toBe(false);
    expect(sameComponentState({ hz: NaN }, { hz: NaN })).toBe(true);
  });
});

describe('SimulationInputs.inputs: one transport for every control (YB-CP amendment 1)', () => {
  const circuit = {
    components: [
      { id: 'board', deviceType: 'board', position: { x: 0, y: 0 } },
      { id: 'led', deviceType: 'led', position: { x: 100, y: 0 } },
      { id: 'button', deviceType: 'push-button', position: { x: 200, y: 0 } },
    ],
    wires: [],
  };
  const base = { powered: true, pinOutputs: { D13: 1 as const }, contacts: { button: true } };

  it('is the same ComponentInput the controls already use, by component id, with no field per kind of control', () => {
    expectTypeOf<NonNullable<SimulationInputs['inputs']>>().toEqualTypeOf<Readonly<Record<string, ComponentInput>>>();
    expectTypeOf<keyof SimulationInputs>().toEqualTypeOf<'powered' | 'pinOutputs' | 'contacts' | 'inputs'>();
  });

  it('changes nothing for the models that exist, whatever it carries: no model takes an input yet', () => {
    const without = simulateCircuit(circuit, registry, base);
    const inputs = {
      led: { kind: 'slider', value: 7 },
      button: { kind: 'hold', closed: false },
      'ybc-board-1/light': { kind: 'slider', value: 50 },
      nobody: { kind: 'gesture' },
    } satisfies Record<string, ComponentInput>;
    expect(JSON.stringify(simulateCircuit(circuit, registry, { ...base, inputs }))).toBe(JSON.stringify(without));
    expect(JSON.stringify(simulateCircuit(circuit, registry, { ...base, inputs: {} }))).toBe(JSON.stringify(without));
  });
});

describe('the models of the onboard parts take the input the plan gives them', () => {
  it('maps each model of the ybc-board that has a control to its kind, and the display and buzzer to none', () => {
    const onboard = registry.get('ybc-board').board?.onboard ?? [];
    const models = Object.fromEntries(onboard.map((part) => [part.id, inputKindOfModel[part.model] ?? null]));
    expect(models).toEqual({ display: null, 'button-a': 'hold', 'button-b': 'hold', light: 'slider', buzzer: null, temperature: 'slider', accelerometer: 'tilt' });
  });

  it('gives the accelerometer a one-shot event besides its tilt (N17 B2: a shake), and no other model one', () => {
    expect(eventKindOfModel).toEqual({ accelerometer: 'gesture' });
  });

  it('takes a tilt with or without z (N17 B2: z absent is face up, a positive z face down), and copies z only when it is there', () => {
    expect(isComponentInput({ kind: 'tilt', x: 1, y: 2 })).toBe(true);
    expect(isComponentInput({ kind: 'tilt', x: 1, y: 2, z: 1024 })).toBe(true);
    expect(isComponentInput({ kind: 'tilt', x: 1, y: 2, z: Number.NaN })).toBe(false);
    expect(isComponentInput({ kind: 'tilt', x: 1, y: 2, z: '3' })).toBe(false);
    expect(copyComponentInput({ kind: 'tilt', x: 1, y: 2 })).toEqual({ kind: 'tilt', x: 1, y: 2 });
    expect(Object.keys(copyComponentInput({ kind: 'tilt', x: 1, y: 2 }))).toEqual(['kind', 'x', 'y']);
    expect(copyComponentInput({ kind: 'tilt', x: 1, y: 2, z: 1024 })).toEqual({ kind: 'tilt', x: 1, y: 2, z: 1024 });
  });

  it('covers the sensor and motion models of plan §11.2 that have a control, and the one device of the circuit that takes a slider', () => {
    // `analog-source` is the one data line YB-4 adds (the potentiometer): the amendment note names it.
    expect(inputKindOfModel).toEqual({
      button: 'hold',
      'light-sensor': 'slider',
      'temperature-sensor': 'slider',
      accelerometer: 'tilt',
      'analog-source': 'slider',
    });
  });
});

describe('snapshot shape (plan §11.4)', () => {
  it('extends ComponentState with the peripheral fields, all optional, and ToneState is the hz of a playing note', () => {
    const generic: ComponentState = { lit: true };
    const peripheral: ComponentState = { brightness: 0.5, value: 40, frame: blankFrame(), hz: 262, angle: 90, closed: false };
    const tone: ToneState = { hz: 440 };
    expect([generic.lit, peripheral.hz, tone.hz]).toEqual([true, 262, 440]);
    expectTypeOf<keyof ComponentState>().toEqualTypeOf<'lit' | 'closed' | 'brightness' | 'value' | 'frame' | 'hz' | 'angle'>();
    expectTypeOf<ToneState>().toEqualTypeOf<{ hz: number }>();
  });

  it('keeps a generic snapshot exactly as it was: only lit and closed, nothing else (GB4)', () => {
    const circuit = {
      components: [
        { id: 'board', deviceType: 'board', position: { x: 0, y: 0 } },
        { id: 'led', deviceType: 'led', position: { x: 100, y: 0 } },
      ],
      wires: [],
    };
    const result: SimulationResult = simulateCircuit(circuit, registry, { powered: true, pinOutputs: {} });
    for (const state of Object.values(result.components)) {
      expect(Object.keys(state).every((key) => key === 'lit' || key === 'closed')).toBe(true);
    }
    expect(Object.keys(result).sort()).toEqual(['components', 'nets', 'pinReads']);
  });
});
