import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { SLIDER_MAX_PERCENT, SLIDER_MIN_PERCENT } from '../../core/simulation/simulate-circuit';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

/** The knob turns through this many degrees from its start (0 %) to its end (100 %). */
const travel = 270;
const knobRadius = 22;

/**
 * A rotary potentiometer seen from above. The position of the knob is the number the snapshot carries for this
 * component (`value`, a percentage): the renderer draws it, and owns no state of its own (plan §11.4, B2).
 */
export function PotentiometerRenderer({ definition, runtimeState }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const percent = Math.min(SLIDER_MAX_PERCENT, Math.max(SLIDER_MIN_PERCENT, runtimeState?.value ?? 0));
  const angle = -travel / 2 + (percent / SLIDER_MAX_PERCENT) * travel;
  return (
    <>
      <Rect x={-width / 2} y={-height / 2} width={width} height={height} cornerRadius={6} fill={canvasPalette.potentiometer.body} stroke={canvasPalette.potentiometer.outline} />
      <Group y={-10}>
        <Circle radius={knobRadius} fill={canvasPalette.potentiometer.knob} stroke={canvasPalette.potentiometer.knobOutline} strokeWidth={2} />
        {/* `value` is set on the node so tests read what was rendered (plan §11.4). */}
        <Line name="knob" value={percent} points={[0, 0, 0, -(knobRadius - 4)]} rotation={angle} stroke={canvasPalette.potentiometer.pointer} strokeWidth={4} lineCap="round" />
      </Group>
      <Text
        text={`${percent} %`}
        x={-width / 2}
        y={height / 2 - 28}
        width={width}
        align="center"
        fontSize={11}
        fill={canvasPalette.potentiometer.label}
        listening={false}
      />
    </>
  );
}
