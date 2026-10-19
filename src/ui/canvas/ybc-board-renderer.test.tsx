// @vitest-environment jsdom
import Konva from 'konva';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Circuit } from '../../core/circuit/document';
import { blankFrame, type Frame, type HexColour } from '../../core/capabilities/frame';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { resolveBoardContext } from '../../core/profiles/board-context';
import type { ComponentInput, SimulationResult } from '../../core/simulation/simulate-circuit';
import { readCanvasState } from './canvas-test-state';
import { CircuitCanvas, partStatesOf } from './CircuitCanvas';

// The Yolo:Bit-compatible board as the canvas renders it: what is DRAWN (read back from the Konva nodes the
// way the E2E hook reads them) comes from the run snapshot alone. Konva needs a 2D canvas, which jsdom does not
// have, so the context is a stand-in that accepts every call: the node tree is real, the pixels are not.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createDeviceRegistry(localDeviceDefinitions);
const ybcBoardDefinition = registry.get('ybc-board');
const red: HexColour = '#FF0000';

function fakeContext2d() {
  const values = new Map<string | symbol, unknown>();
  return new Proxy(
    {},
    {
      get(_target, name) {
        if (name === 'measureText') {
          return () => ({ width: 8 });
        }
        if (name === 'getImageData') {
          // Konva checks that a canvas does not scramble colours (anti-fingerprinting): it must read back what it wrote.
          return () => ({ data: Uint8ClampedArray.from({ length: 400 }, (_, index) => (index % 4 === 3 ? 255 : 40)) });
        }
        return values.has(name) ? values.get(name) : () => undefined;
      },
      set(_target, name, value) {
        values.set(name, value);
        return true;
      },
    },
  );
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext2d() as never);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ybcCircuit: Circuit = {
  components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }],
  wires: [],
};
const genericCircuit: Circuit = {
  components: [{ id: 'board', deviceType: 'board', position: { x: 300, y: 200 } }],
  wires: [],
};

const simulation = (components: SimulationResult['components']): SimulationResult => ({ nets: [], components, pinReads: {} });
const frameOf = (...lit: number[]): Frame => ({ pixels: blankFrame().pixels.map((_, index) => (lit.includes(index) ? red : null)) });

function render(
  circuit: Circuit,
  profile: string | undefined,
  run: SimulationResult | null,
  inputs?: Record<string, ComponentInput>,
  events?: Record<string, number>,
) {
  const context = resolveBoardContext({ profile, circuit }, registry, productionProfiles);
  return act(async () =>
    root.render(
      <CircuitCanvas
        circuit={circuit}
        registry={registry}
        context={context}
        simulation={run}
        locked={run !== null}
        onCircuitChange={() => undefined}
        onContactChange={() => undefined}
        {...(inputs ? { inputs } : {})}
        {...(events ? { events } : {})}
      />,
    ),
  );
}

const board = () => {
  const component = readCanvasState()?.components[0];
  if (!component) {
    throw new Error('The canvas has no component');
  }
  return component;
};
const stage = () => Konva.stages.at(-1) as Konva.Stage;
const groupNamed = (name: string) => stage().findOne<Konva.Group>(name);
const allOff = Array.from({ length: 25 }, () => null);

