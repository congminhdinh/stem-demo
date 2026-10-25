import { describe, expect, it } from 'vitest';
import { BufferGeometry, Material, Mesh, MeshBasicMaterial, Vector3, type Object3D } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { robotModel } from '../robot-model';
import { arenaToThree, idleSnapshot } from '../scene-math';
import { ultrasonicEndsCm } from '../sensor-overlay-math';
import { createSensorOverlay, type SensorOverlay } from './sensor-overlay';

// N18 R4.3: the 3D sensor overlay is built from the kit and the scenario and set from a snapshot: its rays end where the readout says
// (checked against the arithmetic of sensor-overlay-math.ts, for a robot that is turned and tipped), the nearest echo is a dot and a
// tag with the distance in cm in the learner's decimal sign, the line sensors' spots lie on the mat where the readout puts them, the
// next goal's zone is lit, and it all frees what it made. The tag's canvas needs a document: here there is none, so the label's text is
// read from the glyphs the overlay would paint.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
const stopAtWall = scenarioCatalog.get('rb-stop-at-wall')!;
const lineFollow = scenarioCatalog.get('rb-line-follow')!;
const idle = idleSnapshot(stopAtWall, kit);

const make = (scenario = stopAtWall, decimal = ',') => createSensorOverlay({ kit, model, scenario, decimal, fovDeg: 40, makeLabel: () => null });
const pose = (xCm: number, yCm: number, yawDeg: number): Pose => {
  const half = (yawDeg * Math.PI) / 360;
  return { xCm, yCm, zCm: 0, yawDeg, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
};
const ultrasonic = (cm: number, hitId: string | null): SensorReadout => ({ role: 'ultrasonic', kind: 'ultrasonic', cm, hitId });
const line = (role: string, dark: boolean, spotCm: readonly [number, number] | null): SensorReadout => ({ role, kind: 'line-sensor', reflectance: dark ? 0 : 1, dark, spotCm });
const world = (robot: Pose, sensors: SensorReadout[], changes: Partial<RobotSnapshot> = {}): RobotSnapshot => ({ ...idle, status: 'running', robot: { ...idle.robot, ...robot }, sensors, ...changes });

const named = (overlay: SensorOverlay, name: string): Object3D[] => {
  const found: Object3D[] = [];
  overlay.root.traverse((node) => {
    if (node.name === name) found.push(node);
  });
  return found;
};
/** The end of a rod along +X from 0 to 1 (the axis, a cone edge) in three's world, then in the arena's cm. */
const endOf = (rod: Object3D): Vector3 => rod.localToWorld(new Vector3(1, 0, 0));
const arenaCm = (v: Vector3) => [v.x * 100, -v.z * 100, v.y * 100];
const close = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
const sensorOrder = kit.modules.filter((module) => module.kind === 'ultrasonic' || module.kind === 'line-sensor');
const lineRoles = sensorOrder.filter((module) => module.kind === 'line-sensor').map((module) => module.role);

describe('the ultrasonic beam', () => {
  it('ends where the reading says: robot at (50, 40) facing +y, 23.4 cm heard, the dot at the axis end', () => {
    const overlay = make();
    overlay.update(world(pose(50, 40, 90), [ultrasonic(23.4, 'front-wall')]), true, 0.5);
    overlay.root.updateMatrixWorld(true);
    const [axis] = named(overlay, 'sensor-axis');
    const [hit] = named(overlay, 'sensor-hit');
    close(arenaCm(endOf(axis!)), [50, 70.9, 4]);
    close(arenaCm(hit!.getWorldPosition(new Vector3())), [50, 70.9, 4]);
    close(arenaCm(axis!.getWorldPosition(new Vector3())), [50, 47.5, 4]);
    expect(hit!.visible).toBe(true);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ role: 'ultrasonic', visible: true, echo: true, ray: true, hit: true, cm: 23.4, label: '23,4 cm' });
  });

  it('ends the cone’s four edges where the arithmetic puts them, for a robot that is turned and tipped', () => {
    const overlay = make();
    // Yaw 30°, nose pitched down 6° and rolled 4°: a full rotation, as the physics gives a robot on a bump.
    const q = { x: 0.0348, y: 0.0523, z: 0.2587, w: 0.9640 };
    const norm = Math.hypot(q.x, q.y, q.z, q.w);
    const rotation = { x: q.x / norm, y: q.y / norm, z: q.z / norm, w: q.w / norm };
    const tipped: Pose = { xCm: 80, yCm: 55, zCm: 0.4, yawDeg: 30, rotation };
    overlay.update(world(tipped, [ultrasonic(61.7, 'front-wall')]), true, 0.5);
    overlay.root.updateMatrixWorld(true);
    const mount = kit.modules.find((module) => module.role === 'ultrasonic')!.mount;
    const half = (kit.modules.find((module) => module.role === 'ultrasonic')!.spec as { coneHalfDeg: number }).coneHalfDeg;
    const expected = ultrasonicEndsCm(tipped, mount, half, 61.7);
    const [axis] = named(overlay, 'sensor-axis');
    const edges = named(overlay, 'sensor-cone-edge');
    expect(edges).toHaveLength(4);
    close(arenaCm(endOf(axis!)), expected.ends[0]!);
    edges.forEach((edge, i) => close(arenaCm(endOf(edge)), expected.ends[i + 1]!));
  });

  it('draws a ray that heard nothing to 400 cm, quietly, with no dot, and writes "400 cm"', () => {
    const overlay = make();
    overlay.update(world(pose(50, 40, 0), [ultrasonic(400, null)]), true, 0.5);
    overlay.root.updateMatrixWorld(true);
    const [axis] = named(overlay, 'sensor-axis');
    close(arenaCm(endOf(axis!)), [57.5 + 400, 40, 4]);
    expect(named(overlay, 'sensor-hit')[0]!.visible).toBe(false);
    expect(((axis as Mesh).material as MeshBasicMaterial).opacity).toBeLessThan(0.5);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: true, echo: false, ray: true, hit: false, label: '400 cm' });
  });

  it('highlights an echo: its ray is stronger than the one without', () => {
    const overlay = make();
    overlay.update(world(pose(50, 40, 0), [ultrasonic(100, 'front-wall')]), true, 0.5);
    const [axis] = named(overlay, 'sensor-axis');
    const strong = ((axis as Mesh).material as MeshBasicMaterial).opacity;
    overlay.update(world(pose(50, 40, 0), [ultrasonic(400, null)]), true, 0.5);
    expect(strong).toBeGreaterThan(((axis as Mesh).material as MeshBasicMaterial).opacity);
  });

  it('writes the distance with the learner’s decimal sign, to a tenth', () => {
    const vi = make(stopAtWall, ',');
    const en = make(stopAtWall, '.');
    for (const overlay of [vi, en]) overlay.update(world(pose(50, 40, 0), [ultrasonic(106.449, 'front-wall')]), true, 0.5);
    expect(vi.probe().ultrasonics[0]!.label).toBe('106,4 cm');
    expect(en.probe().ultrasonics[0]!.label).toBe('106.4 cm');
    vi.update(world(pose(50, 40, 0), [ultrasonic(7, 'front-wall')]), true, 0.5);
    expect(vi.probe().ultrasonics[0]!.label).toBe('7,0 cm');
  });

  it('shows no beam before there is a reading (the start view, before a run)', () => {
    const overlay = make();
    overlay.update(idle, true, 0.5);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: false, label: null });
    expect(named(overlay, 'sensor-beam-ultrasonic')[0]!.visible).toBe(false);
  });
});

