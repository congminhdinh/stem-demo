import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, Color, Material, Mesh, MeshLambertMaterial, MeshStandardMaterial, Texture, Vector3, type Object3D } from 'three';
import { bodyPalette } from '../../../core/world/arena/body-colors';
import { gripperKit, gripperTestScenario } from '../__fixtures__/gripper-scene';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { freeViewForward } from '../camera-studio';
import { idleSnapshot, wallBox, writePose } from '../scene-math';
import { assembleArena, fixedBodyProps, nounProp } from './arena-assembly';

// N19 E7: a pick-and-place lesson's objects are drawn as what they are to the learner (`objects[].noun`: a foam cube, a parcel, a base;
// arena-props.glb's N19 props), at their exact size (the collider's: arena-assembly.ts MODELLED), in their colour (body-colors.ts), a cube
// with its colour's marks on top (red stripes, green grid, blue dots); a wall tagged kho-wall is a warehouse shelf, solid where the wall is.

let assets: Record<'high' | 'low', RobotAssets>;
beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});
const scenario = gripperTestScenario;
const build = (detail: 'high' | 'low') => assembleArena(scenario, assets[detail].prop, { shadows: detail === 'high', low: detail === 'low', blob: new Texture(), viewForward: freeViewForward({ start: scenario.start, goals: [] }) });
const materialsOf = (node: Object3D) => {
  const out: Material[] = [];
  node.traverse((child) => child instanceof Mesh && out.push(child.material as Material));
  return out;
};

