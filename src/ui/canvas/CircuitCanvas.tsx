import type { KonvaEventObject } from 'konva/lib/Node';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { addComponent, deleteComponent, moveComponent } from '../../core/circuit/components';
import type { Circuit, ComponentInstance, Point, Wire } from '../../core/circuit/document';
import { portRefPosition, portWorldPosition, snapToGrid } from '../../core/circuit/geometry';
import type { DeviceDefinition, PortDefinition } from '../../core/devices/device-definition';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { SimulationResult } from '../../core/simulation/simulate-circuit';
import { Palette } from './Palette';
import { paletteItems, placementPosition } from './palette-model';
import { rendererFor, type DeviceRendererProps } from './renderers';
import { useElementSize } from './use-element-size';
import { stageToWorld } from './viewport';

// Renders the design state plus, while running, the simulation snapshot, and
// edits the circuit (add, move, delete). The document is the source of truth:
// Konva nodes are derived from it on every render and never stored, and every
// edit is a pure core operation handed to `onCircuitChange`. Selection and the
// position of a component being dragged are the only local, UI-only state.

type CircuitCanvasProps = {
  circuit: Circuit;
  registry: DeviceRegistry;
  /** The run snapshot's simulation; null while idle (design state only). */
  simulation: SimulationResult | null;
  /** While a run is active the circuit cannot be edited (plan §3.4). */
  locked: boolean;
  /** Receives each edit as a whole new circuit. */
  onCircuitChange(circuit: Circuit): void;
};

/** A component being dragged: drawn where Konva has it, committed (snapped) on drop. */
type DragPreview = { componentId: string; position: Point };

