import { Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

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
        fill={lit ? canvasPalette.led.lit : canvasPalette.led.dark}
        stroke={canvasPalette.led.outline}
        shadowColor={canvasPalette.led.glow}
        shadowBlur={lit ? 28 : 0}
        shadowOpacity={lit ? 0.9 : 0}
      />
      <Rect
        x={-width / 2 - 3}
        y={-height / 2 + domeHeight}
        width={width + 6}
        height={6}
        cornerRadius={2}
        fill={canvasPalette.led.base}
      />
    </>
  );
}
