import { useEffect, useEffectEvent, useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentInput } from '../../core/simulation/simulate-circuit';
import { controlsOf, sliderValueOf, type ControlSpec } from './controls-model';
import { createHoldTracker, isHoldKey } from './hold-tracker';

// The inputs of a running board: its buttons and its light sensor. These are input adapters and nothing
// more: they send `ComponentInput` for the part (`<board>/<part>`) to the run through `onInput`, and the
// run decides what that means. What a control shows of itself (pressed, the slider's place) is its own
// presentation; what the board does is drawn from the snapshot. Inputs belong to a run (B2): the owner
// gives the controls a new key for each run, so every run starts from their initial place.

type RuntimeControlsProps = {
  /** The id of the board component of the circuit. */
  boardId: string;
  definition: DeviceDefinition;
  /** The ids of the onboard parts that have a control (the profile's `controls`). */
  controls: readonly string[];
  /** True while a run is active; the controls do nothing before and after. */
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
};

export function RuntimeControls({ boardId, definition, controls, active, onInput }: RuntimeControlsProps) {
  const specs = controlsOf(boardId, definition, controls);
  if (specs.length === 0) {
    return null;
  }
  return (
    <div className="runtime-controls" role="group" aria-label="Board controls" data-testid="runtime-controls">
      {specs.map((spec) =>
        spec.kind === 'hold' ? (
          <HoldButton key={spec.partId} spec={spec} active={active} onInput={onInput} />
        ) : (
          <RangeControl key={spec.partId} spec={spec} active={active} onInput={onInput} />
        ),
      )}
    </div>
  );
}

type ControlProps<Kind extends ControlSpec['kind']> = {
  spec: Extract<ControlSpec, { kind: Kind }>;
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
};

const keySource = (key: string) => `key:${key}`;
const pointerSource = (pointerId: number) => `pointer:${pointerId}`;

/** Closed while a pointer or a key holds it, open when nothing does, also when it is disabled, loses focus or goes away. */
function HoldButton({ spec, active, onInput }: ControlProps<'hold'>) {
  const [tracker] = useState(createHoldTracker);
  // Only for how the button looks (aria-pressed, styling); what the run sees is the tracker's changes.
  const [pressed, setPressed] = useState(false);
  const send = (closed: boolean | undefined) => {
    if (closed !== undefined) {
      setPressed(closed);
      onInput(spec.componentId, { kind: 'hold', closed });
    }
  };
  const releaseAll = useEffectEvent(() => send(tracker.releaseAll()));
  // A disabled button gets no pointerup and may get no blur, so ending the run (or removing the control) releases it here.
  useEffect(() => {
    if (active) {
      return () => releaseAll();
    }
  }, [active]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture for a pointer that is not active: the release events below still end the hold.
    }
    send(tracker.hold(pointerSource(event.pointerId)));
  };
  const onPointerEnd = (event: PointerEvent<HTMLButtonElement>) => send(tracker.release(pointerSource(event.pointerId)));
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (isHoldKey(event.key)) {
      event.preventDefault();
      // A repeating key holds what it already holds: the tracker answers with no change.
      send(tracker.hold(keySource(event.key)));
    }
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (isHoldKey(event.key)) {
      send(tracker.release(keySource(event.key)));
    }
  };

  return (
    <button
      type="button"
      className="control-hold"
      data-testid={`control-${spec.partId}`}
      aria-pressed={pressed}
      disabled={!active}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onBlur={() => send(tracker.releaseAll())}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      {spec.label}
    </button>
  );
}

/** A slider of the part's range, an integer, which the run reads as the value of the sensor. */
function RangeControl({ spec, active, onInput }: ControlProps<'slider'>) {
  const { min, max, initial } = spec.range;
  const [value, setValue] = useState(initial);
  const inputId = useId();
  const onChange = (raw: string) => {
    const next = sliderValueOf(raw, spec.range);
    // The browser fires this only when the value changed, so every call is a new level.
    if (next !== null) {
      setValue(next);
      onInput(spec.componentId, { kind: 'slider', value: next });
    }
  };

  return (
    <div className="control-slider">
      <label htmlFor={inputId}>{spec.label}</label>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={!active}
        data-testid={`control-${spec.partId}`}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <span className="control-slider-value" data-testid={`control-${spec.partId}-value`}>
        {value}
      </span>
    </div>
  );
}
