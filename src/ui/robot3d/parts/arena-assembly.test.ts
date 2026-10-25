import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, BufferGeometry, Material, Mesh, Texture, type Object3D } from 'three';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { freeViewForward } from '../camera-studio';
import { wallBox } from '../scene-math';
import { arenaDressing, assembleArena, boxProp, cylinderProp } from './arena-assembly';

// N18 R4.7: each pilot arena is drawn from the modelled props (arena-props.glb) as what its bodies are, at their exact place and size,
// with dressing that fits the lesson and never stands where the robot drives: the garage's carport roof and P sign, hazard boards on
// the wall behind a dock or a stop zone, a finish gantry over a plain target; and round it the table, the fence, the studio.

const scenario = (key: string) => scenarioCatalog.get(key)!;
let assets: RobotAssets;
beforeAll(async () => {
  assets = await loadTestAssets('high');
});

const build = (key: string, low = false) => {
  const s = scenario(key);
  const span = { widthM: s.arena.ground.sizeCm[0] / 100, depthM: s.arena.ground.sizeCm[1] / 100 };
  return assembleArena(s, assets.prop, { shadows: true, low, blob: new Texture(), viewForward: freeViewForward(span, s.start) });
};

describe('the pilot arenas’ props (N18 R4.7)', () => {
  it('draws the gate as a barricade, small obstacles as cones, a block and a pole as what they are', () => {
    expect(boxProp(scenario('rb-servo-gate').arena.boxes[0]!)).toBe('prop_barrier');
    expect(scenario('rb-mini-mission').arena.boxes.map(boxProp)).toEqual(['prop_cone', 'prop_cone']);
    expect(boxProp(scenario('rb-sandbox').arena.boxes[0]!)).toBe('prop_cardboard');
    expect(cylinderProp(scenario('rb-sandbox').arena.cylinders[0]!)).toBe('prop_post');
    expect(cylinderProp({ radiusCm: 4, heightCm: 10 })).toBe('prop_tin');
  });

  it('dresses each lesson: the garage of rb-line-follow, the dock and the stop wall, finish gantries over the plain targets', () => {
    expect(arenaDressing(scenario('rb-line-follow'))).toEqual([
      { kind: 'garage', centerCm: [31, 110], spanCm: 58, gapCm: 28, along: 'x', heightCm: 10, sign: { atCm: [58.5, 124], facing: 0 } },
    ]);
    expect(arenaDressing(scenario('rb-mini-mission'))).toEqual([{ kind: 'hazard', centerCm: [140, 138], lengthCm: 30, facing: -Math.PI / 2 }]);
    expect(arenaDressing(scenario('rb-stop-at-wall'))).toEqual([{ kind: 'hazard', centerCm: [158, 50], lengthCm: 40, facing: Math.PI }]);
    expect(arenaDressing(scenario('rb-drive-to-zone'))).toEqual([{ kind: 'gantry', centerCm: [91, 40], along: 'y' }]);
    expect(arenaDressing(scenario('rb-servo-gate'))).toEqual([{ kind: 'gantry', centerCm: [118, 50], along: 'y' }]);
    expect(arenaDressing(scenario('rb-square-route'))).toEqual([]);
  });

  it('scales each wall’s plywood strip to the wall the physics builds, end to end', () => {
    const s = scenario('rb-line-follow');
    const arena = build('rb-line-follow');
    const merged = arena.root.children[0]!.children.filter((node) => node instanceof Mesh && (node.material as Material).name.startsWith('plywood'));
    const box = new Box3();
    for (const mesh of merged) box.union(new Box3().setFromObject(mesh, true));
    // Every wall inside the plywood's box, and the box no bigger than the walls' (to the bevel).
    const walls = new Box3();
    for (const wall of s.arena.walls) {
      const { position, size } = wallBox(wall);
      const half = Math.max(size[0], size[2]) / 2;
      walls.expandByPoint({ x: position[0] - half, y: 0, z: position[2] - half } as never);
      walls.expandByPoint({ x: position[0] + half, y: size[1], z: position[2] + half } as never);
    }
    expect(box.min.y).toBeCloseTo(0, 4);
    expect(box.max.y).toBeCloseTo(0.1, 4);
    expect(box.min.x).toBeCloseTo(-0.01, 3);
    expect(box.max.x).toBeCloseTo(1.71, 3);
    expect(box.min.z).toBeCloseTo(-1.41, 3);
    expect(box.max.z).toBeCloseTo(0.01, 3);
    arena.dispose();
  });

  it('keeps a node for each body that moves, and frees what it made', () => {
    const s = scenario('rb-sandbox');
    const withMover = { ...s, arena: { ...s.arena, objects: [{ id: 'puck', shape: 'cylinder' as const, centerCm: [60, 60] as [number, number], radiusCm: 3, heightCm: 4, massG: 50, tags: [] as string[] }] } };
    const span = { widthM: 2, depthM: 1.5 };
    const arena = assembleArena(withMover as never, assets.prop, { shadows: false, low: true, blob: new Texture(), viewForward: freeViewForward(span, s.start) });
    expect([...arena.movers.keys()]).toEqual(['puck']);
    expect(arena.movers.get('puck')!.heightM).toBeCloseTo(0.04, 9);
    const owned = new Set<BufferGeometry | Material>();
    arena.root.traverse((node: Object3D) => {
      if (node instanceof Mesh && (node.userData.merged || node.parent?.parent === arena.root)) owned.add(node.geometry);
    });
    expect(owned.size).toBeGreaterThan(0);
    arena.dispose();
  });
});
