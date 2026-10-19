import type { KonvaEventObject } from 'konva/lib/Node';
import { useEffect, useRef, useState } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type { OnboardPeripheral } from '../../core/devices/device-definition';
import { accelerationOf } from '../../core/simulation/peripherals/accelerometer';
import { temperatureOf } from '../../core/simulation/peripherals/temperature';
import { inputKindOfModel, type ComponentInput, type ComponentState } from '../../core/simulation/simulate-circuit';
import { formatHz, toneHz } from '../audio/tone';
import { renderedPixels } from '../runtime-controls/display-view';
import { prefersReducedMotion, useShaking } from '../runtime-controls/use-shaking';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

// The body of a Yolo:Bit-compatible board (YB plan §8.4, S9): our own shell and the places of the onboard
// parts, drawn from the definition's data. What the parts show comes from the run snapshot only
// (`partStates`): the display's cells take their colour from its frame, and the buzzer is marked, with
// its frequency as text, while a note sounds. The buttons and the light sensor are labelled footprints:
// their pressed state and slider belong to the controls under the canvas, and the snapshot does not echo them;
// while a lab's check presses them (N8s), its inputs (`partInputs`) are drawn: a held button filled and ringed,
// the light's level as text beside it. N17 B2: while a run is on, a quiet line under the display reads what the temperature
// sensor and the accelerometer sense (25 °C and x 0 y 0 z −1024 until the controls say otherwise), and a shake jiggles the
// board for a moment (only marked, the accelerometer ringed, when the person asked for less motion). N17 B4: while a run takes the
// learner's presses (`onPartPress`), the buttons drawn on the board are pressed with the pointer: a hand over them, held while the
// pointer is down on one, and let go on pointerup, pointerleave, pointercancel, a lost capture, a release anywhere on the page, and
// when presses stop being taken, so a button never sticks (Review Focus 2). They are drawn pressed from what the run is given, as
// the panel's buttons are: the two share one state (src/ui/runtime-controls/board-buttons.ts). Keyboard presses are the panel's.
// N17 B6: the line under the display reads only the sensors the profile gives a control (`controls`), so the Basic board, which has
// no temperature or accelerometer control, writes no readings.

const {
  shell: shellFill,
  shellOutline: shellStroke,
  part: partFill,
  label: labelFill,
  sounding: soundingStroke,
  cellOff,
  cellLitRim,
  pressed: pressedFill,
  readout: readoutFill,
} = canvasPalette.ybcBoard;
const cellGap = 3;
/** How long the board jiggles after a shake, in ms (the shake itself lasts 1 s; the jiggle is only its sign). */
const JIGGLE_MS = 450;

/** The board's x offset while it jiggles after the `count`-th shake: 0 at rest, and always 0 for someone who asked for less motion. */
function useJiggle(count: number): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (count === 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= JIGGLE_MS) {
        setOffset(0);
        return;
      }
      setOffset(Math.round(Math.sin(elapsed / 22) * 5 * (1 - elapsed / JIGGLE_MS)));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      setOffset(0);
    };
  }, [count]);
  return offset;
}

type PressOf = NonNullable<DeviceRendererProps['onPartPress']>;

/**
 * N17 B4: which button each pointer holds on the drawing, and what to tell when it lets go. Each press keeps the callback that made
 * it, so a press is let go through the same one even after the run stopped taking presses. A release anywhere on the page and the
 * end of taking presses (no callback any more, or the drawing goes away) let go of everything.
 */
