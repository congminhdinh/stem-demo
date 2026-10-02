import { useRef } from 'react';
import { Circle, Group, Layer, Line, Stage, Text } from 'react-konva';
import type { Circuit, ComponentInstance, Wire } from '../../core/circuit/document';
import { portRefPosition, portWorldPosition } from '../../core/circuit/geometry';
import type { DeviceDefinition, PortDefinition } from '../../core/devices/device-definition';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { SimulationResult } from '../../core/simulation/simulate-circuit';
import { rendererFor, type DeviceRendererProps } from './renderers';
import { useElementSize } from './use-element-size';

// Renders the design state plus, while running, the simulation snapshot. The
// document is the source of truth; Konva nodes are derived from it on every
// render and never stored. The viewport is fixed (world = stage coordinates)
// until pan/zoom exists.

type CircuitCanvasProps = {
  circuit: Circuit;
  registry: DeviceRegistry;
  /** The run snapshot's simulation; null while idle (design state only). */
  simulation: SimulationResult | null;
};

export function CircuitCanvas({ circuit, registry, simulation }: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);

  return (
    <div ref={containerRef} className="circuit-canvas" data-testid="circuit-canvas">
      {size && (
        <Stage width={size.width} height={size.height}>
          <Layer>
            {circuit.components.map((component) => (
              <ComponentBody
                key={component.id}
                component={component}
                definition={registry.get(component.deviceType)}
                runtimeState={runtimeStateOf(simulation, component.id)}
              />
            ))}
            {circuit.wires.map((wire) => (
              <WireLine key={wire.id} wire={wire} circuit={circuit} registry={registry} />
            ))}
            {circuit.components.map((component) => (
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
  );
}

type ComponentProps = { component: ComponentInstance; definition: DeviceDefinition };

/** Component ids are data, so they must not resolve to Object.prototype members. */
function runtimeStateOf(simulation: SimulationResult | null, componentId: string) {
  return simulation && Object.hasOwn(simulation.components, componentId)
    ? simulation.components[componentId]
    : undefined;
}

function ComponentBody({
  component,
  definition,
  runtimeState,
}: ComponentProps & Pick<DeviceRendererProps, 'runtimeState'>) {
  const Renderer = rendererFor(definition);
  return (
    <Group
      name="component"
      componentId={component.id}
      deviceType={component.deviceType}
      x={component.position.x}
      y={component.position.y}
    >
      <Renderer definition={definition} runtimeState={runtimeState} />
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