export function CircuitCanvas({ circuit, registry, simulation, locked, onCircuitChange }: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  // A run that starts mid-drag cancels the drag: it was never committed and
  // the run uses the document as it was. Dropping it as soon as the lock is
  // seen, not on drag end (which may never come), keeps it from coming back
  // after Stop. Konva ends the drag itself once the node is not draggable.
  if (locked && drag) {
    setDrag(null);
  }

  // Wires and ports follow a dragged component through this derived circuit;
  // the document itself changes once, on drop.
  const shown = drag ? moveComponent(circuit, drag.componentId, drag.position) : circuit;
  // While running nothing is selected, so Delete has nothing to act on; a
  // deleted or unloaded component is never selected either.
  const selected = !locked && shown.components.some((component) => component.id === selectedId) ? selectedId : null;

  const add = (deviceType: string) => {
    const middle = stageToWorld({ x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 });
    const { circuit: next, componentId } = addComponent(circuit, deviceType, placementPosition(circuit, middle));
    onCircuitChange(next);
    setSelectedId(componentId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setSelectedId(null);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      onCircuitChange(deleteComponent(circuit, selected));
      setSelectedId(null);
    }
  };

  const onStagePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    // Konva prevents the default of pointerdown on shapes, so focus the
    // canvas by hand: Delete and Esc only act while it has focus.
    containerRef.current?.focus({ preventScroll: true });
    if (event.target === event.target.getStage()) {
      setSelectedId(null);
    }
  };

  const dragHandlers = (componentId: string) => ({
    onDragMove: (event: KonvaEventObject<DragEvent>) =>
      setDrag({ componentId, position: { x: event.target.x(), y: event.target.y() } }),
    onDragEnd: (event: KonvaEventObject<DragEvent>) => {
      setDrag(null);
      onCircuitChange(moveComponent(circuit, componentId, snapToGrid({ x: event.target.x(), y: event.target.y() })));
    },
  });

  return (
    <div className="circuit-editor">
      <Palette items={paletteItems(registry)} disabled={locked} onAdd={add} />
      <div className="circuit-canvas-area">
        <div
          ref={containerRef}
          className="circuit-canvas"
          data-testid="circuit-canvas"
          tabIndex={0}
          aria-label="Circuit canvas"
          onKeyDown={onKeyDown}
        >
          {size && (
            <Stage width={size.width} height={size.height} onPointerDown={onStagePointerDown}>
              <Layer>
                {shown.components.map((component) => (
                  <ComponentBody
                    key={component.id}
                    component={component}
                    definition={registry.get(component.deviceType)}
                    runtimeState={runtimeStateOf(simulation, component.id)}
                    selected={component.id === selected}
                    draggable={!locked}
                    onPointerDown={() => setSelectedId(component.id)}
                    {...dragHandlers(component.id)}
                  />
                ))}
                {shown.wires.map((wire) => (
                  <WireLine key={wire.id} wire={wire} circuit={shown} registry={registry} />
                ))}
                {shown.components.map((component) => (
                  <PortMarkers
                    key={component.id}
                    component={component}
                    definition={registry.get(component.deviceType)}
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>
      </div>
    </div>
  );
}

type ComponentProps = { component: ComponentInstance; definition: DeviceDefinition };

/** Component ids are data, so they must not resolve to Object.prototype members. */
function runtimeStateOf(simulation: SimulationResult | null, componentId: string) {
  return simulation && Object.hasOwn(simulation.components, componentId)
    ? simulation.components[componentId]
    : undefined;
}

type ComponentBodyProps = ComponentProps &
  Pick<DeviceRendererProps, 'runtimeState'> & {
    selected: boolean;
    draggable: boolean;
    onPointerDown(): void;
    onDragMove(event: KonvaEventObject<DragEvent>): void;
    onDragEnd(event: KonvaEventObject<DragEvent>): void;
  };

const selectionMargin = 6;

function ComponentBody({ component, definition, runtimeState, selected, ...interaction }: ComponentBodyProps) {
  const Renderer = rendererFor(definition);
  const { width, height } = definition.body;
  return (
    <Group
      name="component"
      componentId={component.id}
      deviceType={component.deviceType}
      x={component.position.x}
      y={component.position.y}
      {...interaction}
    >
      <Renderer definition={definition} runtimeState={runtimeState} />
      {/* Drawn by the canvas, not the renderer: selection is editor state. */}
      {selected && (
        <Rect
          name="selection"
          x={-width / 2 - selectionMargin}
          y={-height / 2 - selectionMargin}
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke="#2680c2"
          strokeWidth={2}
          dash={[6, 4]}
          cornerRadius={4}
          listening={false}
        />
      )}
    </Group>
  );
}

function WireLine({ wire, circuit, registry }: { wire: Wire; circuit: Circuit; registry: DeviceRegistry }) {
  const from = portRefPosition(circuit, registry, wire.from);
  const to = portRefPosition(circuit, registry, wire.to);
  return (
    <Line
      name="wire"
      wireId={wire.id}
      points={[from.x, from.y, to.x, to.y]}
      stroke="#334e68"
      strokeWidth={3}
      lineCap="round"
    />
  );
}

const portColors: Record<PortDefinition['kind'], string> = {
  gpio: '#2680c2',
  power: '#d64545',
  ground: '#1f2933',
  passive: '#7b8794',
};

const labelWidth = 48;

function PortMarkers({ component, definition }: ComponentProps) {
  return definition.ports.map((port) => {
    const at = portWorldPosition(component, definition, port.id);
    // Labels go on the body side of the marker; passive ports (LED, resistor)
    // stay unlabeled to keep small devices readable.
    const labelOnLeft = port.x > 0;
    return (
      <Group key={port.id}>
        <Circle
          name="port"
          componentId={component.id}
          portId={port.id}
          x={at.x}
          y={at.y}
          radius={4}
          fill={portColors[port.kind]}
          stroke="#ffffff"
          strokeWidth={1}
        />
        {port.kind !== 'passive' && (
          <Text
            text={port.label}
            x={labelOnLeft ? at.x - 8 - labelWidth : at.x + 8}
            y={at.y - 5}
            width={labelWidth}
            align={labelOnLeft ? 'right' : 'left'}
            fontSize={10}
            fill="#52606d"
            listening={false}
          />
        )}
      </Group>
    );
  });
}
