import { beforeAll, describe, expect, it } from 'vitest';
import { Color, Mesh, MeshStandardMaterial, Texture, type Material, type Object3D } from 'three';
import type { Scenario } from '../../../core/scenario/scenario';
import { variantObjectColors } from '../../../core/scenario/variants';
import { parseArena } from '../../../core/world/arena/arena-schema';
import { bodyPalette } from '../../../core/world/arena/body-colors';
import { gripperTestScenario } from '../__fixtures__/gripper-scene';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { assembleArena } from './arena-assembly';

// N19 E4/E5 (ruling 8 on the E4/E5 report): the 3D view paints each object in the colour of the round it shows. The props are built once:
// an object whose variants recolour it has its prop in each colour it takes, under its one mover, and `paint` shows the round's and hides
// the others (no rebuild, no frame of its own unless it changed something). The sort lesson's cube: green, red, blue; round 2 is the red
// prop, red's stripes on its top. An object no variant recolours gets nothing more, as every rover lesson's.

let assets: Record<'high' | 'low', RobotAssets>;
beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});

const scenario: Scenario = {
  ...gripperTestScenario,
  arena: parseArena({
    ...gripperTestScenario.arena,
    objects: [
      { shape: 'box', id: 'cube', centerCm: [60, 30], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.green },
      { shape: 'box', id: 'still', centerCm: [80, 30], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: bodyPalette.yellow },
    ],
  }),
  variants: { ...gripperTestScenario.variants, count: 3, objectColors: { cube: [bodyPalette.green, bodyPalette.red, bodyPalette.blue] } },
};
const build = (detail: 'high' | 'low') => assembleArena(scenario, assets[detail].prop, { shadows: detail === 'high', low: detail === 'low', blob: new Texture(), viewForward: [1, 0] });

/** The visible foam of a mover: its colour (hex) and its top's marks (high tier). */
function shownFoam(node: Object3D): { colors: number[]; marks: unknown[] } {
  const colors: number[] = [];
  const marks: unknown[] = [];
  node.traverseVisible((child) => {
    if (!(child instanceof Mesh)) return;
    const material = child.material as Material;
    if (material instanceof MeshStandardMaterial && material.name.startsWith('foam')) {
      colors.push(material.color.getHex());
      if (material.name === 'foam_top') marks.push(material.userData.marks);
    }
  });
  return { colors, marks };
}

describe('the 3D props paint the round shown (N19 E4/E5, ruling 8)', () => {
  it('round 2 of objectColors {cube: [green, red, blue]}: the red prop, red’s stripes on top; round 3 blue; the arena’s green with none', () => {
    const arena = build('high');
    const cube = arena.movers.get('cube')!;
    // One prop for each colour it takes, under the one mover; green (its own, round 1's) shown first.
    expect([...cube.looks!.keys()]).toEqual([bodyPalette.green, bodyPalette.red, bodyPalette.blue]);
    expect(shownFoam(cube.node)).toEqual({ colors: [new Color(bodyPalette.green).getHex(), new Color(bodyPalette.green).getHex()], marks: ['green'] });
    expect(arena.paint(variantObjectColors(scenario, 1))).toBe(true);
    const red = new Color(bodyPalette.red).getHex();
    expect(shownFoam(cube.node)).toEqual({ colors: [red, red], marks: ['red'] });
    // The same round again changes nothing: no frame is due.
    expect(arena.paint(variantObjectColors(scenario, 1))).toBe(false);
    expect(arena.paint(variantObjectColors(scenario, 2))).toBe(true);
    expect(shownFoam(cube.node).marks).toEqual(['blue']);
    // No round shown (nothing run): the arena's own.
    expect(arena.paint(null)).toBe(true);
    expect(shownFoam(cube.node).marks).toEqual(['green']);
    // The cube no variant recolours has one prop, no looks.
    expect(arena.movers.get('still')!.looks).toBeUndefined();
    arena.dispose();
  });

  it('works on the low tier too: the colours baked into each prop, one shown', () => {
    const arena = build('low');
    const cube = arena.movers.get('cube')!;
    arena.paint(variantObjectColors(scenario, 1));
    const visible = [...cube.looks!.entries()].filter(([, look]) => look.visible).map(([colour]) => colour);
    expect(visible).toEqual([bodyPalette.red]);
    arena.dispose();
  });

  it('adds nothing for a scenario whose variants recolour nothing: the gripper fixture and every N18 lesson (no looks; paint shows nothing new)', () => {
    const arena = assembleArena(gripperTestScenario, assets.high.prop, { shadows: true, low: false, blob: new Texture(), viewForward: [1, 0] });
    expect([...arena.movers.values()].every((mover) => mover.looks === undefined)).toBe(true);
    expect(arena.paint({ 'cube-red': bodyPalette.blue })).toBe(false);
    arena.dispose();
  });
});