describe('the display on the canvas', () => {
  it('draws every cell off while idle', async () => {
    await render(ybcCircuit, 'ybc-basic', null);

    expect(board().display).toEqual(allOff);
  });

  it('draws the cells of the frame in the snapshot: pixel (x, y) is pixels[y * 5 + x], origin top left', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/display': { frame: frameOf(0, 4, 12, 20, 24) } }));

    const display = board().display;
    expect(display?.map((fill, index) => (fill === null ? null : index)).filter((index) => index !== null)).toEqual([0, 4, 12, 20, 24]);
    expect(display?.[4]).toBe(red);

    // The cells are laid out the same way: index 4 is the right end of the first row, index 20 the left end of the last.
    const cells = groupNamed('.ybc-display')?.getChildren() ?? [];
    expect(cells).toHaveLength(25);
    const first = cells[0] as Konva.Rect;
    const topRight = cells[4] as Konva.Rect;
    const bottomLeft = cells[20] as Konva.Rect;
    expect(topRight.x()).toBeGreaterThan(first.x());
    expect(topRight.y()).toBe(first.y());
    expect(bottomLeft.x()).toBe(first.x());
    expect(bottomLeft.y()).toBeGreaterThan(first.y());
    // What is drawn is what is reported: a lit cell is filled with its colour, an off one is dark.
    expect(topRight.fill()).toBe(red);
    expect(first.fill()).toBe(red);
    expect((cells[1] as Konva.Rect).fill()).not.toBe(red);
  });

  it('draws a cell in any colour of the palette, and rims and lights every lit cell so a dark colour never reads as off (N17 B1)', async () => {
    const colours: HexColour[] = ['#FF0000', '#FFA500', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#800080', '#FFFFFF'];
    const pixels = blankFrame().pixels.map((_, index) => colours[index] ?? null);
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/display': { frame: { pixels } } }));

    expect(board().display).toEqual(pixels);
    const cells = (groupNamed('.ybc-display')?.getChildren() ?? []) as Konva.Rect[];
    colours.forEach((colour, index) => {
      const lit = cells[index];
      expect(lit?.fill(), colour).toBe(colour);
      expect(lit?.strokeWidth(), colour).toBeGreaterThan(0);
      expect(lit?.stroke(), colour).not.toBe(colour);
      expect(lit?.shadowEnabled(), colour).toBe(true);
      expect(lit?.shadowColor(), colour).toBe(colour);
    });
    const off = cells[24];
    expect(off?.strokeWidth()).toBe(0);
    expect(off?.shadowEnabled()).toBe(false);
    expect(off?.fill()).not.toBe('#4B0082');
  });

  it('follows the snapshot from one frame to the next, and back to dark when the run ends', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/display': { frame: frameOf(0) } }));
    expect(board().display?.filter((fill) => fill !== null)).toHaveLength(1);

    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/display': { frame: frameOf(1, 2) } }));
    expect(board().display?.filter((fill) => fill !== null)).toHaveLength(2);

    await render(ybcCircuit, 'ybc-basic', null);
    expect(board().display).toEqual(allOff);
  });

  it.each([
    ['a frame of 24 pixels', { frame: { pixels: Array.from({ length: 24 }, () => red) } }],
    ['a sparse frame', { frame: { pixels: new Array(25) } }],
    ['a colour that is not a colour', { frame: { pixels: Array.from({ length: 25 }, () => 'red') } }],
    ['a state with no frame', { lit: true }],
  ])('draws every cell off for %s', async (_label, state) => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/display': state as never }));

    expect(board().display).toEqual(allOff);
  });

  it('does not read the display of another board', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'other-board/display': { frame: frameOf(0) } }));

    expect(board().display).toEqual(allOff);
  });
});

describe('the buzzer on the canvas', () => {
  const toneTexts = () => stage().find<Konva.Text>('Text').map((text) => text.text()).filter((text) => text.endsWith(' Hz'));

  it('is silent and unmarked while idle', async () => {
    await render(ybcCircuit, 'ybc-basic', null);

    expect(board().tone).toBeUndefined();
    expect(toneTexts()).toEqual([]);
  });

  it('is marked, with the frequency as text, while a note sounds, and unmarked when it ends', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/buzzer': { hz: 262 } }));

    expect(board().tone).toBe(262);
    expect(toneTexts()).toEqual(['262 Hz']);
    const ring = groupNamed('.ybc-part-buzzer')?.findOne<Konva.Rect>('Rect');
    expect(ring?.strokeWidth()).toBeGreaterThan(0);

    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/display': { frame: frameOf(0) } }));
    expect(board().tone).toBeUndefined();
    expect(toneTexts()).toEqual([]);
    expect(groupNamed('.ybc-part-buzzer')?.findOne<Konva.Rect>('Rect')?.strokeWidth()).toBe(0);
  });

  it.each([0, -1, Number.NaN, '262'])('does not take %j for a tone', async (hz) => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/buzzer': { hz: hz as number } }));

    expect(board().tone).toBeUndefined();
    expect(toneTexts()).toEqual([]);
  });

  it('draws the buttons and the light as they were: static footprints that the snapshot does not touch', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({ 'ybc-board-1/button-a': { closed: true }, 'ybc-board-1/light': { value: 99 } }));

    for (const partId of ['button-a', 'light']) {
      const footprint = groupNamed(`.ybc-part-${partId}`);
      expect(footprint?.getAttr('hz')).toBeUndefined();
      expect(footprint?.findOne<Konva.Rect>('Rect')?.strokeWidth()).toBe(0);
    }
  });
});

