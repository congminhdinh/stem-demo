import { describe, expect, it, vi } from 'vitest';
import type { AnalogInIO } from '../capabilities/io';
import type { RuntimeServices } from '../capabilities/services';
import ybcBoardJson from '../devices/definitions/ybc-board.json';
import { boardScaleOf } from '../devices/device-definition';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry, type DeviceRegistry } from '../devices/registry';
import type { RunEnvironment } from '../run/run-session';
import { createPinCapabilities } from '../run/ybc-pin-io';
import { ANALOG_NATIVE_MAX, percentToNative, rawToPercent } from './conversions';
import { analogValueOf } from './pin-signal';
import type { SimulationResult } from './simulate-circuit';

// N18 R2.1: the analog scale is the board's (`boardScaleOf`): 0..4095 for the Yolo:Bit-compatible board, as before (contract
// C-25), 0..1023 for the UNO one (UNO contract U-34). The conversions take the board's top; without one they keep 4095.

const registry = createDeviceRegistry(localDeviceDefinitions);
const ybc = boardScaleOf(registry.get('ybc-board'));
const uno = boardScaleOf(registry.get('uno-r3'));

describe('the analog scale per board (N18 R2.1)', () => {
  it('ybc board keeps 0..4095 analog scale: a high net, a low one and a wiper read as before', () => {
    expect(ybc.adcMax).toBe(ANALOG_NATIVE_MAX);
    expect([analogValueOf({ kind: 'high' }, ybc.adcMax), analogValueOf({ kind: 'low' }, ybc.adcMax)]).toEqual([4095, 0]);
    expect(analogValueOf({ kind: 'analog', percent: 50 }, ybc.adcMax)).toBe(2048);
    // Without a board scale, the Yolo:Bit one: exactly what every caller got before.
    expect(analogValueOf({ kind: 'high' })).toBe(4095);
    expect(analogValueOf({ kind: 'analog', percent: 50 })).toBe(2048);
  });

  it('reads the UNO board on its own 0..1023', () => {
    expect([analogValueOf({ kind: 'high' }, uno.adcMax), analogValueOf({ kind: 'low' }, uno.adcMax)]).toEqual([1023, 0]);
    expect(analogValueOf({ kind: 'analog', percent: 50 }, uno.adcMax)).toBe(percentToNative(50, 1023));
    expect(percentToNative(50, uno.adcMax)).toBe(512);
    expect(analogValueOf({ kind: 'floating' }, uno.adcMax)).toBeNull();
  });

  it('shows a reading as a percentage of its board’s scale: rawToPercent(r, N) = floor(r x 100 / N + 0.5)', () => {
    expect([0, 511, 512, 1023, 2000].map((raw) => rawToPercent(raw, uno.adcMax))).toEqual([0, 50, 50, 100, 100]);
    expect(rawToPercent(2048, ybc.adcMax)).toBe(rawToPercent(2048));
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(rawToPercent(percentToNative(percent, uno.adcMax), uno.adcMax), String(percent)).toBe(percent);
    }
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => rawToPercent(10, bad), String(bad)).toThrow(RangeError);
    }
  });

  it('makes the header pins read on the scale of their board’s data', () => {
    const board = { id: 'b', deviceType: 'ybc-board', position: { x: 0, y: 0 } };
    const simulation: SimulationResult = {
      nets: [{ ports: [{ componentId: 'b', portId: 'p0' }], level: 'high' }],
      components: {},
      pinReads: { P0: 1 },
    };
    const analogRead = (boards: DeviceRegistry) => {
      const environment: RunEnvironment = {
        board,
        capabilitySet: ['digital', 'analogIn'],
        services: {} as RuntimeServices,
        input: () => undefined,
        takePresses: () => 0,
        sinceEvent: () => undefined,
        report: () => {},
        simulation: () => simulation,
        drivePin: vi.fn(),
        warn: vi.fn(),
      };
      return (createPinCapabilities(boards)(environment).analogIn as AnalogInIO).analogRead('P0');
    };
    expect(analogRead(registry)).toBe(4095);
    // The same board with a 10-bit scale in its data reads 1023: the top comes from the board, not from a constant.
    const tenBit = createDeviceRegistry([{ ...ybcBoardJson, board: { ...ybcBoardJson.board, scale: { adcMax: 1023, pwmMax: 255 } } }]);
    expect(analogRead(tenBit)).toBe(1023);
  });
});
