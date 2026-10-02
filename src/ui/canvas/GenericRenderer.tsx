import { Rect, Text } from 'react-konva';
import type { DeviceRendererProps } from './renderers';

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
        fill="#e4e7eb"
        stroke="#9aa5b1"
      />
      <Text
        text={definition.name}
        x={-width / 2}
        y={-fontSize / 2}
        width={width}
        align="center"
        fontSize={fontSize}
        fill="#334e68"
      />
    </>
  );
}
