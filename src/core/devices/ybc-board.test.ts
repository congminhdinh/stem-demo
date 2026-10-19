import { describe, expect, it } from 'vitest';
import { yolobitContract } from '../compat/yolobit-contract';
import { simulateCircuit } from '../simulation/simulate-circuit';
import { deviceFamily, findPort } from './device-definition';
import { localDeviceDefinitions } from './local-catalog';
import { createDeviceRegistry } from './registry';

// The ybc-board definition (YB plan §8.1, §8.4): static metadata only. The
// display geometry and the pin list come from the contract; no peripheral
// behaves yet (display YB-3a, buttons/sound/light YB-3b, pins YB-4).

const registry = createDeviceRegistry(localDeviceDefinitions);
const board = registry.get('ybc-board');

describe('ybc-board', () => {
  it('belongs to the ybc family and targets Yolo:Bit MicroPython', () => {
    expect(deviceFamily(board)).toBe('ybc');
    expect(board.board?.codeTarget).toBe('yolobit-micropython');
  });

  it('has the pins P0, P1, P2 and nothing else, wired to gpio ports with 3V3 and GND', () => {
    expect(board.board?.pins.map((pin) => pin.name)).toEqual(['P0', 'P1', 'P2']);
    for (const pin of board.board?.pins ?? []) {
      expect(findPort(board, pin.portId)?.kind).toBe('gpio');
      expect(pin.capabilities).toEqual(['digital', 'analogIn']);
    }
    expect(findPort(board, '3v3')?.kind).toBe('power');
    expect(findPort(board, 'gnd')?.kind).toBe('ground');
    expect(board.board?.reservedPins).toEqual([]);
  });

  it('keeps every pin off the capabilities the contract excludes (PWM) or has not opened here yet', () => {
    const capabilities = (board.board?.pins ?? []).flatMap((pin) => pin.capabilities ?? []);
    expect(capabilities).not.toContain('pwm');
    expect(capabilities).not.toContain('servo');
    expect(capabilities).not.toContain('pulse');
  });

  it('puts every port on the editor grid', () => {
    for (const port of board.ports) {
      expect(Math.abs(port.x % 10)).toBe(0);
      expect(Math.abs(port.y % 10)).toBe(0);
    }
  });

  it('describes the display as the owner-approved 5×5 RGB model of the contract', () => {
    const display = board.board?.onboard?.find((part) => part.id === 'display');
    expect(display).toMatchObject({ model: 'matrix-display', capability: 'display' });
    expect(display?.config).toEqual({
      width: yolobitContract.display.width,
      height: yolobitContract.display.height,
      colourModel: 'rgb-hex',
      origin: yolobitContract.display.origin,
      xAxis: yolobitContract.display.x,
      yAxis: yolobitContract.display.y,
      defaultColour: yolobitContract.display.defaultColour,
    });
  });

  it('lists the onboard parts the contract names (N17 B2: the temperature sensor and the accelerometer too), and no sensor it excludes', () => {
    expect(board.board?.onboard?.map((part) => part.id)).toEqual(['display', 'button-a', 'button-b', 'light', 'buzzer', 'temperature', 'accelerometer']);
  });

  it('draws no two onboard parts over each other (N17 B2 placed two more)', () => {
    const parts = board.board?.onboard ?? [];
    for (const [index, a] of parts.entries()) {
      for (const b of parts.slice(index + 1)) {
        const apart = a.at.x + a.at.width <= b.at.x || b.at.x + b.at.width <= a.at.x || a.at.y + a.at.height <= b.at.y || b.at.y + b.at.height <= a.at.y;
        expect(apart, `${a.id} / ${b.id}`).toBe(true);
      }
    }
  });

  it('draws every onboard part inside the body', () => {
    const { width, height } = board.body;
    for (const part of board.board?.onboard ?? []) {
      expect(part.at.x).toBeGreaterThanOrEqual(-width / 2);
      expect(part.at.y).toBeGreaterThanOrEqual(-height / 2);
      expect(part.at.x + part.at.width).toBeLessThanOrEqual(width / 2);
      expect(part.at.y + part.at.height).toBeLessThanOrEqual(height / 2);
    }
  });

  it('is not the vendor\'s name or working name, and not the generic board\'s', () => {
    expect(board.name).not.toMatch(/yolo|ohstem|stem bit board/i);
    expect(board.name).not.toBe(registry.get('board').name);
  });

  it('has live header pins (YB-4) and no simulated onboard part yet: no component state', () => {
    const circuit = { components: [{ id: 'y', deviceType: 'ybc-board', position: { x: 0, y: 0 } }], wires: [] };
    const result = simulateCircuit(circuit, registry, { powered: true, pinOutputs: {}, contacts: {} });
    // Nothing is wired and nothing is written: every pin reads low, as an undriven pin does.
    expect(result.pinReads).toEqual({ P0: 0, P1: 0, P2: 0 });
    // The display, buttons, light sensor and buzzer arrive with YB-3: no snapshot state for them.
    expect(result.components).toEqual({});
  });
});
