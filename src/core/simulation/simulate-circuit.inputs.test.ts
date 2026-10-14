import { describe, expect, expectTypeOf, it } from 'vitest';
import { blankFrame } from '../capabilities/frame';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import {
  inputKindOfModel, isComponentInput, peripheralComponentId, simulateCircuit, splitPeripheralComponentId,
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
    expect(models).toEqual({ display: null, 'button-a': 'hold', 'button-b': 'hold', light: 'slider', buzzer: null });
  });

  it('covers the sensor and motion models of plan §11.2 that have a control', () => {
    expect(inputKindOfModel).toEqual({ button: 'hold', 'light-sensor': 'slider', 'temperature-sensor': 'slider', accelerometer: 'tilt' });
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
