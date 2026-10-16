import { Circle, Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

const capRadius = 13;

/** A tactile button seen from above; the cap sinks while the snapshot says it is closed. */
export function PushButtonRenderer({ definition, runtimeState }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const closed = runtimeState?.closed === true;
  return (
    <>
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        cornerRadius={4}
        fill={canvasPalette.pushButton.body}
        stroke={canvasPalette.pushButton.outline}
      />
      {/* `closed` is set on the node so tests read what was rendered (plan §11.4). */}
      <Circle
        name="button-cap"
        closed={closed}
        radius={closed ? capRadius - 2 : capRadius}
        fill={closed ? canvasPalette.pushButton.pressed : canvasPalette.pushButton.released}
        stroke={canvasPalette.pushButton.capOutline}
        shadowColor={canvasPalette.pushButton.shadow}
        shadowOffsetY={closed ? 0 : 2}
        shadowBlur={closed ? 0 : 3}
        shadowOpacity={0.5}
      />
    </>
  );
}