describe('the line sensors’ spots', () => {
  const spots = (overlay: SensorOverlay) => lineRoles.map((role) => named(overlay, `sensor-spot-${role}`)[0] as Mesh);

  it('lies on the mat where the readout puts each, as big as the kit’s spot, a disc in the ring where it reads dark', () => {
    const overlay = make(lineFollow);
    const readouts = [ultrasonic(80, 'wall'), line('lineLeft', false, [31.5, 20.25]), line('lineCenter', true, [32, 22.5]), line('lineRight', false, [31.5, 24.75])];
    expect(lineRoles).toEqual(['lineLeft', 'lineCenter', 'lineRight']);
    overlay.update(world(pose(25, 22.5, 0), [...readouts].sort((a, b) => sensorOrder.findIndex((m) => m.role === a.role) - sensorOrder.findIndex((m) => m.role === b.role))), true, 0.5);
    const found = spots(overlay);
    close(found[0]!.position.toArray(), [0.315, 0.005, -0.2025]);
    close(found[1]!.position.toArray(), [0.32, 0.005, -0.225]);
    close(found[2]!.position.toArray(), [0.315, 0.005, -0.2475]);
    const radiusCm = (kit.modules.find((module) => module.role === 'lineLeft')!.spec as { spotRadiusCm: number }).spotRadiusCm;
    expect(found[0]!.scale.x).toBeCloseTo(Math.max(0.7, radiusCm) / 100, 9);
    expect(overlay.probe().spots.map((spot) => [spot.visible, spot.dark])).toEqual([
      [true, false],
      [true, true],
      [true, false],
    ]);
    // Only the dark one has a disc.
    const discs = lineRoles.map((role) => named(overlay, `sensor-spot-disc-${role}`)[0]!.visible);
    expect(discs).toEqual([false, true, false]);
    // And it is a different ring: red where dark, slate where bright.
    expect(found[1]!.material).not.toBe(found[0]!.material);
    expect(found[0]!.material).toBe(found[2]!.material);
  });

  it('hides the spot of a sensor that is lifted off the floor, and all before a run', () => {
    const overlay = make(lineFollow);
    const lifted = [ultrasonic(80, null), line('lineLeft', false, null), line('lineCenter', false, [32, 22.5]), line('lineRight', false, null)];
    overlay.update(world(pose(25, 22.5, 0), lifted), true, 0.5);
    expect(overlay.probe().spots.map((spot) => spot.visible)).toEqual([false, true, false]);
    overlay.update(idleSnapshot(lineFollow, kit), true, 0.5);
    expect(overlay.probe().spots.map((spot) => spot.visible)).toEqual([false, false, false]);
  });

  it('draws over the robot, which hides the mat under its body (no depth test)', () => {
    const overlay = make(lineFollow);
    for (const role of lineRoles) {
      expect(((named(overlay, `sensor-spot-${role}`)[0] as Mesh).material as Material).depthTest).toBe(false);
    }
  });
});

