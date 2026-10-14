import { Group, Rect, Text } from 'react-konva';
import type { OnboardPeripheral } from '../../core/devices/device-definition';
import type { DeviceRendererProps } from './renderers';

// The body of a Yolo:Bit-compatible board (YB plan §8.4, S9): our own shell and
// the places of the onboard parts, drawn from the definition's data. This is
// structure only. The display shows its 5×5 grid dark and the other parts
// are labelled footprints; what they do (lit pixels, pressed buttons, sound)
// is drawn by the capability phases from the run snapshot.

const shellFill = '#1f4e5f';
const shellStroke = '#143642';
const partFill = '#2c7a8c';
const labelFill = '#e6f4f7';
const cellOff = '#10292f';
const cellGap = 3;

export function YbcBoardRenderer({ definition }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const onboard = definition.board?.onboard ?? [];
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
        part.model === 'matrix-display' ? <DisplayGrid key={part.id} part={part} /> : <PartFootprint key={part.id} part={part} />,
      )}
    </>
  );
}

/** The display's cell grid, from the definition's `config` (the contract's 5×5), all cells off. */
function DisplayGrid({ part }: { part: OnboardPeripheral }) {
  const columns = numberConfig(part, 'width');
  const rows = numberConfig(part, 'height');
  const cell = Math.min(part.at.width / columns, part.at.height / rows);
  return (
    <Group name="ybc-display" x={part.at.x} y={part.at.y} columns={columns} rows={rows} listening={false}>
      {Array.from({ length: columns * rows }, (_, index) => (
        <Rect
          key={index}
          x={(index % columns) * cell + cellGap / 2}
          y={Math.floor(index / columns) * cell + cellGap / 2}
          width={cell - cellGap}
          height={cell - cellGap}
          cornerRadius={3}
          fill={cellOff}
        />
      ))}
    </Group>
  );
}

function PartFootprint({ part }: { part: OnboardPeripheral }) {
  const { x, y, width, height } = part.at;
  return (
    <Group name={`ybc-part-${part.id}`} listening={false}>
      <Rect x={x} y={y} width={width} height={height} cornerRadius={6} fill={partFill} />
      <Text text={part.label} x={x} y={y + height / 2 - 5} width={width} align="center" fontSize={10} fill={labelFill} />
    </Group>
  );
}

function numberConfig(part: OnboardPeripheral, key: string): number {
  const value = part.config?.[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}
