// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Circuit } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { resolveBoardContext } from '../../core/profiles/board-context';
import type { SimulationResult } from '../../core/simulation/simulate-circuit';
import { readCanvasState } from './canvas-test-state';
import { CircuitCanvas } from './CircuitCanvas';
import { SERVO_DEGREES_PER_MS } from './ServoRenderer';

// N17 B5: the servo and the dimmed LED as the canvas draws them. The servo's arm turns to the angle the run snapshot gives it, at
// about 60° per 0.1 s, with the angle written beside it; someone who asked for less motion sees it jump there. With no run (Stop)
// it stands at 90° at once (Review Focus 1). An LED fed by a PWM duty is drawn as bright as the snapshot says. Konva needs a 2D
// canvas, which jsdom does not have, so the context is a stand-in: the node tree is real, the pixels are not.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const registry = createDeviceRegistry(localDeviceDefinitions);

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
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

const at = (x: number, y: number) => ({ x, y });
const circuit: Circuit = {
  components: [
    { id: 'ybc-board-1', deviceType: 'ybc-board', position: at(300, 200) },
    { id: 'servo-1', deviceType: 'servo', position: at(560, 120) },
    { id: 'led-1', deviceType: 'led', position: at(560, 300) },
  ],
  wires: [],
};
const simulation = (components: SimulationResult['components']): SimulationResult => ({ nets: [], components, pinReads: {} });

function render(run: SimulationResult | null) {
  const context = resolveBoardContext({ profile: 'ybc-advanced', circuit }, registry, productionProfiles);
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
      />,
    ),
  );
}

const drawn = (id: string) => {
  const component = readCanvasState()?.components.find((candidate) => candidate.id === id);
  if (!component) {
    throw new Error(`The canvas has no ${id}`);
  }
  return component;
};
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('the servo on the canvas', () => {
  it('is a part of the Advanced palette, drawn with its arm at 90° and the angle written, while no run is on', async () => {
    await render(null);
    expect(drawn('servo-1')).toMatchObject({ deviceType: 'servo', angle: 90, incompatible: false });
    expect(drawn('servo-1').texts).toContain('90°');
  });

  it('turns its arm to the angle of the snapshot at about 60° per 0.1 s, the text following it', async () => {
    expect(SERVO_DEGREES_PER_MS).toBe(0.6);
    await render(simulation({ 'servo-1': { angle: 90 } }));
    expect(drawn('servo-1').angle).toBe(90);
    await render(simulation({ 'servo-1': { angle: 30 } }));
    // It starts where it was: the arm has not jumped.
    expect(drawn('servo-1').angle).toBe(90);
    await advance(48);
    const halfway = drawn('servo-1').angle ?? Number.NaN;
    expect(halfway).toBeLessThan(75);
    expect(halfway).toBeGreaterThan(45);
    expect(drawn('servo-1').texts).toContain(`${Math.round(halfway)}°`);
    // 60° at 0.6° per ms is 100 ms: not there at 80 ms, there well before 200 ms, and it stays.
    await advance(32);
    expect(drawn('servo-1').angle).toBeGreaterThan(30);
    await advance(120);
    expect(drawn('servo-1').angle).toBe(30);
    expect(drawn('servo-1').texts).toContain('30°');
    await advance(500);
    expect(drawn('servo-1').angle).toBe(30);
  });

  it('turns the other way and goes on from where it is when a new angle comes mid-turn', async () => {
    await render(simulation({ 'servo-1': { angle: 90 } }));
    await render(simulation({ 'servo-1': { angle: 180 } }));
    await advance(48);
    const mid = drawn('servo-1').angle ?? Number.NaN;
    expect(mid).toBeGreaterThan(90);
    await render(simulation({ 'servo-1': { angle: 0 } }));
    expect(drawn('servo-1').angle).toBe(mid);
    await advance(1000);
    expect(drawn('servo-1').angle).toBe(0);
  });

  it('jumps to the angle for someone who asked for less motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {} }));
    await render(simulation({ 'servo-1': { angle: 90 } }));
    await render(simulation({ 'servo-1': { angle: 20 } }));
    expect(drawn('servo-1').angle).toBe(20);
    expect(drawn('servo-1').texts).toContain('20°');
  });

  it('stands at 90° at once when the run stops, even mid-turn, and the next run starts from there (Review Focus 1)', async () => {
    await render(simulation({ 'servo-1': { angle: 90 } }));
    await render(simulation({ 'servo-1': { angle: 0 } }));
    await advance(48);
    expect(drawn('servo-1').angle).toBeLessThan(90);
    await render(null);
    expect(drawn('servo-1').angle).toBe(90);
    await advance(500);
    expect(drawn('servo-1').angle).toBe(90);
    await render(simulation({ 'servo-1': { angle: 90 } }));
    expect(drawn('servo-1').angle).toBe(90);
  });
});

describe('an LED fed by a PWM duty', () => {
  it('is drawn as bright as the snapshot says; a plain lit LED is at full brightness; an LED off has none', async () => {
    await render(simulation({ 'led-1': { lit: true, brightness: 0.5 } }));
    expect(drawn('led-1')).toMatchObject({ lit: true, brightness: 0.5 });
    await render(simulation({ 'led-1': { lit: true } }));
    expect(drawn('led-1')).toMatchObject({ lit: true, brightness: 1 });
    await render(simulation({ 'led-1': { lit: false } }));
    expect(drawn('led-1')).toMatchObject({ lit: false, brightness: 0 });
    await render(null);
    expect(drawn('led-1')).toMatchObject({ lit: false, brightness: 0 });
  });
});