describe('the zone of the next goal', () => {
  const visibleZones = (overlay: SensorOverlay) => named(overlay, 'sensor-goal-stop-zone').filter((node) => node.visible).length;

  it('is lit before a run, so a learner sees where to go, and goes out when the goal has passed', () => {
    const overlay = make();
    overlay.update(idle, true, 0.5);
    expect(visibleZones(overlay)).toBe(1);
    expect(overlay.probe().zone).toBe('stop-zone');
    const passed = world(pose(135, 50, 0), [ultrasonic(14, 'front-wall')], { score: { points: 70, maxScore: 100, goals: [{ id: 'stop-near-wall', passed: true, points: 70, progress: 1 }] } });
    overlay.update(passed, true, 0.5);
    expect(visibleZones(overlay)).toBe(0);
    expect(overlay.probe().zone).toBeNull();
  });

  it('lights one zone at a time in a route, the next checkpoint in order', () => {
    const route = scenarioCatalog.get('rb-square-route')!;
    const overlay = createSensorOverlay({ kit, model, scenario: route, decimal: ',', fovDeg: 40, makeLabel: () => null });
    const shown = () => ['cp-1', 'cp-2', 'cp-3', 'cp-4'].filter((id) => named(overlay, `sensor-goal-${id}`)[0]?.visible);
    overlay.update(idleSnapshot(route, kit), true, 0.5);
    expect(shown()).toEqual(['cp-1']);
    const counted = (half: boolean, full: number) => [
      { id: 'half-square', passed: half, points: 0, progress: half ? 1 : 0 },
      { id: 'full-square', passed: false, points: 0, progress: full },
    ];
    overlay.update({ ...idleSnapshot(route, kit), score: { points: 0, maxScore: 100, goals: counted(true, 0.5) } }, true, 0.5);
    expect(shown()).toEqual(['cp-3']);
  });

  it('pulses: the glow follows the level given, between a soft rest and a stronger swing', () => {
    const overlay = make();
    overlay.update(idle, true, 0);
    const [group] = named(overlay, 'sensor-goal-stop-zone');
    const [fill, band] = (group as Object3D).children as Mesh[];
    const [dim, dimBand] = [(fill!.material as MeshBasicMaterial).opacity, (band!.material as MeshBasicMaterial).opacity];
    overlay.update(idle, true, 1);
    expect((fill!.material as MeshBasicMaterial).opacity).toBeGreaterThan(dim);
    expect((band!.material as MeshBasicMaterial).opacity).toBeGreaterThan(dimBand);
    expect(dim).toBeGreaterThan(0.1);
  });
});

