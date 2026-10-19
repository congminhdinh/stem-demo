import type { Context } from 'konva/lib/Context';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import type { BoardContext } from '../../core/profiles/board-context';
import { isContact, peripheralComponentId, type ComponentInput, type ComponentState, type SimulationResult } from '../../core/simulation/simulate-circuit';
import { localizeDeviceDefinition } from '../i18n/devices';
import type { MessageKey } from '../i18n/messages';
import { useLocale, useText } from '../i18n/text';
import { partStateOf } from '../runtime-controls/display-view';
import { Palette } from './Palette';
import { paletteItems, placementPosition } from './palette-model';
import { rendererFor, type DeviceRendererProps } from './renderers';
import { useElementSize } from './use-element-size';
import { circuitBounds, fitViewport, identityViewport, portPickRadiusPx, stageToWorld, stageToWorldDistance } from './viewport';
import { canvasPalette } from './colors';

// Renders the design state plus, while running, the simulation snapshot, and
// edits the circuit (add, move, delete, wire). The document is the source of
// truth: Konva nodes are derived from it on every render and never stored, and
// every edit is a pure core operation handed to `onCircuitChange`. Selection,
// hover and the gesture in progress (a drag, a wire being drawn, a button
// held while running) are the only local, UI-only state.

type CircuitCanvasProps = {
  circuit: Circuit;
  registry: DeviceRegistry;
  /** Decides what the palette offers and which components are marked as not belonging here. */
  context: BoardContext;
  /** The run snapshot's simulation; null while idle (design state only). */
  simulation: SimulationResult | null;
  /** While a run is active the circuit cannot be edited (plan §3.4). */
  locked: boolean;
  /** Receives each edit as a whole new circuit. */
  onCircuitChange(circuit: Circuit): void;
  /** While running: a contact (push button) is held closed, or released. Never a design edit. */
  onContactChange(componentId: string, closed: boolean): void;
  /**
   * A lab launch (N8s): the circuit as it was loaded is shrunk, if needed, and centred to fit the canvas, and
   * fitted again when the canvas changes size, never when the circuit is edited. Absent: the identity viewport.
   */
  fit?: boolean;
  /**
   * The inputs the run is given, by component id (`<board>/<part>`), drawn on the board: a lab's check's (N8s) or, since N17 B2,
   * the learner's own while a run is on (the sensors' readings). Absent while no run is on.
   */
  inputs?: Readonly<Record<string, ComponentInput>>;
  /** N17 B2: how many one-shot events (shakes) each part had in the run, by component id; the board is drawn shaken after each. */
  events?: Readonly<Record<string, number>>;
  /**
   * N17 B4, while a run takes the learner's presses: a button drawn on a board (`<board>/<part>`) is pressed or let go by a pointer.
   * Absent (idle, a check), the buttons on the drawing take no press.
   */
  onPartPress?(componentId: string, pointerId: number, pressed: boolean): void;
  /** Shown over the top of the canvas, e.g. how a lab's check is going (N8s). */
  overlay?: ReactNode;
};

type Selection = { kind: 'component' | 'wire'; id: string };

/** A component being dragged: drawn where Konva has it, committed (snapped) on drop. */
type DragPreview = { componentId: string; position: Point };

/** A wire being drawn: from a port to the pointer, until another port is clicked. */
type WireDraft = { from: PortRef; pointer: Point };

// connectWire decides what is valid; the UI only words its answer. Only the
// first two can come from a click: ports come from the circuit, ids from nextWireId.
const wireErrorText: Record<ConnectWireError, MessageKey> = {
  'duplicate-wire': 'wire.duplicate-wire',
  'same-port': 'wire.same-port',
  'duplicate-wire-id': 'wire.rejected',
  'unknown-component': 'wire.rejected',
  'unknown-port': 'wire.rejected',
};

