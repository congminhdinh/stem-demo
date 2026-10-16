import { Rect, Text } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

const fontSize = 13;

export function GenericRenderer({ definition }: DeviceRendererProps) {
  const { width, height } = definition.body;
  return (
    <>
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        cornerRadius={6}
        fill={canvasPalette.generic.body}
        stroke={canvasPalette.generic.outline}
      />
      <Text
        text={definition.name}
        x={-width / 2}
        y={-fontSize / 2}
        width={width}
        align="center"
        fontSize={fontSize}
        fill={canvasPalette.generic.label}
      />
    </>
  );
}