describe('the inputs of a lab’s check on the board (N8s)', () => {
  it('draws a button the check holds pressed, and the light level it gives beside the sensor', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({}), {
      'ybc-board-1/button-a': { kind: 'hold', closed: true },
      'ybc-board-1/button-b': { kind: 'hold', closed: false },
      'ybc-board-1/light': { kind: 'slider', value: 10 },
    });

    expect(board().pressedParts).toEqual(['button-a']);
    expect(board().lightLevel).toBe(10);
    expect(groupNamed('.ybc-part-button-a')?.findOne<Konva.Rect>('Rect')?.strokeWidth()).toBeGreaterThan(0);
    expect(groupNamed('.ybc-part-button-b')?.findOne<Konva.Rect>('Rect')?.strokeWidth()).toBe(0);
    expect(stage().find<Konva.Text>('Text').map((text) => text.text())).toContain('10');
  });

  it('draws nothing pressed without inputs, and ignores the inputs of another board', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({}), { 'other/button-a': { kind: 'hold', closed: true } });

    expect(board().pressedParts).toEqual([]);
    expect(board().lightLevel).toBeUndefined();
  });
});

describe('the readings of the sensors on the board while a run is on (N17 B2)', () => {
  const readouts = () => groupNamed('.ybc-readouts') as unknown as Konva.Text | undefined;

  it('draws no reading while idle, nor after a run (no inputs are given then)', async () => {
    await render(ybcCircuit, 'ybc-advanced', null);
    expect(readouts()).toBeUndefined();
    expect(board().temperature).toBeUndefined();
    await render(ybcCircuit, 'ybc-advanced', simulation({}));
    expect(readouts()).toBeUndefined();
  });

  // N17 B6: the line reads only the sensors the profile gives a control. The Basic board has none, so it draws no line, though its
  // run has the inputs (`{}`) and the board still has the parts.
  it('draws no reading on the Basic board, which has no control for the temperature or the accelerometer', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({}), {});
    expect(readouts()).toBeUndefined();
    expect(board().temperature).toBeUndefined();
    expect(board().acceleration).toBeUndefined();

    await render(ybcCircuit, 'ybc-basic', simulation({}), { 'ybc-board-1/temperature': { kind: 'slider', value: 31 } });
    expect(readouts()).toBeUndefined();
  });

  it('reads 25 °C and lying flat while a run is on and the controls were not touched, in a quiet line under the display', async () => {
    await render(ybcCircuit, 'ybc-advanced', simulation({}), {});
    expect(board().temperature).toBe(25);
    expect(board().acceleration).toEqual({ x: 0, y: 0, z: -1024 });
    expect(readouts()?.text()).toBe('25 °C   x 0  y 0  z -1024');
    // Under the display, above the buttons; it takes no pointer.
    const display = ybcBoardDefinition.board?.onboard?.find((part) => part.id === 'display');
    expect(readouts()?.y()).toBeGreaterThanOrEqual((display?.at.y ?? 0) + (display?.at.height ?? 0));
    expect(readouts()?.y()).toBeLessThan(ybcBoardDefinition.board?.onboard?.find((part) => part.id === 'button-a')?.at.y ?? 0);
    expect(readouts()?.listening()).toBe(false);
  });

  it('reads what the run is given: the temperature and the tilt (face down too), with the program’s own rounding and range', async () => {
    await render(ybcCircuit, 'ybc-advanced', simulation({}), {
      'ybc-board-1/temperature': { kind: 'slider', value: 31 },
      'ybc-board-1/accelerometer': { kind: 'tilt', x: -700, y: 300 },
    });
    expect(board().temperature).toBe(31);
    expect(board().acceleration).toEqual({ x: -700, y: 300, z: -685 });
    expect(readouts()?.text()).toBe('31 °C   x -700  y 300  z -685');
    // The temperature has the line: it is not written beside its part, as the light's level is.
    expect(board().lightLevel).toBeUndefined();

    await render(ybcCircuit, 'ybc-advanced', simulation({}), { 'ybc-board-1/accelerometer': { kind: 'tilt', x: 0, y: 0, z: 1024 } });
    expect(board().acceleration).toEqual({ x: 0, y: 0, z: 1024 });
  });

  it('marks the board shaken after a shake: the accelerometer is ringed for 1 s', async () => {
    vi.useFakeTimers();
    try {
      await render(ybcCircuit, 'ybc-advanced', simulation({}), {}, {});
      expect(board().shaking).toBe(false);
      const ring = () => groupNamed('.ybc-part-accelerometer')?.findOne<Konva.Rect>('Rect')?.strokeWidth();
      expect(ring()).toBe(0);

      await render(ybcCircuit, 'ybc-advanced', simulation({}), {}, { 'ybc-board-1/accelerometer': 1 });
      expect(board().shaking).toBe(true);
      expect(groupNamed('.ybc-part-accelerometer')?.getAttr('shaken')).toBe(true);
      expect(ring()).toBeGreaterThan(0);
      await act(async () => void vi.advanceTimersByTime(1000));
      expect(board().shaking).toBe(false);
      expect(ring()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws the temperature sensor and the accelerometer as labelled parts, inside the board', async () => {
    await render(ybcCircuit, 'ybc-advanced', null);
    expect(groupNamed('.ybc-part-temperature')).toBeDefined();
    expect(groupNamed('.ybc-part-accelerometer')).toBeDefined();
    expect(board().texts).toEqual(expect.arrayContaining(['Temp', 'Accel']));
  });
});