export function CircuitCanvas({
  circuit,
  registry,
  context,
  simulation,
  locked,
  onCircuitChange,
  onContactChange,
  fit = false,
  inputs,
  events,
  onPartPress,
  overlay,
}: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  // The canvas is mounted again for every loaded project (App keys it), so this is the circuit as loaded.
  const [loadedBounds] = useState(() => (fit ? circuitBounds(circuit, registry) : null));
  const viewport = useMemo(() => (fit && size ? fitViewport(loadedBounds, size) : identityViewport), [fit, size, loadedBounds]);
  const pickRadius = stageToWorldDistance(portPickRadiusPx, viewport);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const [draft, setDraft] = useState<WireDraft | null>(null);
  const [hoveredPort, setHoveredPort] = useState<PortRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const t = useText();
  const locale = useLocale();
  // What a body draws (its name, its parts' labels) in the UI's language (N8s); geometry keeps the registry's definitions.
  const drawnDefinition = useMemo(() => {
    const drawn = new Map<string, DeviceDefinition>();
    return (deviceType: string) => {
      let definition = drawn.get(deviceType);
      if (!definition) {
        definition = localizeDeviceDefinition(registry.get(deviceType), locale);
        drawn.set(deviceType, definition);
      }
      return definition;
    };
  }, [registry, locale]);
  // The button the pointer holds. Not rendered: how a button looks comes from
  // the snapshot (`closed`), like a lit LED, so the run stays the only source.
  const heldContact = useRef<string | null>(null);
  // A press ends with a release anywhere, also outside the canvas, or with a
  // cancelled pointer, so a button never sticks closed; and on unmount, when
  // another project is loaded.
  const releaseContact = useEffectEvent(() => {
    const componentId = heldContact.current;
    if (componentId !== null) {
      heldContact.current = null;
      onContactChange(componentId, false);
    }
  });
  useEffect(() => {
    window.addEventListener('pointerup', releaseContact);
    window.addEventListener('pointercancel', releaseContact);
    return () => {
      window.removeEventListener('pointerup', releaseContact);
      window.removeEventListener('pointercancel', releaseContact);
      releaseContact();
    };
  }, []);
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
    const point = stageToWorld(pointer, viewport);
    return { point, port: nearestPort(shown, registry, point, pickRadius) };
  };

  const add = (deviceType: string) => {
    const middle = stageToWorld({ x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 }, viewport);
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
      setMessage(t(wireErrorText[result.error]));
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

  // While running, pressing a contact closes it until release; while
  // designing it is selected like any other component.
  const onComponentPointerDown = (component: ComponentInstance) => {
    if (locked && isContact(registry.get(component.deviceType))) {
      heldContact.current = component.id;
      onContactChange(component.id, true);
    } else {
      onSelectablePointerDown({ kind: 'component', id: component.id });
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
  // Kept in the circuit, never removed for belonging to another family (R-F4); only marked.
  const incompatibleIds = new Set(context.incompatible.map((component) => component.id));

  return (
    <div className="circuit-editor">
      <Palette items={paletteItems(registry, context)} disabled={locked} onAdd={add} />
      <div className="circuit-canvas-area">
        <div
          ref={containerRef}
          className="circuit-canvas"
          data-testid="circuit-canvas"
          tabIndex={0}
          aria-label={t('canvas.label')}
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
              scaleX={viewport.scale}
              scaleY={viewport.scale}
              x={viewport.x}
              y={viewport.y}
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
                    definition={drawnDefinition(component.deviceType)}
                    incompatible={incompatibleIds.has(component.id)}
                    runtimeState={runtimeStateOf(simulation, component.id)}
                    partStates={partStatesOf(simulation, component.id, registry.get(component.deviceType))}
                    partInputs={partInputsOf(inputs, component.id, registry.get(component.deviceType))}
                    partEvents={partInputsOf(events, component.id, registry.get(component.deviceType))}
                    {...(onPartPress
                      ? { onPartPress: (partId: string, pointerId: number, pressed: boolean) => onPartPress(peripheralComponentId(component.id, partId), pointerId, pressed) }
                      : {})}
                    selected={selected?.kind === 'component' && selected.id === component.id}
                    // Off while drawing a wire too, so a click there never starts a drag (R5).
                    draggable={!locked && !draft}
                    onPointerDown={() => onComponentPointerDown(component)}
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
                    stroke={canvasPalette.selection}
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
                    pickRadius={pickRadius}
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
        {overlay}
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

/**
 * The states of a board's onboard parts, by part id, read from the snapshot as `<board>/<part>`; undefined
 * while idle and for a component whose definition has no onboard parts. Only parts that have a state are in it.
 */
export function partStatesOf(
  simulation: SimulationResult | null,
  componentId: string,
  definition: DeviceDefinition,
): Record<string, ComponentState> | undefined {
  const onboard = definition.board?.onboard;
  if (!simulation || !onboard) {
    return undefined;
  }
  // No prototype: a part id such as "__proto__" is a key here, not a way to replace the object's prototype.
  const states: Record<string, ComponentState> = Object.create(null);
  for (const part of onboard) {
    const state = partStateOf(simulation, componentId, part.id);
    if (state) {
      states[part.id] = state;
    }
  }
  return states;
}

/**
 * What was given to a board's onboard parts (their inputs, or their counts of events), by part id; undefined for nothing given
 * and for a component without parts.
 */
export function partInputsOf<Value>(
  inputs: Readonly<Record<string, Value>> | undefined,
  componentId: string,
  definition: DeviceDefinition,
): Record<string, Value> | undefined {
  const onboard = definition.board?.onboard;
  if (!inputs || !onboard) {
    return undefined;
  }
  // No prototype, as in partStatesOf: part ids are data.
  const given: Record<string, Value> = Object.create(null);
  for (const part of onboard) {
    const id = peripheralComponentId(componentId, part.id);
    if (Object.hasOwn(inputs, id)) {
      given[part.id] = inputs[id] as Value;
    }
  }
  return given;
}

type ComponentBodyProps = ComponentProps &
  Pick<DeviceRendererProps, 'runtimeState' | 'partStates' | 'partInputs' | 'partEvents' | 'onPartPress'> & {
    selected: boolean;
    /** The device does not belong to this kind of project (R-F4). */
    incompatible: boolean;
    draggable: boolean;
    onPointerDown(): void;
    onDragMove(event: KonvaEventObject<DragEvent>): void;
    onDragEnd(event: KonvaEventObject<DragEvent>): void;
  };

const selectionMargin = 6;

function ComponentBody({
  component,
  definition,
  runtimeState,
  partStates,
  partInputs,
  partEvents,
  onPartPress,
  selected,
  incompatible,
  ...interaction
}: ComponentBodyProps) {
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
      <Renderer
        definition={definition}
        runtimeState={runtimeState}
        partStates={partStates}
        partInputs={partInputs}
        partEvents={partEvents}
        {...(onPartPress ? { onPartPress } : {})}
      />
      {incompatible && (
        <Rect
          name="incompatible"
          x={-width / 2 - selectionMargin}
          y={-height / 2 - selectionMargin}
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke={canvasPalette.incompatible}
          strokeWidth={2}
          cornerRadius={4}
          listening={false}
        />
      )}
      {/* Drawn by the canvas, not the renderer: selection is editor state. */}
      {selected && (
        <Rect
          name="selection"
          x={-width / 2 - selectionMargin}
          y={-height / 2 - selectionMargin}
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke={canvasPalette.selection}
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
      stroke={selected ? canvasPalette.wire.selected : canvasPalette.wire.normal}
      strokeWidth={selected ? 4 : 3}
      // Easier to click than the 3 px it shows.
      hitStrokeWidth={12}
      lineCap="round"
      onPointerDown={onPointerDown}
    />
  );
}

const portColors: Record<PortDefinition['kind'], string> = {
  gpio: canvasPalette.port.gpio,
  power: canvasPalette.port.power,
  ground: canvasPalette.port.ground,
  passive: canvasPalette.port.passive,
};

const labelWidth = 48;

/**
 * Each marker takes clicks in a circle of the pick radius (world units) around
 * its port and is drawn above bodies and wires. So a click near a port never
 * reaches the component under it (no drag starts), and nearestPort decides which port.
 */
const pickAreaHit = (radius: number) => (context: Context, shape: Shape) => {
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2, false);
  context.closePath();
  context.fillStrokeShape(shape);
};

type PortMarkersProps = ComponentProps & {
  highlightedPorts: PortRef[];
  /** The pick radius in world units: the same screen distance at any scale. */
  pickRadius: number;
  onPointerDown(event: KonvaEventObject<PointerEvent>): void;
};

function PortMarkers({ component, definition, highlightedPorts, pickRadius, onPointerDown }: PortMarkersProps) {
  const hit = useMemo(() => pickAreaHit(pickRadius), [pickRadius]);
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
          stroke={highlighted ? canvasPalette.port.highlighted : canvasPalette.port.outline}
          strokeWidth={highlighted ? 2 : 1}
          hitFunc={hit}
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
            fill={canvasPalette.port.label}
            listening={false}
          />
        )}
      </Group>
    );
  });
}
