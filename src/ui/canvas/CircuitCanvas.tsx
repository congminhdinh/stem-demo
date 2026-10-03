import type { Context } from 'konva/lib/Context';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { addComponent, deleteComponent, moveComponent } from '../../core/circuit/components';
import {
  isSamePort,
  type Circuit,
  type ComponentInstance,
  type Point,
  type PortRef,
  type Wire,
} from '../../core/circuit/document';
import { nearestPort, portRefPosition, portWorldPosition, snapToGrid } from '../../core/circuit/geometry';
import { connectWire, deleteWire, nextWireId, type ConnectWireError } from '../../core/circuit/wires';
import type { DeviceDefinition, PortDefinition } from '../../core/devices/device-definition';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { SimulationResult } from '../../core/simulation/simulate-circuit';
import { Palette } from './Palette';
import { paletteItems, placementPosition } from './palette-model';
import { rendererFor, type DeviceRendererProps } from './renderers';
import { useElementSize } from './use-element-size';
import { portPickRadiusPx, stageToWorld, stageToWorldDistance } from './viewport';

// Renders the design state plus, while running, the simulation snapshot, and
// edits the circuit (add, move, delete, wire). The document is the source of
// truth: Konva nodes are derived from it on every render and never stored, and
// every edit is a pure core operation handed to `onCircuitChange`. Selection,
// hover and the gesture in progress (a drag or a wire being drawn) are the
// only local, UI-only state.

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

type Selection = { kind: 'component' | 'wire'; id: string };

/** A component being dragged: drawn where Konva has it, committed (snapped) on drop. */
type DragPreview = { componentId: string; position: Point };

/** A wire being drawn: from a port to the pointer, until another port is clicked. */
type WireDraft = { from: PortRef; pointer: Point };

// connectWire decides what is valid; the UI only words its answer. Only the
// first two can come from a click: ports come from the circuit, ids from nextWireId.
const wireErrorText: Record<ConnectWireError, string> = {
  'duplicate-wire': 'These ports are already connected.',
  'same-port': 'A wire needs two different ports.',
  'duplicate-wire-id': 'That wire cannot be added.',
  'unknown-component': 'That wire cannot be added.',
  'unknown-port': 'That wire cannot be added.',
};

