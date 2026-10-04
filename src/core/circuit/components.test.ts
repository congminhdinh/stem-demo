import { describe, expect, it } from 'vitest';
import blinkSample from '../../samples/blink.project.json';
import { addComponent, deleteComponent, moveComponent } from './components';
import { projectDocumentSchema } from './document';

const blink = projectDocumentSchema.parse(blinkSample).circuit;

describe('addComponent', () => {
  it('adds the device at the position with an id no component has, leaving the input untouched', () => {
    const before = structuredClone(blink);

    const first = addComponent(blink, 'led', { x: 300, y: 400 });
    const second = addComponent(first.circuit, 'led', { x: 320, y: 420 });

    expect(first.componentId).toBe('led-1');
    expect(second.componentId).toBe('led-2');
    expect(second.circuit.components.slice(-2)).toEqual([
      { id: 'led-1', deviceType: 'led', position: { x: 300, y: 400 } },
      { id: 'led-2', deviceType: 'led', position: { x: 320, y: 420 } },
    ]);
    expect(second.circuit.wires).toEqual(blink.wires);
    expect(blink).toEqual(before);
  });

  it('skips ids that are taken, whatever made them', () => {
    const circuit = { components: [{ id: 'led-1', deviceType: 'board', position: { x: 0, y: 0 } }], wires: [] };

    expect(addComponent(circuit, 'led', { x: 0, y: 0 }).componentId).toBe('led-2');
  });
});

describe('moveComponent', () => {
  it('changes only that component’s position; the wires keep their ports', () => {
    const before = structuredClone(blink);

    const moved = moveComponent(blink, 'led', { x: 700, y: 300 });

    expect(moved.components.find((component) => component.id === 'led')?.position).toEqual({ x: 700, y: 300 });
    expect(moved.components.filter((component) => component.id !== 'led')).toEqual(
      blink.components.filter((component) => component.id !== 'led'),
    );
    expect(moved.wires).toEqual(blink.wires);
    expect(blink).toEqual(before);
  });
});

describe('deleteComponent', () => {
  it('removes the component and every wire connected to it (I4)', () => {
    const before = structuredClone(blink);

    const deleted = deleteComponent(blink, 'resistor');

    expect(deleted.components.map((component) => component.id)).toEqual(['board', 'led']);
    expect(deleted.wires.map((wire) => wire.id)).toEqual(['wire-cathode-gnd']);
    expect(blink).toEqual(before);
  });
});
