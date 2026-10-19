import { Group, Rect, Text } from 'react-konva';
import type { OnboardPeripheral } from '../../core/devices/device-definition';
import type { ComponentInput, ComponentState } from '../../core/simulation/simulate-circuit';
import { formatHz, toneHz } from '../audio/tone';
import { renderedPixels } from '../runtime-controls/display-view';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

// The body of a Yolo:Bit-compatible board (YB plan §8.4, S9): our own shell and the places of the onboard
// parts, drawn from the definition's data. What the parts show comes from the run snapshot only
// (`partStates`): the display's cells take their colour from its frame, and the buzzer is marked, with
// its frequency as text, while a note sounds. The buttons and the light sensor are labelled footprints:
// their pressed state and slider belong to the controls under the canvas, and the snapshot does not echo them;
// while a lab's check presses them (N8s), its inputs (`partInputs`) are drawn: a held button filled and ringed,
// the light's level as text beside it.

const {
  shell: shellFill,
  shellOutline: shellStroke,
  part: partFill,
  label: labelFill,
  sounding: soundingStroke,
  cellOff,
  cellLitRim,
  pressed: pressedFill,
} = canvasPalette.ybcBoard;
const cellGap = 3;

export function YbcBoardRenderer({ definition, partStates, partInputs }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const onboard = definition.board?.onboard ?? [];
  // Part ids are data: "constructor" must not find a member of Object.prototype.
  const stateOf = (partId: string): ComponentState | undefined =>
    partStates && Object.hasOwn(partStates, partId) ? partStates[partId] : undefined;
  const inputOf = (partId: string): ComponentInput | undefined =>
    partInputs && Object.hasOwn(partInputs, partId) ? partInputs[partId] : undefined;
  return (
    <>
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
          <PartFootprint key={part.id} part={part} hz={part.model === 'buzzer' ? toneHz(stateOf(part.id)) : undefined} input={inputOf(part.id)} />
        ),
      )}
    </>
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
 * what a lab's check gives the part: a held button is filled and ringed, a light level is written beside it;
 * both are set on the group too (`pressed`, `level`).
 */
function PartFootprint({ part, hz, input }: { part: OnboardPeripheral; hz?: number; input?: ComponentInput }) {
  const { x, y, width, height } = part.at;
  const sounding = hz !== undefined;
  const pressed = input?.kind === 'hold' && input.closed;
  const level = input?.kind === 'slider' ? input.value : undefined;
  const ring = sounding ? soundingStroke : pressed ? labelFill : undefined;
  return (
    <Group name={`ybc-part-${part.id}`} hz={hz} pressed={pressed} level={level} listening={false}>
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
      <Text text={part.label} x={x} y={y + height / 2 - 5} width={width} align="center" fontSize={10} fill={labelFill} />
      {sounding && <Text text={formatHz(hz)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} />}
      {level !== undefined && <Text text={String(level)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} />}
    </Group>
  );
}

function numberConfig(part: OnboardPeripheral, key: string): number {
  const value = part.config?.[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}