describe('pressing A and B on the drawing of the board (N17 B4)', () => {
  type Press = [componentId: string, pointerId: number, pressed: boolean];

  function renderPressable(pressable: boolean, inputs: Record<string, ComponentInput> = {}) {
    const presses: Press[] = [];
    const context = resolveBoardContext({ profile: 'ybc-basic', circuit: ybcCircuit }, registry, productionProfiles);
    const element = (canPress: boolean, given = inputs) => (
      <CircuitCanvas
        circuit={ybcCircuit}
        registry={registry}
        context={context}
        simulation={simulation({})}
        locked
        onCircuitChange={() => undefined}
        onContactChange={() => undefined}
        inputs={given}
        {...(canPress ? { onPartPress: (componentId: string, pointerId: number, pressed: boolean) => void presses.push([componentId, pointerId, pressed]) } : {})}
      />
    );
    return { presses, ready: act(async () => root.render(element(pressable))), rerender: (canPress: boolean, given = inputs) => act(async () => root.render(element(canPress, given))) };
  }
  const part = (id: string) => groupNamed(`.ybc-part-${id}`) as Konva.Group;
  const fire = (node: Konva.Node, type: string, evt: Partial<PointerEvent> = {}) =>
    act(async () => void node.fire(type, { evt: { button: 0, pointerId: 1, ...evt } as PointerEvent }, true));

  it('holds A while the pointer is down on it, for the part of the board, and lets go on pointerup', async () => {
    const { presses, ready } = renderPressable(true);
    await ready;
    await fire(part('button-a'), 'pointerdown');
    expect(presses).toEqual([['ybc-board-1/button-a', 1, true]]);
    await fire(part('button-a'), 'pointerup');
    expect(presses).toEqual([['ybc-board-1/button-a', 1, true], ['ybc-board-1/button-a', 1, false]]);
  });

  it.each(['pointerleave', 'pointercancel', 'lostpointercapture'])('lets go on %s, so a press that leaves the button never sticks (Review Focus 2)', async (type) => {
    const { presses, ready } = renderPressable(true);
    await ready;
    await fire(part('button-b'), 'pointerdown', { pointerId: 4 });
    await fire(part('button-b'), type, { pointerId: 4 });
    // What comes after (the release outside the board) changes nothing more.
    await fire(part('button-b'), 'pointerup', { pointerId: 4 });
    expect(presses).toEqual([['ybc-board-1/button-b', 4, true], ['ybc-board-1/button-b', 4, false]]);
  });

  it('lets go when the pointer is released anywhere on the page, and when the run stops taking presses', async () => {
    const { presses, ready, rerender } = renderPressable(true);
    await ready;
    await fire(part('button-a'), 'pointerdown', { pointerId: 2 });
    await act(async () => void window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 })));
    expect(presses).toEqual([['ybc-board-1/button-a', 2, true], ['ybc-board-1/button-a', 2, false]]);

    await fire(part('button-b'), 'pointerdown', { pointerId: 3 });
    await rerender(false);
    expect(presses.slice(2)).toEqual([['ybc-board-1/button-b', 3, true], ['ybc-board-1/button-b', 3, false]]);
  });

  it('takes no press of a secondary button, nor on a part that is not a button', async () => {
    const { presses, ready } = renderPressable(true);
    await ready;
    await fire(part('button-a'), 'pointerdown', { button: 2 });
    await fire(part('light'), 'pointerdown');
    await fire(groupNamed('.ybc-display') as Konva.Group, 'pointerdown');
    expect(presses).toEqual([]);
  });

  it('listens on the buttons only while a run takes presses, and shows a hand over them then', async () => {
    const { ready, rerender } = renderPressable(false);
    await ready;
    expect(part('button-a').listening()).toBe(false);
    expect(part('button-a').getAttr('pressable')).toBe(false);

    await rerender(true);
    expect(part('button-a').listening()).toBe(true);
    expect(part('button-b').getAttr('pressable')).toBe(true);
    expect(part('light').listening()).toBe(false);
    await fire(part('button-a'), 'pointerenter');
    expect(stage().container().style.cursor).toBe('pointer');
    await fire(part('button-a'), 'pointerleave');
    expect(stage().container().style.cursor).toBe('');
  });

  it('draws a pressed button pressed, whichever hand pressed it: what the run is given', async () => {
    const { ready } = renderPressable(true, { 'ybc-board-1/button-a': { kind: 'hold', closed: true } });
    await ready;
    expect(board().pressedParts).toEqual(['button-a']);
    expect(part('button-a').getAttr('pressed')).toBe(true);
  });
});