export function CircuitCanvas({ circuit, registry, simulation, locked, onCircuitChange }: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const [draft, setDraft] = useState<WireDraft | null>(null);
  const [hoveredPort, setHoveredPort] = useState<PortRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A run that starts mid-gesture cancels it: nothing of it was committed and
  // the run uses the document as it was. Dropping it as soon as the lock is
  // seen, not when the gesture ends (which may never come), keeps it from
  // coming back after Stop. Konva ends a drag itself once the node is not draggable.
  if (locked && (drag || draft)) {
    setDrag(null);
    setDraft(null);
  }

  // Wires and ports follow a dragged component through this derived circuit;
  // the document itself changes once, on drop.
  const shown = drag ? moveComponent(circuit, drag.componentId, drag.position) : circuit;
  // While running nothing is selected or highlighted, so Delete has nothing
  // to act on; something deleted or unloaded is never selected either.
  const selected =
    !locked &&
    selection &&
    (selection.kind === 'component'
      ? shown.components.some((component) => component.id === selection.id)
      : shown.wires.some((wire) => wire.id === selection.id))
      ? selection
      : null;
  const highlightedPorts = locked ? [] : [hoveredPort, draft?.from].filter((ref) => ref != null);

  /** The pointer in world coordinates and the port it picks, if any (B7). */
  const pointerPick = (event: KonvaEventObject<PointerEvent>) => {
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) {
      return null;
    }
    const point = stageToWorld(pointer);
    return { point, port: nearestPort(shown, registry, point, stageToWorldDistance(portPickRadiusPx)) };
  };

  const add = (deviceType: string) => {
    const middle = stageToWorld({ x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 });
    const { circuit: next, componentId } = addComponent(circuit, deviceType, placementPosition(circuit, middle));
    onCircuitChange(next);
    setSelection({ kind: 'component', id: componentId });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setDraft(null);
      setSelection(null);
      setMessage(null);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      onCircuitChange(
        selected.kind === 'component' ? deleteComponent(circuit, selected.id) : deleteWire(circuit, selected.id),
      );
      setSelection(null);
    }
  };

  // First click on a port starts a wire, the next one on a port ends it.
  const onPortPointerDown = (event: KonvaEventObject<PointerEvent>) => {
    // The stage would take this for a click on empty space.
    event.cancelBubble = true;
    const picked = pointerPick(event);
    if (locked || !picked?.port) {
      return;
    }
    if (!draft) {
      setSelection(null);
      setDraft({ from: picked.port, pointer: picked.point });
      return;
    }
    const result = connectWire(circuit, registry, { id: nextWireId(circuit), from: draft.from, to: picked.port });
    setDraft(null);
    if (result.ok) {
      onCircuitChange(result.circuit);
    } else {
      setMessage(wireErrorText[result.error]);
    }
  };

  // While running a click on the canvas changes nothing, so the selection is
  // as it was when Stop comes. While drawing a wire a click only ends the
  // wire, on release (see onStagePointerUp).
  const onSelectablePointerDown = (next: Selection) => {
    if (!locked && !draft) {
      setSelection(next);
    }
  };

  const onStagePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    if (!locked && event.target === event.target.getStage()) {
      setSelection(null);
    }
  };

  // A wire in progress ends with a release anywhere but on a port. Not on
  // press: React would re-render before the browser's mousedown, make the
  // component under the pointer draggable again, and Konva would drag it.
  const onStagePointerUp = (event: KonvaEventObject<PointerEvent>) => {
    if (draft && !pointerPick(event)?.port) {
      setDraft(null);
    }
  };

  const onStagePointerMove = (event: KonvaEventObject<PointerEvent>) => {
    const picked = pointerPick(event);
    if (!picked) {
      return;
    }
    if (!isSameRef(picked.port, hoveredPort)) {
      setHoveredPort(picked.port);
    }
    if (draft) {
      setDraft({ ...draft, pointer: picked.point });
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

  const draftStart = draft && portRefPosition(shown, registry, draft.from);

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
          // Capture: runs before Konva's handlers. Konva prevents the default of
          // pointerdown on shapes, so focus by hand (Delete and Esc act only
          // while the canvas has focus), and a new click dismisses the message.
          onPointerDownCapture={() => {
            containerRef.current?.focus({ preventScroll: true });
            setMessage(null);
          }}
          // A wire is only ever drawn while the canvas has focus (above). Clicks
          // inside keep it; turning to the palette, Blockly or anything else
          // takes it away, so that ends the wire too: those releases never
          // reach the stage, and a leftover wire would keep components from
          // dragging and be finished by the next port click.
          onBlur={() => setDraft(null)}
        >
          {size && (
            <Stage
              width={size.width}
              height={size.height}
              onPointerDown={onStagePointerDown}
              onPointerUp={onStagePointerUp}
              onPointerMove={onStagePointerMove}
              onPointerLeave={() => setHoveredPort(null)}
            >
              <Layer>
                {shown.components.map((component) => (
                  <ComponentBody
                    key={component.id}
                    component={component}
                    definition={registry.get(component.deviceType)}
                    runtimeState={runtimeStateOf(simulation, component.id)}
                    selected={selected?.kind === 'component' && selected.id === component.id}
                    // Off while drawing a wire too, so a click there never starts a drag (R5).
                    draggable={!locked && !draft}
                    onPointerDown={() => onSelectablePointerDown({ kind: 'component', id: component.id })}
                    {...dragHandlers(component.id)}
                  />
                ))}
                {shown.wires.map((wire) => (
                  <WireLine
                    key={wire.id}
                    wire={wire}
                    circuit={shown}
                    registry={registry}
                    selected={selected?.kind === 'wire' && selected.id === wire.id}
                    onPointerDown={() => onSelectablePointerDown({ kind: 'wire', id: wire.id })}
                  />
                ))}
                {draft && draftStart && (
                  <Line
                    name="wire-preview"
                    points={[draftStart.x, draftStart.y, draft.pointer.x, draft.pointer.y]}
                    stroke="#2680c2"
                    strokeWidth={2}
                    dash={[6, 4]}
                    lineCap="round"
                    listening={false}
                  />
                )}
                {shown.components.map((component) => (
                  <PortMarkers
                    key={component.id}
                    component={component}
                    definition={registry.get(component.deviceType)}
                    highlightedPorts={highlightedPorts}
                    onPointerDown={onPortPointerDown}
                  />
                ))}
              </Layer>
            </Stage>
          )}
        </div>
        {message && (
          <p className="canvas-message" role="status" data-testid="canvas-message">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

function isSameRef(a: PortRef | null, b: PortRef | null): boolean {
  return a === b || (a !== null && b !== null && isSamePort(a, b));
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

type WireLineProps = {
  wire: Wire;
  circuit: Circuit;
  registry: DeviceRegistry;
  selected: boolean;
  onPointerDown(): void;
};

function WireLine({ wire, circuit, registry, selected, onPointerDown }: WireLineProps) {
  const from = portRefPosition(circuit, registry, wire.from);
  const to = portRefPosition(circuit, registry, wire.to);
  return (
    <Line
      name="wire"
      wireId={wire.id}
      selected={selected}
      points={[from.x, from.y, to.x, to.y]}
      stroke={selected ? '#2680c2' : '#334e68'}
      strokeWidth={selected ? 4 : 3}
      // Easier to click than the 3 px it shows.
      hitStrokeWidth={12}
      lineCap="round"
      onPointerDown={onPointerDown}
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

/**
 * Each marker takes clicks in a circle of the pick radius around its port and
 * is drawn above bodies and wires. So a click near a port never reaches the
 * component under it (no drag starts), and nearestPort decides which port.
 */
function pickAreaHit(context: Context, shape: Shape) {
  context.beginPath();
  context.arc(0, 0, stageToWorldDistance(portPickRadiusPx), 0, Math.PI * 2, false);
  context.closePath();
  context.fillStrokeShape(shape);
}

type PortMarkersProps = ComponentProps & {
  highlightedPorts: PortRef[];
  onPointerDown(event: KonvaEventObject<PointerEvent>): void;
};

function PortMarkers({ component, definition, highlightedPorts, onPointerDown }: PortMarkersProps) {
  return definition.ports.map((port) => {
    const at = portWorldPosition(component, definition, port.id);
    const highlighted = highlightedPorts.some((ref) => isSamePort(ref, { componentId: component.id, portId: port.id }));
    // Labels go on the body side of the marker; passive ports (LED, resistor)
    // stay unlabeled to keep small devices readable.
    const labelOnLeft = port.x > 0;
    return (
      <Group key={port.id}>
        <Circle
          name="port"
          componentId={component.id}
          portId={port.id}
          highlighted={highlighted}
          x={at.x}
          y={at.y}
          radius={highlighted ? 6 : 4}
          fill={portColors[port.kind]}
          stroke={highlighted ? '#f0b429' : '#ffffff'}
          strokeWidth={highlighted ? 2 : 1}
          hitFunc={pickAreaHit}
          onPointerDown={onPointerDown}
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
