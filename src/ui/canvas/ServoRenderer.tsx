import { useEffect, useRef, useState } from 'react';
import { Arc, Circle, Group, Line, Rect, Text } from 'react-konva';
import { SERVO_REST_ANGLE } from '../../core/simulation/simulate-circuit';
import { prefersReducedMotion } from '../runtime-controls/use-shaking';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

// N17 B5: a 180° servo seen from above, its arm (the horn) on the output shaft. The angle the arm turns to is the one the run
// snapshot carries for this component (`angle`, set by the simulation from the program's `servo_write`); the arm gets there at
// about 60° per 0.1 s, as a hobby servo does, with the angle it shows written under it. Someone who asked for less motion sees it
// jump there. With no run (idle, after Stop) the arm stands at 90° at once: Stop ends the motion, and the next run starts there
// (Review Focus 1). 0° points right, 90° up, 180° left.

/** How fast the arm turns on the canvas: 60° per 100 ms. Presentation only: the program's call returns at once (C-27, EVD-16). */
export const SERVO_DEGREES_PER_MS = 0.6;

const hornLength = 26;
const hubY = -10;
const { body, outline, tab, hub, horn, track, label } = canvasPalette.servo;

/**
 * The angle the arm is drawn at: it moves towards `target` at SERVO_DEGREES_PER_MS, from wherever it is, a new target taking over
 * mid-turn. `immediate` (no run) and less motion put it there at once.
 */
function useSweep(target: number, immediate: boolean): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (current.current === target) {
      return;
    }
    if (immediate || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      current.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const reach = Math.max(0, now - last) * SERVO_DEGREES_PER_MS;
      last = now;
      const room = target - current.current;
      const next = Math.abs(room) <= reach ? target : current.current + Math.sign(room) * reach;
      current.current = next;
      setShown(next);
      if (next !== target) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, immediate]);
  return shown;
}

export function ServoRenderer({ definition, runtimeState }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const commanded = Math.min(180, Math.max(0, runtimeState?.angle ?? SERVO_REST_ANGLE));
  const shown = useSweep(commanded, runtimeState === undefined);
  return (
    <>
      {/* The mounting tabs, then the case. */}
      <Rect x={-width / 2 + 2} y={hubY - 4} width={width - 4} height={10} cornerRadius={3} fill={tab} stroke={outline} listening={false} />
      <Rect x={-28} y={-height / 2 + 6} width={56} height={48} cornerRadius={5} fill={body} stroke={outline} strokeWidth={1.5} />
      <Group y={hubY} listening={false}>
        {/* The arm's travel, 0° to 180°, over the top. */}
        <Arc innerRadius={hornLength + 3} outerRadius={hornLength + 5} angle={180} rotation={180} fill={track} />
        {/* `angle` (as drawn) and `target` are set on the node so tests read what was rendered (plan §11.4). */}
        <Line
          name="servo-horn"
          angle={shown}
          target={commanded}
          points={[0, 0, hornLength, 0]}
          rotation={-shown}
          stroke={horn}
          strokeWidth={7}
          lineCap="round"
          shadowColor={outline}
          shadowBlur={2}
          shadowOpacity={0.4}
        />
        <Circle radius={7} fill={hub} stroke={outline} strokeWidth={1} />
      </Group>
      <Text
        name="servo-angle"
        text={`${Math.round(shown)}°`}
        x={-width / 2}
        y={height / 2 - 26}
        width={width}
        align="center"
        fontSize={12}
        fontStyle="bold"
        fill={label}
        listening={false}
      />
    </>
  );
}
