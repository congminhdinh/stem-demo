import { describe, expect, it } from 'vitest';
import { unoR3Board } from '../../../core/hardware/catalog';
import type { RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { contrastRatio } from '../../a11y/contrast';
import { gripperKit, gripperTestScenario } from '../__fixtures__/gripper-scene';
import { robot3dColors } from '../colors';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { COLOR_RAY_QUIET_ALPHA, sensorColors } from '../sensor-colors';
import { rgba } from './overlay-geometry';
import { createSensorOverlay } from './sensor-overlay';

// N19 E8 (E4/E5 re-review): the 3D colour sensor's ray with nothing in range (its 4 cm, no spot) was the dark slate of its hit at 30 %, which
// is 1.02:1 over the black tape the line-following lessons drive on (and 1.9:1 on the mat): the learner lost it there. It is a mid slate
// now, which reads at 3:1 on the tape, the mat and every zone of the lessons (WCAG 1.4.11's 3:1 for graphics), as opaque as it is painted.

const toRgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const hex = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
/** `ink` at `alpha` over `ground` (sRGB, as the overlay's blending is judged in the gallery's shots). */
const over = (ink: string, alpha: number, ground: string) => hex(toRgb(ink).map((c, i) => c * alpha + toRgb(ground)[i]! * (1 - alpha)));

const grounds = [...new Set(['#f2f2f2', '#ffffff', robot3dColors.tape, ...scenarioCatalog.scenarios.flatMap((scenario) => scenario.arena.paint.zones.map((zone) => zone.color.toLowerCase()))])];

describe('the 3D colour ray with nothing in range (N19 E8)', () => {
  it('reads at 3:1 on the tape, the mat and every lesson’s zone', () => {
    expect(grounds).toContain(robot3dColors.tape);
    for (const ground of grounds) expect(contrastRatio(over(sensorColors.colorRayQuiet, COLOR_RAY_QUIET_ALPHA, ground), ground), ground).toBeGreaterThanOrEqual(3);
  });

  it('is what the overlay paints the ray with while it meets nothing, and the hit’s dark slate while it meets something', () => {
    const overlay = createSensorOverlay({ kit: gripperKit, model: robotModel(gripperKit, unoR3Board), scenario: gripperTestScenario, decimal: ',', unit: 'cm', noEchoText: '', fovDeg: 40, detail: 'high', makeLabel: () => null, makeWordsLabel: () => null });
    const idle = idleSnapshot(gripperTestScenario, gripperKit);
    const sensors = (hitId: string | null): SensorReadout[] => [
      { role: 'ultrasonic', kind: 'ultrasonic', cm: 30, hitId: 'wall' },
      { role: 'lineLeft', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
      { role: 'lineCenter', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
      { role: 'lineRight', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
      { role: 'irClaw', kind: 'ir-obstacle', detected: false, hitId: null },
      { role: 'color1', kind: 'color-sensor', hitId, distanceCm: hitId === null ? null : 1.4 },
    ];
    const world = (hitId: string | null): RobotSnapshot => ({ ...idle, status: 'running', robot: { ...idle.robot, gripper: { clawDeg: 0, liftDeg: 0, heldId: null } }, sensors: sensors(hitId) });
    const paint = () => {
      const colors = overlay.gripperRays!.geometry.getAttribute('color');
      const at = overlay.gripperRays!.colorRay!.start;
      return [colors.getX(at), colors.getY(at), colors.getZ(at), colors.getW(at)];
    };
    overlay.update(world(null), true, 0.5, 0);
    paint().forEach((value, i) => expect(value).toBeCloseTo(rgba(sensorColors.colorRayQuiet, COLOR_RAY_QUIET_ALPHA)[i]!, 6));
    overlay.update(world('cube-red'), true, 0.5, 0);
    paint().forEach((value, i) => expect(value).toBeCloseTo(rgba(sensorColors.spotRing, 0.75)[i]!, 6));
  });
});
