import { Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette, mixHex } from './colors';

/**
 * An LED: dark, or lit. N17 B5: an LED fed by a PWM duty is lit at the brightness the snapshot carries (`brightness`, 0..1), its
 * colour and glow between dark and full; a lit LED without one is at full brightness, as before.
 */
export function LedRenderer({ definition, runtimeState }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const lit = runtimeState?.lit === true;
  const brightness = lit ? Math.min(1, Math.max(0, runtimeState?.brightness ?? 1)) : 0;
  const domeHeight = height * 0.7;
  return (
    <>
      {/* `lit` and `brightness` are set on the node so tests read what was rendered (plan §11.4). */}
      <Rect
        name="led-light"
        lit={lit}
        brightness={brightness}
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={domeHeight}
        cornerRadius={[width / 2, width / 2, 4, 4]}
        fill={brightness === 1 ? canvasPalette.led.lit : mixHex(canvasPalette.led.dark, canvasPalette.led.lit, brightness)}
        stroke={canvasPalette.led.outline}
        shadowColor={canvasPalette.led.glow}
        shadowBlur={28 * brightness}
        shadowOpacity={0.9 * brightness}
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
