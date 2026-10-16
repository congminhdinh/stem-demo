import { describe, expect, it } from 'vitest';
import type { Circuit } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import blink from '../../samples/blink.project.json';
import { circuitBounds, fitViewport, identityViewport, stageToWorld, stageToWorldDistance } from './viewport';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('the viewport (B7, N8s)', () => {
  it('is the identity unless a viewport is given: the standalone editor is unchanged', () => {
    expect(stageToWorld({ x: 120, y: 45 })).toEqual({ x: 120, y: 45 });
    expect(stageToWorldDistance(12)).toBe(12);
  });

  it('converts stage pixels to world units through the scale and the offset', () => {
    const viewport = { scale: 0.5, x: 40, y: 10 };
    expect(stageToWorld({ x: 140, y: 60 }, viewport)).toEqual({ x: 200, y: 100 });
    expect(stageToWorldDistance(12, viewport)).toBe(24);
  });

  it('boxes every body and port of the Blink circuit', () => {
    // The board, 220×300 at (200, 220), and the LED, 40×70 at (600, 240), are the outermost (blink.project.json).
    expect(circuitBounds(blink.circuit as Circuit, registry)).toEqual({ left: 90, top: 70, right: 620, bottom: 370 });
  });

  it('has no box for a circuit without components', () => {
    expect(circuitBounds({ components: [], wires: [] }, registry)).toBeNull();
  });

  it('shrinks a circuit that does not fit, and centres it', () => {
    const viewport = fitViewport({ left: 80, top: 70, right: 640, bottom: 370 }, { width: 400, height: 500 });
    expect(viewport.scale).toBeCloseTo(352 / 560);
    // The middle of the box lands in the middle of the stage.
    expect(stageToWorld({ x: 200, y: 250 }, viewport)).toEqual({ x: 360, y: 220 });
  });

  it('never enlarges a circuit that fits; it only centres it', () => {
    const viewport = fitViewport({ left: 0, top: 0, right: 100, bottom: 100 }, { width: 800, height: 600 });
    expect(viewport).toEqual({ scale: 1, x: 350, y: 250 });
  });

  it('stops shrinking at the smallest readable scale', () => {
    expect(fitViewport({ left: 0, top: 0, right: 5000, bottom: 100 }, { width: 400, height: 400 }).scale).toBe(0.4);
  });

  it('is the identity without a circuit or without room', () => {
    expect(fitViewport(null, { width: 400, height: 400 })).toEqual(identityViewport);
    expect(fitViewport({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 30, height: 400 })).toEqual(identityViewport);
  });
});