function usePartPresses(onPartPress: PressOf | undefined) {
  const held = useRef(new Map<number, { partId: string; press: PressOf }>());
  // The canvas the hand is shown on, so it is taken away again when presses stop being taken while the pointer is over a button.
  const hovered = useRef<HTMLElement | null>(null);
  const release = (pointerId: number) => {
    const holding = held.current.get(pointerId);
    if (holding) {
      held.current.delete(pointerId);
      holding.press(holding.partId, pointerId, false);
    }
  };
  const pressable = onPartPress !== undefined;
  useEffect(() => {
    if (!pressable) {
      return;
    }
    const holding = held.current;
    const onRelease = (event: PointerEvent) => {
      const press = holding.get(event.pointerId);
      if (press) {
        holding.delete(event.pointerId);
        press.press(press.partId, event.pointerId, false);
      }
    };
    window.addEventListener('pointerup', onRelease);
    window.addEventListener('pointercancel', onRelease);
    return () => {
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('pointercancel', onRelease);
      for (const [pointerId, press] of [...holding]) {
        holding.delete(pointerId);
        press.press(press.partId, pointerId, false);
      }
      if (hovered.current) {
        hovered.current.style.cursor = '';
        hovered.current = null;
      }
    };
  }, [pressable]);
  /** The hand over a button that can be pressed, and the default cursor again when the pointer leaves it. */
  const hover = (event: KonvaEventObject<PointerEvent>, over: boolean) => {
    const container = event.target.getStage()?.container() ?? null;
    if (container) {
      container.style.cursor = over ? 'pointer' : '';
    }
    hovered.current = over ? container : null;
  };
  const press = (partId: string, pointerId: number) => {
    if (onPartPress && !held.current.has(pointerId)) {
      held.current.set(pointerId, { partId, press: onPartPress });
      onPartPress(partId, pointerId, true);
    }
  };
  return { pressable, press, release, hover };
}

export function YbcBoardRenderer({ definition, partStates, partInputs, partEvents, onPartPress, controls }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const presses = usePartPresses(onPartPress);
  const onboard = definition.board?.onboard ?? [];
  // Part ids are data: "constructor" must not find a member of Object.prototype.
  const stateOf = (partId: string): ComponentState | undefined =>
    partStates && Object.hasOwn(partStates, partId) ? partStates[partId] : undefined;
  const inputOf = (partId: string): ComponentInput | undefined =>
    partInputs && Object.hasOwn(partInputs, partId) ? partInputs[partId] : undefined;
  const controlled = (part: OnboardPeripheral | undefined) => (part && controls?.includes(part.id) ? part : undefined);
  const temperaturePart = controlled(onboard.find((part) => part.model === 'temperature-sensor'));
  const accelerometerPart = controlled(onboard.find((part) => part.model === 'accelerometer'));
  const shakes = accelerometerPart && partEvents && Object.hasOwn(partEvents, accelerometerPart.id) ? (partEvents[accelerometerPart.id] ?? 0) : 0;
  const shaking = useShaking(shakes);
  const jiggle = useJiggle(shakes);
  // The readings, while a run is on (the inputs are given then, `{}` before the first): what the program reads, worked out by the
  // same functions the run uses.
  const degrees = partInputs && temperaturePart ? temperatureOf(inputOf(temperaturePart.id)) : undefined;
  const reading = partInputs && accelerometerPart ? accelerationOf(inputOf(accelerometerPart.id)) : undefined;
  const display = onboard.find((part) => part.model === 'matrix-display');
  const readoutText = [
    degrees === undefined ? null : `${degrees} °C`,
    reading === undefined ? null : `x ${reading.x}  y ${reading.y}  z ${reading.z}`,
  ]
    .filter((part) => part !== null)
    .join('   ');
  return (
    <Group name="ybc-body" x={jiggle} shaking={shaking}>
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        cornerRadius={14}
        fill={shellFill}
        stroke={shellStroke}
        strokeWidth={2}
      />
      <Text
        text={definition.name}
        x={-width / 2}
        y={height / 2 - 18}
        width={width}
        align="center"
        fontSize={11}
        fill={labelFill}
        listening={false}
      />
      {onboard.map((part) =>
        part.model === 'matrix-display' ? (
          <DisplayGrid key={part.id} part={part} state={stateOf(part.id)} />
        ) : (
          <PartFootprint
            key={part.id}
            part={part}
            hz={part.model === 'buzzer' ? toneHz(stateOf(part.id)) : undefined}
            input={inputOf(part.id)}
            shaken={part === accelerometerPart && shaking}
            presses={presses.pressable && Object.hasOwn(inputKindOfModel, part.model) && inputKindOfModel[part.model] === 'hold' ? presses : undefined}
          />
        ),
      )}
      {readoutText !== '' && (
        <Text
          name="ybc-readouts"
          temperature={degrees}
          acceleration={reading}
          text={readoutText}
          x={-width / 2 + 6}
          y={(display ? display.at.y + display.at.height : 0) + 3}
          width={width - 12}
          align="center"
          fontSize={10}
          fill={readoutFill}
          listening={false}
        />
      )}
    </Group>
  );
}

