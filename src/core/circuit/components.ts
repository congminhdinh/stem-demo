import type { Circuit, Point } from './document';

// Pure component operations (plan §6.1). Each returns a new circuit and leaves
// its input untouched; the editor applies the result through one store action.

/** Adds a device with a fresh id (`led-1`, `led-2`, …) that no component uses yet (I1). */
export function addComponent(
  circuit: Circuit,
  deviceType: string,
  position: Point,
): { circuit: Circuit; componentId: string } {
  const taken = new Set(circuit.components.map((component) => component.id));
  let index = 1;
  while (taken.has(`${deviceType}-${index}`)) {
    index++;
  }
  const componentId = `${deviceType}-${index}`;
  return {
    circuit: {
      ...circuit,
      components: [...circuit.components, { id: componentId, deviceType, position: { ...position } }],
    },
    componentId,
  };
}

/** Wires reference ports, not positions, so they follow on their own. */
export function moveComponent(circuit: Circuit, componentId: string, position: Point): Circuit {
  return {
    ...circuit,
    components: circuit.components.map((component) =>
      component.id === componentId ? { ...component, position: { ...position } } : component,
    ),
  };
}

/** Removes the component and every wire connected to it (I4). */
export function deleteComponent(circuit: Circuit, componentId: string): Circuit {
  return {
    components: circuit.components.filter((component) => component.id !== componentId),
    wires: circuit.wires.filter(
      (wire) => wire.from.componentId !== componentId && wire.to.componentId !== componentId,
    ),
  };
}
