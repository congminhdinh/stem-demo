import { Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';

export function LedRenderer({ definition, runtimeState }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const lit = runtimeState?.lit === true;
  const domeHeight = height * 0.7;
  return (
    <>
      {/* `lit` is set on the node so tests read what was rendered (plan §11.4). */}
      <Rect
        name="led-light"
        lit={lit}
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={domeHeight}
        cornerRadius={[width / 2, width / 2, 4, 4]}
        fill={lit ? '#ff3b30' : '#7f1d1d'}
        stroke="#5c1010"
        shadowColor="#ff3b30"
        shadowBlur={lit ? 28 : 0}
        shadowOpacity={lit ? 0.9 : 0}
      />
      <Rect
        x={-width / 2 - 3}
        y={-height / 2 + domeHeight}
        width={width + 6}
        height={6}
        cornerRadius={2}
        fill="#9aa5b1"
      />
    </>
  );
}