/**
 * The display's cell grid, from the definition's `config` (the contract's 5×5). The pixel at column x, row y
 * is `frame.pixels[y * 5 + x]`, origin top left; a state without a well-formed frame draws every cell off.
 * `frame` is set on the group, like `closed` on a push button, so tests read what was rendered (plan §11.4).
 */
function DisplayGrid({ part, state }: { part: OnboardPeripheral; state: ComponentState | undefined }) {
  const columns = numberConfig(part, 'width');
  const rows = numberConfig(part, 'height');
  const cell = Math.min(part.at.width / columns, part.at.height / rows);
  const pixels = renderedPixels(state);
  return (
    <Group name="ybc-display" x={part.at.x} y={part.at.y} columns={columns} rows={rows} frame={pixels} listening={false}>
      {Array.from({ length: columns * rows }, (_, index) => {
        // A lit cell has a light rim and glows in its own colour, so a dark colour of the palette never reads as off (N17 B1).
        const lit = pixels[index] ?? null;
        return (
          <Rect
            key={index}
            x={(index % columns) * cell + cellGap / 2}
            y={Math.floor(index / columns) * cell + cellGap / 2}
            width={cell - cellGap}
            height={cell - cellGap}
            cornerRadius={3}
            fill={lit ?? cellOff}
            stroke={lit === null ? undefined : cellLitRim}
            strokeWidth={lit === null ? 0 : 1}
            shadowColor={lit ?? undefined}
            shadowBlur={lit === null ? 0 : 6}
            shadowEnabled={lit !== null}
          />
        );
      })}
    </Group>
  );
}

/**
 * A labelled place of a part. `hz` is only given for the buzzer, and while it sounds the footprint gets a ring
 * and the frequency as text (a colour is never the only sign); it is also set on the group for tests. `input` is
 * what the run is given for the part: a held button is filled and ringed, a light level is written beside it;
 * both are set on the group too (`pressed`, `level`). `shaken`: the accelerometer is ringed while the board is shaken (N17 B2).
 * `presses`: a button the learner can press with the pointer now (N17 B4), set on the group as `pressable`.
 */
function PartFootprint({
  part,
  hz,
  input,
  shaken = false,
  presses,
}: {
  part: OnboardPeripheral;
  hz?: number;
  input?: ComponentInput;
  shaken?: boolean;
  presses?: Pick<ReturnType<typeof usePartPresses>, 'press' | 'release' | 'hover'>;
}) {
  const { x, y, width, height } = part.at;
  const sounding = hz !== undefined;
  const pressed = input?.kind === 'hold' && input.closed;
  // Only the light's level is written beside the part: the temperature has the line under the display (N17 B2).
  const level = input?.kind === 'slider' && part.model === 'light-sensor' ? input.value : undefined;
  const ring = sounding || shaken ? soundingStroke : pressed ? labelFill : undefined;
  const release = (event: KonvaEventObject<PointerEvent>) => presses?.release(event.evt.pointerId);
  return (
    <Group
      name={`ybc-part-${part.id}`}
      hz={hz}
      pressed={pressed}
      level={level}
      shaken={shaken}
      pressable={presses !== undefined}
      listening={presses !== undefined}
      {...(presses
        ? {
            onPointerDown: (event: KonvaEventObject<PointerEvent>) => {
              if (event.evt.button !== 0) {
                return;
              }
              // The press is the button's: the board under it is not selected or dragged (it is locked while running anyway).
              event.cancelBubble = true;
              presses.press(part.id, event.evt.pointerId);
            },
            onPointerUp: release,
            onPointerCancel: release,
            onLostPointerCapture: release,
            onPointerEnter: (event: KonvaEventObject<PointerEvent>) => presses.hover(event, true),
            onPointerLeave: (event: KonvaEventObject<PointerEvent>) => {
              release(event);
              presses.hover(event, false);
            },
          }
        : {})}
    >
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        cornerRadius={6}
        fill={pressed ? pressedFill : partFill}
        stroke={ring}
        strokeWidth={ring === undefined ? 0 : 3}
      />
      <Text text={part.label} x={x} y={y + height / 2 - 5} width={width} align="center" fontSize={10} fill={labelFill} listening={false} />
      {sounding && <Text text={formatHz(hz)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} listening={false} />}
      {level !== undefined && <Text text={String(level)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} listening={false} />}
    </Group>
  );
}

function numberConfig(part: OnboardPeripheral, key: string): number {
  const value = part.config?.[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}
