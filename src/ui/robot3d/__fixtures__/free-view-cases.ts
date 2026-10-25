import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { robotTemplateKeys } from '../../../samples/robot-keys';
import type { ArenaSpan } from '../camera';
import { freeViewSceneOf, MIN_ROBOT_PX, VIEW_SAFE_RECT, type FreeViewScene, type SafeRect } from '../camera-studio';

// N18 P2: the free view's inputs the golden poses (free-view-golden.json) were taken with: every scenario's arena, the HUD at five
// heights (none, and its bottom edge at 0.5, 0.35, 0.2, 0.05 NDC), with and without the view tools' corner, in the 1100 px frame's view
// (660 × 497) and a wider one (760 × 560). free-view-golden.json was written by the free view as R4.7 left it (master 16407b8).

export type FreeViewCase = { key: string; span: ArenaSpan; scene: FreeViewScene; fov: number; aspect: number; rect: SafeRect; minRobot: number };

export function cases(): FreeViewCase[] {
  const out: FreeViewCase[] = [];
  for (const template of robotTemplateKeys) {
    const scenario = scenarioCatalog.get(template)!;
    const scene = freeViewSceneOf(scenario);
    const span = { widthM: scenario.arena.ground.sizeCm[0] / 100, depthM: scenario.arena.ground.sizeCm[1] / 100 };
    for (const [width, height] of [
      [660, 497],
      [760, 560],
    ] as const) {
      for (const hudBottom of [null, 0.5, 0.35, 0.2, 0.05]) {
        for (const tools of [null, { right: -0.7, top: -0.6 }]) {
          const rect: SafeRect = { ...VIEW_SAFE_RECT, ...(hudBottom === null ? {} : { hud: { right: -0.08, bottom: hudBottom } }), ...(tools ? { tools } : {}) };
          out.push({ key: `${template} ${width}x${height} hud ${hudBottom} tools ${tools ? 'yes' : 'no'}`, span, scene, fov: 40, aspect: width / height, rect, minRobot: (2 * MIN_ROBOT_PX) / width });
        }
      }
    }
  }
  return out;
}
