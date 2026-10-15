import { useEffect, useState } from 'react';
import type { Circuit } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import { SLIDER_MAX_PERCENT, SLIDER_MIN_PERCENT, inputKindOfModel, type SimulationResult } from '../../core/simulation/simulate-circuit';

// The runtime control of a potentiometer (plan §11.3 `slider`): a native range input, labelled, operable with
// the keyboard and by touch. It only adapts input: the number it shows is the one in the run snapshot, and a
// change goes to the run as a `slider` input (YB-CP `setComponentInput`). Nothing about the board's behaviour
// lives here. The controls exist only while a run does: a potentiometer's position is state of the run, not of
// the document (B2).

type PotentiometerControlsProps = {
  circuit: Circuit;
  registry: DeviceRegistry;
  /** The run snapshot's simulation; the position shown is the one in it. */
  simulation: SimulationResult | null;
  /** A change of position, as a whole percentage. */
  onChange(componentId: string, percent: number): void;
};

export function PotentiometerControls({ circuit, registry, simulation, onChange }: PotentiometerControlsProps) {
  // A component of the circuit whose model takes a `slider` input (YB-CP input routing: `inputKindOfModel`).
  const knobs = circuit.components.filter(
    (component) => inputKindOfModel[registry.get(component.deviceType).simulation.model] === 'slider',
  );
  if (knobs.length === 0) {
    return null;
  }
  return (
    <div className="potentiometer-controls" role="group" aria-label="Potentiometers" data-testid="potentiometer-controls">
      {knobs.map((component, index) => (
        <PotentiometerSlider
          key={component.id}
          componentId={component.id}
          label={`${registry.get(component.deviceType).name} ${index + 1}`}
          shown={simulation && Object.hasOwn(simulation.components, component.id) ? (simulation.components[component.id]?.value ?? 0) : 0}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

type PotentiometerSliderProps = {
  componentId: string;
  label: string;
  /** The position in the latest snapshot. */
  shown: number;
  onChange(componentId: string, percent: number): void;
};

function PotentiometerSlider({ componentId, label, shown, onChange }: PotentiometerSliderProps) {
  // The snapshot reaches React at most once per frame, so while a thumb is dragged the input echoes what the
  // learner just chose; the echo is dropped as soon as the snapshot has caught up with it.
  const [echo, setEcho] = useState<number | null>(null);
  useEffect(() => {
    if (echo !== null && echo === shown) {
      setEcho(null);
    }
  }, [echo, shown]);
  const value = echo ?? shown;
  return (
    <label className="runtime-control">
      <span className="runtime-control-name">{label}</span>
      <input
        type="range"
        min={SLIDER_MIN_PERCENT}
        max={SLIDER_MAX_PERCENT}
        step={1}
        value={value}
        data-component-id={componentId}
        aria-valuetext={`${value} %`}
        onChange={(event) => {
          const percent = Number(event.currentTarget.value);
          setEcho(percent);
          onChange(componentId, percent);
        }}
      />
      <output className="runtime-control-value">{value} %</output>
    </label>
  );
}
