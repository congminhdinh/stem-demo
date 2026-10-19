import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import { accelerationOf, gestureOf } from '../../core/simulation/peripherals/accelerometer';
import type { ComponentInput } from '../../core/simulation/simulate-circuit';
import { isMessageKey } from '../i18n/messages';
import { useText } from '../i18n/text';
import {
  controlsOf,
  flatTilt,
  padPointOfTilt,
  sliderValueOf,
  tiltAfterKey,
  tiltInputOf,
  tiltOfPadPoint,
  tiltStateOf,
  type ControlSpec,
  type TiltState,
} from './controls-model';
import { createHoldTracker, isHoldKey } from './hold-tracker';
import { useShaking } from './use-shaking';

// The inputs of a running board: its buttons and its light sensor. These are input adapters and nothing
// more: they send `ComponentInput` for the part (`<board>/<part>`) to the run through `onInput`, and the
// run decides what that means. What a control shows of itself (pressed, the slider's place) is its own
// presentation; what the board does is drawn from the snapshot. Inputs belong to a run (B2): the owner
// gives the controls a new key for each run, so every run starts from their initial place. While a lab's
// check drives the run (N8s), the controls only show what the check gives the board (`scripted`): pressed
// buttons, the light's level; the learner cannot press them then. N17 B2 adds the temperature (a slider in °C) and the
// accelerometer: a tilt pad (drag the dot, or the arrow keys) with the gesture it makes, "Úp mặt" and "Lắc".

type RuntimeControlsProps = {
  /** The id of the board component of the circuit. */
  boardId: string;
  definition: DeviceDefinition;
  /** The ids of the onboard parts that have a control (the profile's `controls`). */
  controls: readonly string[];
  /** True while a run is active; the controls do nothing before and after. */
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
  /** While a lab's check drives the run: the inputs it gave, by component id; the controls show them and take none. */
  scripted?: Readonly<Record<string, ComponentInput>>;
  /** While a lab's check drives the run: how many shakes it gave each part (N17 B2), shown as the gesture for 1 s. */
  scriptedEvents?: Readonly<Record<string, number>>;
};

export function RuntimeControls({ boardId, definition, controls, active, onInput, scripted, scriptedEvents }: RuntimeControlsProps) {
  const t = useText();
  // A part the dictionary does not know keeps the label the model gives it.
  const specs = controlsOf(boardId, definition, controls).map((spec) => {
    const key = `control.${spec.partId}`;
    return isMessageKey(key) ? { ...spec, label: t(key) } : spec;
  });
  if (specs.length === 0) {
    return null;
  }
  return (
    <div className="runtime-controls" role="group" aria-label={t('controls.label')} data-testid="runtime-controls">
      {specs.map((spec) => {
        const shown = scripted ? { input: Object.hasOwn(scripted, spec.componentId) ? scripted[spec.componentId] : undefined } : undefined;
        if (spec.kind === 'hold') {
          return <HoldButton key={spec.partId} spec={spec} active={active && !shown} onInput={onInput} scripted={shown} />;
        }
        if (spec.kind === 'tilt') {
          const shakes = scriptedEvents && Object.hasOwn(scriptedEvents, spec.componentId) ? (scriptedEvents[spec.componentId] ?? 0) : 0;
          return <TiltControl key={spec.partId} spec={spec} active={active && !shown} onInput={onInput} scripted={shown} scriptedShakes={shakes} />;
        }
        return <RangeControl key={spec.partId} spec={spec} active={active && !shown} onInput={onInput} scripted={shown} />;
      })}
    </div>
  );
}

type ControlProps<Kind extends ControlSpec['kind']> = {
  spec: Extract<ControlSpec, { kind: Kind }>;
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
  /** Set while a check drives the run: what it gave this part (undefined: nothing yet), shown instead of the control's own state. */
  scripted?: { input: ComponentInput | undefined };
};

const keySource = (key: string) => `key:${key}`;
const pointerSource = (pointerId: number) => `pointer:${pointerId}`;

/** Closed while a pointer or a key holds it, open when nothing does, also when it is disabled, loses focus or goes away. */
function HoldButton({ spec, active, onInput, scripted }: ControlProps<'hold'>) {
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
      aria-pressed={scripted ? scripted.input?.kind === 'hold' && scripted.input.closed : pressed}
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
function RangeControl({ spec, active, onInput, scripted }: ControlProps<'slider'>) {
  const { min, max, initial } = spec.range;
  const [own, setValue] = useState(initial);
  const value = scripted ? (scripted.input?.kind === 'slider' ? scripted.input.value : initial) : own;
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
        {spec.range.unit === undefined ? value : `${value} ${spec.range.unit}`}
      </span>
    </div>
  );
}

