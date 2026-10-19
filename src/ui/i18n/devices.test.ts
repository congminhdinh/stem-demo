import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { localizeDeviceDefinition } from './devices';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('the canvas text of a device (N8s)', () => {
  it('draws the Yolo:Bit-compatible board and its parts in Vietnamese', () => {
    const board = localizeDeviceDefinition(registry.get('ybc-board'), 'vi');
    expect(board.name).toBe('Bo mạch tương thích Bit');
    expect(board.board?.onboard?.map((part) => part.label)).toEqual(['Màn hình', 'A', 'B', 'Ánh sáng', 'Loa', 'Nhiệt độ', 'Gia tốc']);
    // Only text changes: where the parts are, what they are and the ports stay the core's.
    expect(board.ports).toEqual(registry.get('ybc-board').ports);
    expect(board.board?.onboard?.map((part) => part.at)).toEqual(registry.get('ybc-board').board?.onboard?.map((part) => part.at));
  });

  it.each([
    ['board', 'Bo mạch STEM'],
    ['resistor', 'Điện trở'],
    ['led', 'Đèn LED'],
    ['push-button', 'Nút bấm'],
    ['potentiometer', 'Biến trở'],
  ])('names the %s "%s"', (deviceType, name) => {
    expect(localizeDeviceDefinition(registry.get(deviceType), 'vi').name).toBe(name);
  });

  it('gives English the definition itself, and leaves the registry’s definitions as they were', () => {
    const board = registry.get('ybc-board');
    expect(localizeDeviceDefinition(board, 'en')).toBe(board);
    localizeDeviceDefinition(board, 'vi');
    expect(board.name).toBe('Bit-compatible Board');
    expect(board.board?.onboard?.[3]?.label).toBe('Light');
  });
});