describe('the toggle', () => {
  it('hides everything when the overlays are off, and shows it again with the last reading', () => {
    const overlay = make();
    overlay.update(world(pose(50, 40, 0), [ultrasonic(60, 'front-wall')]), false, 0.5);
    expect(overlay.root.visible).toBe(false);
    expect(overlay.probe().shown).toBe(false);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: false, ray: false, hit: false });
    overlay.update(world(pose(50, 40, 0), [ultrasonic(60, 'front-wall')]), true, 0.5);
    expect(overlay.root.visible).toBe(true);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: true, ray: true, label: '60,0 cm' });
  });
});

describe('what it costs', () => {
  it('draws with the contact shadows’ program: every mesh a transparent MeshBasicMaterial with an alpha map', () => {
    const overlay = make(lineFollow);
    const meshes: Mesh[] = [];
    overlay.root.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    expect(meshes.length).toBeGreaterThan(10);
    for (const mesh of meshes) {
      const material = mesh.material as MeshBasicMaterial;
      expect(material.isMeshBasicMaterial).toBe(true);
      expect(material.transparent).toBe(true);
      expect(material.alphaMap).not.toBeNull();
      expect(material.depthWrite).toBe(false);
    }
  });

  it('is compiled with the scene though it is hidden until a reading comes', () => {
    const overlay = make();
    const nodes: Object3D[] = [];
    overlay.root.traverse((node) => nodes.push(node));
    expect(nodes.length).toBeGreaterThan(10);
    expect(nodes.every((node) => node.userData.compileWithScene === true)).toBe(true);
  });

  it('frees every geometry and material it made, once', () => {
    const overlay = make(lineFollow);
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    overlay.root.traverse((node) => {
      if (node instanceof Mesh) {
        geometries.add(node.geometry as BufferGeometry);
        materials.add(node.material as Material);
      }
    });
    const freed: unknown[] = [];
    for (const item of [...geometries, ...materials]) item.addEventListener('dispose', () => freed.push(item));
    overlay.dispose();
    expect(freed).toHaveLength(geometries.size + materials.size);
    expect(new Set(freed).size).toBe(freed.length);
  });

  it('makes the geometry and the materials once: updating from a hundred snapshots adds no object', () => {
    const overlay = make(lineFollow);
    const count = () => {
      let n = 0;
      overlay.root.traverse(() => n++);
      return n;
    };
    const before = count();
    const arenaStart = arenaToThree(25, 22.5, 0);
    expect(arenaStart[0]).toBe(0.25);
    for (let i = 0; i < 100; i++) {
      overlay.update(world(pose(25 + i, 22.5, i), [ultrasonic(80 - i / 3, i % 7 === 0 ? null : 'wall'), line('lineLeft', i % 2 === 0, [30 + i, 20]), line('lineCenter', true, [30 + i, 22]), line('lineRight', false, null)]), true, (i % 10) / 10);
    }
    expect(count()).toBe(before);
  });
});