/**
 * The accelerometer (N17 B2): a square pad with a dot the learner drags (or moves with the arrow keys, 128 mg a press; Home lays
 * the board flat), "Úp mặt" to turn the board face down, and "Lắc", which shakes it for 1 s. Next to the pad, the gesture the
 * board makes now, as the program's `is_gesture` sees it. Each change sends the run the tilt (`tilt`) or the shake (`gesture`).
 */
function TiltControl({ spec, active, onInput, scripted, scriptedShakes }: ControlProps<'tilt'> & { scriptedShakes: number }) {
  const t = useText();
  const [own, setOwn] = useState<TiltState>(flatTilt);
  const [shakes, setShakes] = useState(0);
  const tilt = scripted ? tiltStateOf(scripted.input) : own;
  const shaking = useShaking(scripted ? scriptedShakes : shakes);
  const reading = accelerationOf(tiltInputOf(tilt));
  const gesture = shaking ? 'shake' : gestureOf(reading);
  const dot = padPointOfTilt(tilt);
  const dragging = useRef<number | null>(null);
  const labelId = useId();
  const hintId = useId();
  const gestureId = useId();

  const move = (next: TiltState) => {
    if (next.x === own.x && next.y === own.y && next.faceDown === own.faceDown) {
      return;
    }
    setOwn(next);
    onInput(spec.componentId, tiltInputOf(next));
  };
  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      return;
    }
    const right = ((event.clientX - box.left) / box.width) * 2 - 1;
    const down = ((event.clientY - box.top) / box.height) * 2 - 1;
    move(tiltOfPadPoint(right, down, own.faceDown));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture for a pointer that is not active: the moves over the pad still work.
    }
    dragging.current = event.pointerId;
    moveTo(event);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (active && dragging.current === event.pointerId) {
      moveTo(event);
    }
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current === event.pointerId) {
      dragging.current = null;
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = active ? tiltAfterKey(own, event.key) : null;
    if (next) {
      event.preventDefault();
      move(next);
    }
  };
  const shake = () => {
    setShakes((count) => count + 1);
    onInput(spec.componentId, { kind: 'gesture' });
  };

  return (
    <div className="control-tilt" role="group" aria-labelledby={labelId} data-gesture={gesture ?? 'none'}>
      <span id={labelId} className="control-tilt-label">
        {spec.label}
      </span>
      <div
        className="tilt-pad"
        data-testid={`control-${spec.partId}`}
        data-x={reading.x}
        data-y={reading.y}
        data-z={reading.z}
        role="slider"
        aria-roledescription={t('control.accelerometer')}
        aria-labelledby={labelId}
        aria-describedby={`${hintId} ${gestureId}`}
        aria-valuemin={-1024}
        aria-valuemax={1024}
        aria-valuenow={reading.x}
        aria-valuetext={t('control.tilt.value', { x: reading.x, y: reading.y, z: reading.z })}
        aria-disabled={!active}
        tabIndex={active ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <span className="tilt-pad-cross" aria-hidden="true" />
        <span className="tilt-pad-dot" aria-hidden="true" style={{ left: `${50 + dot.right * 50}%`, top: `${50 + dot.down * 50}%` }} />
      </div>
      <output id={gestureId} className="control-tilt-gesture" data-testid={`control-${spec.partId}-gesture`} aria-live="polite">
        {t(gesture ? `gesture.${gesture}` : 'gesture.none')}
      </output>
      <span id={hintId} className="control-tilt-hint">
        {t('control.tilt.hint')}
      </span>
      <div className="control-tilt-actions">
        <button
          type="button"
          data-testid={`control-${spec.partId}-face-down`}
          aria-pressed={tilt.faceDown}
          disabled={!active}
          onClick={() => move({ ...own, faceDown: !own.faceDown })}
        >
          {t('control.faceDown')}
        </button>
        <button type="button" data-testid={`control-${spec.partId}-shake`} disabled={!active} onClick={shake}>
          {t('control.shake')}
        </button>
      </div>
    </div>
  );
}