describe('a generic project is drawn as before', () => {
  it('gives its board no display and no tone, whatever the snapshot holds', async () => {
    await render(genericCircuit, undefined, simulation({ 'board/display': { frame: frameOf(0) }, 'board/buzzer': { hz: 262 } }));

    expect(board()).toMatchObject({ id: 'board', deviceType: 'board' });
    expect(board().display).toBeUndefined();
    expect(board().tone).toBeUndefined();
    expect(stage().find('.ybc-display')).toHaveLength(0);
  });
});

describe('partStatesOf', () => {
  it('is undefined while idle, and for a component with no onboard parts', () => {
    expect(partStatesOf(null, 'ybc-board-1', ybcBoardDefinition)).toBeUndefined();
    expect(partStatesOf(simulation({ 'board/display': { frame: frameOf(0) } }), 'board', registry.get('board'))).toBeUndefined();
    expect(partStatesOf(simulation({}), 'led-1', registry.get('led'))).toBeUndefined();
  });

  it('holds the state of each part that has one, by part id, and no other', () => {
    const display = { frame: frameOf(3) };
    const buzzer = { hz: 440 };

    const states = partStatesOf(
      simulation({ 'ybc-board-1/display': display, 'ybc-board-1/buzzer': buzzer, 'ybc-board-1/nope': { hz: 1 }, 'other/light': { value: 1 } }),
      'ybc-board-1',
      ybcBoardDefinition,
    );

    expect(states).toEqual({ display, buzzer });
  });

  it('is empty before any part has reported', () => {
    expect(partStatesOf(simulation({}), 'ybc-board-1', ybcBoardDefinition)).toEqual({});
  });

  it('keeps a part id such as __proto__ as a key, not as the object\'s prototype', () => {
    const definition = {
      ...ybcBoardDefinition,
      board: {
        ...ybcBoardDefinition.board,
        pins: [],
        onboard: [{ id: '__proto__', model: 'buzzer', capability: 'sound', at: { x: 0, y: 0, width: 1, height: 1 }, label: 'X' }],
      },
    };

    const states = partStatesOf(simulation({ 'b/__proto__': { hz: 262 } }), 'b', definition);

    expect(Object.getPrototypeOf(states)).toBeNull();
    expect(Object.hasOwn(states ?? {}, '__proto__')).toBe(true);
    expect(Object.keys(states ?? {})).toEqual(['__proto__']);
  });
});
