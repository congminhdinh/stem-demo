import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Group, Texture } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Scenario } from '../../../core/scenario/scenario';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import type { RobotAssets } from '../assets/robot-assets';
import { robot3dColors as colors } from '../colors';
import type { Detail } from '../lighting/look';
import { robotModel, type RobotModel } from '../robot-model';
import { writePose } from '../scene-math';
import { applyRobotWorld, assembleRobot, referenceSizes, type AssemblyOptions } from './robot-assembly';

// The robot in the 3D view from the modelled parts (N18 R4.7): assembled once for the kit (robot-assembly.ts), disposed on unmount;
// its pose and what its parts show are read from the world in the frame callback, never through a React render.

const reference = (() => {
  const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' });
  return kit ? referenceSizes(robotModel(kit, unoR3Board)) : null;
})();

/** The servo a scenario's goal asks to raise, and the angle it asks for: the flag's mast and how high its pennant flies. */
export function flagOf(scenario: Pick<Scenario, 'goals'>): AssemblyOptions['flag'] {
  for (const goal of scenario.goals) if (goal.kind === 'servo-angle') return { role: goal.role, upDeg: goal.minDeg };
  return null;
}

type GltfRobotProps = {
  assets: RobotAssets;
  kit: Kit;
  model: RobotModel;
  scenario: Scenario;
  view: () => RobotSnapshot;
  detail: Detail;
  shadows: boolean;
  blob: Texture;
};

export function GltfRobot({ assets, kit, model, scenario, view, detail, shadows, blob }: GltfRobotProps) {
  const flag = useMemo(() => flagOf(scenario), [scenario]);
  const robot = useMemo(() => {
    if (!reference) throw new Error('The reference kit is missing.');
    const boardLedPin = kit.board === unoR3Board.id ? unoR3Board.pins.findIndex((pin) => pin.id === 'D13') : -1;
    return assembleRobot(model, reference, assets.part, { detail, shadows, flag, boardLedPin, blob });
  }, [assets, kit, model, detail, shadows, flag, blob]);
  useEffect(() => () => robot.dispose(), [robot]);
  const group = useRef<Group>(null);
  useFrame(() => {
    const world = view();
    if (group.current) writePose(group.current, world.robot);
    applyRobotWorld(robot.handles, world, colors.ledOn, colors.ledOff);
  });
  return (
    <group ref={group} name="robot">
      <primitive object={robot.root} />
    </group>
  );
}
