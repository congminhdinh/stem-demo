import type { Scenario } from '../../core/scenario/scenario';
import type { SightProp } from './camera-studio';
import { arenaDressing } from './parts/arena-assembly';
import { arenaToThree, boxBody, cylinderBody } from './scene-math';

// The props the chase camera keeps out of (N18 R4.7 fix round 2, review N3; camera-studio.ts `keepOutOfProps`), from the scenario: the
// bodies the physics builds and the dressing that hangs over the mat (arena-assembly.ts).

/**
 * What the chase camera keeps out of (camera-studio.ts `keepOutOfProps`): the arena's fixed boxes and cylinders, a finish gantry's beam
 * with its banner (25–35 cm up across the arena) and a carport roof on its garage's walls.
 */
export function sightProps(scenario: Pick<Scenario, 'arena'>): SightProp[] {
  const { arena } = scenario;
  const props: SightProp[] = [];
  for (const box of arena.boxes) {
    if (box.body !== 'fixed') continue;
    const { position, size, yawRad } = boxBody(box);
    props.push({ centre: [position[0], position[2]], half: [size[0] / 2, size[2] / 2], yawRad, bottom: 0, top: size[1] });
  }
  for (const cylinder of arena.cylinders) {
    if (cylinder.body !== 'fixed') continue;
    const { position, radiusM, heightM } = cylinderBody(cylinder);
    props.push({ centre: [position[0], position[2]], half: [radiusM, radiusM], yawRad: 0, bottom: 0, top: heightM });
  }
  const [widthCm, depthCm] = arena.ground.sizeCm;
  for (const item of arenaDressing(scenario)) {
    const [x, , z] = arenaToThree(item.centerCm[0], item.centerCm[1], 0);
    if (item.kind === 'gantry') {
      const across = (item.along === 'y' ? depthCm : widthCm) / 200 + 0.12;
      props.push({ centre: [x, z], half: item.along === 'y' ? [0.02, across] : [across, 0.02], yawRad: 0, bottom: 0.25, top: 0.35 });
    } else if (item.kind === 'garage') {
      const [span, gap] = [item.spanCm / 200 + 0.02, item.gapCm / 200 + 0.02];
      props.push({ centre: [x, z], half: item.along === 'x' ? [span, gap] : [gap, span], yawRad: 0, bottom: item.heightCm / 100, top: item.heightCm / 100 + 0.03 });
    }
  }
  return props;
}