describe('the pick-and-place props (N19 E7)', () => {
  it('draws a cube, a parcel and a base as their own props, and an object with no noun as N18 did', () => {
    expect(scenario.arena.objects.map(nounProp)).toEqual(['prop_cube', 'prop_cube', 'prop_cube', 'prop_cube', 'prop_parcel', 'prop_base']);
    expect(nounProp({ shape: 'box', noun: undefined })).toBeNull();
    expect(nounProp({ shape: 'cylinder', noun: 'cube' })).toBeNull();
  });

  for (const detail of ['high', 'low'] as const) {
    it(`gives each object a prop whose bounding box is its collider’s within 0.5 cm, where the snapshot puts it (${detail})`, () => {
      const arena = build(detail);
      const world = idleSnapshot(scenario, gripperKit);
      for (const object of scenario.arena.objects) {
        const mover = arena.movers.get(object.id)!;
        writePose(mover.node, world.objects.find((item) => item.id === object.id)!.pose);
        mover.node.updateMatrixWorld(true);
        const box = new Box3();
        mover.node.traverse((node) => node instanceof Mesh && (node.material as Material).name !== 'blob' && node.geometry.type !== 'PlaneGeometry' && box.union(new Box3().setFromObject(node, true)));
        const [sx, sy, h] = object.shape === 'box' ? object.sizeCm : [0, 0, 0];
        const [cx, cy] = object.centerCm;
        expect(box.min.x).toBeCloseTo((cx - sx / 2) / 100, 2);
        expect(box.max.x).toBeCloseTo((cx + sx / 2) / 100, 2);
        expect(Math.abs(box.min.y)).toBeLessThan(0.005);
        expect(Math.abs(box.max.y - h / 100)).toBeLessThan(0.005);
        expect(box.min.z).toBeCloseTo(-(cy + sy / 2) / 100, 2);
        expect(box.max.z).toBeCloseTo(-(cy - sy / 2) / 100, 2);
      }
      arena.dispose();
    });
  }

  it('paints each cube its colour, with its colour’s marks on its top (red stripes, green grid, blue dots; yellow plain)', () => {
    const arena = build('high');
    const marks: Record<string, string | null> = {};
    for (const [id, name] of [
      ['cube-red', 'red'],
      ['cube-green', 'green'],
      ['cube-blue', 'blue'],
      ['cube-yellow', 'yellow'],
    ] as const) {
      const materials = materialsOf(arena.movers.get(id)!.node).filter((material) => material.name.startsWith('foam')) as MeshStandardMaterial[];
      expect(materials.map((material) => material.name).sort()).toEqual(['foam', 'foam_top']);
      for (const material of materials) expect(material.color.getHex()).toBe(new Color(bodyPalette[name]).getHex());
      marks[name] = materials.find((material) => material.name === 'foam_top')!.userData.marks as string | null;
    }
    expect(marks).toEqual({ red: 'red', green: 'green', blue: 'blue', yellow: null });
    // One material a colour, the cubes of a colour sharing it.
    const tops = new Set(['cube-red', 'cube-green', 'cube-blue', 'cube-yellow'].flatMap((id) => materialsOf(arena.movers.get(id)!.node).filter((m) => m.name === 'foam_top')));
    expect(tops.size).toBe(4);
    arena.dispose();
  });

  it('tints a base by its colour (blue here), beech without one, and leaves a parcel without one its own tape', () => {
    const arena = build('high');
    const base = materialsOf(arena.movers.get('base')!.node).find((m) => m.name === 'base_wood') as MeshStandardMaterial;
    expect(base.color.getHex()).toBe(new Color(bodyPalette.blue).getHex());
    const tape = materialsOf(arena.movers.get('parcel')!.node).find((m) => m.name === 'parcel_tape') as MeshStandardMaterial;
    expect(tape).toBe(assets.high.prop('prop_parcel')!.getObjectsByProperty('type', 'Mesh').map((mesh) => (mesh as Mesh).material).find((m) => (m as Material).name === 'parcel_tape'));
    const plain = assembleArena({ arena: { ...scenario.arena, objects: [{ ...scenario.arena.objects[5]!, color: undefined }] } }, assets.high.prop, { shadows: false, low: false, blob: new Texture(), viewForward: [1, 0] });
    expect((materialsOf(plain.movers.get('base')!.node).find((m) => m.name === 'base_wood') as MeshStandardMaterial).color.getHex()).toBe(new Color('#e2b98a').getHex());
    plain.dispose();
    arena.dispose();
  });

  it('stocks the kho-wall as a warehouse shelf: its rack the wall’s collider within 0.5 cm, its sign above it', () => {
    const index = scenario.arena.walls.findIndex((wall) => wall.tags.includes('kho-wall'));
    const body = fixedBodyProps(scenario.arena, assets.high.prop).find((item) => item.kind === 'wall' && item.index === index)!;
    body.prop.updateMatrixWorld(true);
    const rack = new Box3().setFromObject(body.prop.getObjectByName('kho_rack')!, true);
    const sign = new Box3().setFromObject(body.prop.getObjectByName('kho_sign')!, true);
    const { position, size } = wallBox(scenario.arena.walls[index]!);
    expect(rack.min.x).toBeCloseTo(position[0] - size[0] / 2, 2);
    expect(rack.max.x).toBeCloseTo(position[0] + size[0] / 2, 2);
    expect(Math.abs(rack.max.y - size[1])).toBeLessThan(0.005);
    expect(Math.abs(rack.min.y)).toBeLessThan(0.005);
    expect(rack.min.z).toBeCloseTo(position[2] - size[2] / 2, 2);
    expect(rack.max.z).toBeCloseTo(position[2] + size[2] / 2, 2);
    expect(sign.min.y).toBeGreaterThanOrEqual(size[1] - 1e-4);
    // The sign keeps its shape on any wall (fix round 1, review M5): scaled evenly, by the wall's height (the modelled 15 × 5 cm board).
    const long = { ...scenario.arena.walls[index]!, toCm: [140, 82] as [number, number], thicknessCm: 2 };
    const stretched = fixedBodyProps({ ...scenario.arena, walls: [long] }, assets.high.prop)[0]!.prop;
    stretched.updateMatrixWorld(true);
    const scale = stretched.getObjectByName('kho_sign')!.getWorldScale(new Vector3());
    expect(scale.x).toBeCloseTo(scale.y, 9);
    expect(scale.z).toBeCloseTo(scale.y, 9);
    expect(scale.y).toBeCloseTo(1, 9);
    // The other walls stay plywood.
    expect(fixedBodyProps(scenario.arena, assets.high.prop).filter((item) => item.kind === 'wall' && item.index !== index).every((item) => item.prop.name === 'prop_wall')).toBe(true);
  });

  it('draws the low tier’s props with Lambert materials and frees every material and texture it made', () => {
    const arena = build('low');
    const materials = new Set<Material>();
    for (const { node } of arena.movers.values()) for (const material of materialsOf(node)) materials.add(material);
    for (const material of materials) expect(['MeshLambertMaterial', 'MeshBasicMaterial']).toContain(material.type);
    expect([...materials].some((material) => material instanceof MeshLambertMaterial)).toBe(true);
    const spies = [...materials].map((material) => vi.spyOn(material, 'dispose'));
    arena.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
