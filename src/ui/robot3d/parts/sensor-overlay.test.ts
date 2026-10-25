import { describe, expect, it } from 'vitest';
import { Color, Group, Material, Mesh, MeshBasicMaterial, Sprite, Vector3, type BufferGeometry, type Object3D } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { ultrasonicEndsCm } from '../__fixtures__/ray-oracle';
import { robotModel } from '../robot-model';
import { idleSnapshot, writePose } from '../scene-math';
import { highlightColor } from '../sensor-overlay-math';
import type { DistanceLabel } from './distance-label';
import type { Range } from './overlay-geometry';
import { createSensorOverlay, LABEL_PERIOD_S, type SensorOverlay } from './sensor-overlay';

// N18 R4.3: the 3D sensor overlay is built from the kit and the scenario and set from a snapshot: its beam ends where the readout says
// (read from the vertices it draws, held against the oracle of __fixtures__/ray-oracle.ts for a robot that is turned and tipped), the dot
// and a tag with the distance in cm in the learner's decimal sign, or "không thấy vật" with no echo (a ray of 40 cm, faded), the line
// sensors' spots lie on the mat where the readout puts them, the next goal's zone is lit in its own hue, the tag is painted at most about ten
// times a second and settled when the loop stops, and the whole thing is four draw calls of one shader program that it frees. The tag's
// canvas needs a document: here there is none, so a stand-in records what would be painted.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
const stopAtWall = scenarioCatalog.get('rb-stop-at-wall')!;
const lineFollow = scenarioCatalog.get('rb-line-follow')!;
const idle = idleSnapshot(stopAtWall, kit);

/** A tag that records what it is told to paint. */
function recordingLabel() {
  const painted: string[] = [];
  const label: DistanceLabel = {
    sprite: Object.assign(new Sprite(), { name: 'sensor-label' }),
    widthShare: 0.5,
    show: (glyphs, count) => void painted.push(Array.from(glyphs.subarray(0, count)).join(',')),
    showNoEcho: () => void painted.push('no-echo'),
    dispose: () => void 0,
  };
  return { label, painted };
}

type MakeOptions = { scenario?: typeof stopAtWall; decimal?: string; detail?: 'high' | 'low'; unit?: string; label?: DistanceLabel | null };
const make = ({ scenario = stopAtWall, decimal = ',', detail = 'high', unit = 'cm', label = null }: MakeOptions = {}): SensorOverlay =>
  createSensorOverlay({ kit, model, scenario, decimal, unit, noEchoText: 'không thấy vật', fovDeg: 40, detail, makeLabel: () => label });
const pose = (xCm: number, yCm: number, yawDeg: number): Pose => {
  const half = (yawDeg * Math.PI) / 360;
  return { xCm, yCm, zCm: 0, yawDeg, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
};
const ultrasonic = (cm: number, hitId: string | null): SensorReadout => ({ role: 'ultrasonic', kind: 'ultrasonic', cm, hitId });
const line = (role: string, dark: boolean, spotCm: readonly [number, number] | null): SensorReadout => ({ role, kind: 'line-sensor', reflectance: dark ? 0 : 1, dark, spotCm });
const world = (robot: Pose, sensors: SensorReadout[], changes: Partial<RobotSnapshot> = {}): RobotSnapshot => ({ ...idle, status: 'running', robot: { ...idle.robot, ...robot }, sensors, ...changes });
const update = (overlay: SensorOverlay, snapshot: RobotSnapshot, timeS = 0, shown = true, pulse = 0.5) => overlay.update(snapshot, shown, pulse, timeS);

const named = (overlay: SensorOverlay, name: string): Object3D[] => {
  const found: Object3D[] = [];
  overlay.root.traverse((node) => {
    if (node.name === name) found.push(node);
  });
  return found;
};
const arenaCm = (v: Vector3) => [v.x * 100, -v.z * 100, v.y * 100];
const close = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
/** Positions are float32 (seven digits): in cm, to 0.5 µm at 100 cm. */
const closeCm = (actual: readonly number[], expected: readonly number[]) => close(actual, expected, 4);

/** The centroid, in the arena's cm, of a run of vertices of the mesh `name` (the beam or the spots). */
function centroidCm(overlay: SensorOverlay, name: string, range: Range): number[] {
  const [mesh] = named(overlay, name) as Mesh[];
  overlay.root.updateMatrixWorld(true);
  const position = mesh!.geometry.getAttribute('position');
  const sum = new Vector3();
  for (let v = range.start; v < range.start + range.count; v++) sum.add(mesh!.localToWorld(new Vector3().fromBufferAttribute(position, v)));
  return arenaCm(sum.divideScalar(range.count));
}
const sensorOrder = kit.modules.filter((module) => module.kind === 'ultrasonic' || module.kind === 'line-sensor');
const lineRoles = sensorOrder.filter((module) => module.kind === 'line-sensor').map((module) => module.role);
const lineReadings = (dark: [boolean, boolean, boolean], spots: ([number, number] | null)[]) => [
  ultrasonic(80, 'wall'),
  ...lineRoles.map((role, i) => line(role, dark[i]!, spots[i] ?? null)),
];

describe('the ultrasonic beam', () => {
  it('ends where the reading says: robot at (50, 40) facing +y, 23.4 cm heard, the dot at the axis end', () => {
    const overlay = make();
    update(overlay, world(pose(50, 40, 90), [ultrasonic(23.4, 'front-wall')]));
    const [beam] = overlay.beams;
    closeCm(centroidCm(overlay, 'sensor-beam', { start: beam!.axis.start + 6, count: 6 }), [50, 70.9, 4]);
    closeCm(centroidCm(overlay, 'sensor-beam', { start: beam!.axis.start, count: 6 }), [50, 47.5, 4]);
    closeCm(centroidCm(overlay, 'sensor-beam', beam!.hit), [50, 70.9, 4]);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ role: 'ultrasonic', visible: true, echo: true, ray: true, hit: true, cm: 23.4, label: '23,4 cm' });
  });

  it('ends the cone’s four edges where the oracle puts them, for a robot that is turned and tipped', () => {
    const overlay = make();
    // Yaw 30°, nose pitched down 6° and rolled 4°: a full rotation, as the physics gives a robot on a bump.
    const q = { x: 0.0348, y: 0.0523, z: 0.2587, w: 0.964 };
    const norm = Math.hypot(q.x, q.y, q.z, q.w);
    const tipped: Pose = { xCm: 80, yCm: 55, zCm: 0.4, yawDeg: 30, rotation: { x: q.x / norm, y: q.y / norm, z: q.z / norm, w: q.w / norm } };
    update(overlay, world(tipped, [ultrasonic(61.7, 'front-wall')]));
    const mount = kit.modules.find((module) => module.role === 'ultrasonic')!.mount;
    const half = (kit.modules.find((module) => module.role === 'ultrasonic')!.spec as { coneHalfDeg: number }).coneHalfDeg;
    const expected = ultrasonicEndsCm(tipped, mount, half, 61.7);
    const [beam] = overlay.beams;
    closeCm(centroidCm(overlay, 'sensor-beam', { start: beam!.axis.start + 6, count: 6 }), expected.ends[0]!);
    for (let k = 0; k < 4; k++) closeCm(centroidCm(overlay, 'sensor-beam', { start: beam!.edges.start + 10 * k + 5, count: 5 }), expected.ends[k + 1]!);
    closeCm(centroidCm(overlay, 'sensor-beam', beam!.hit), expected.ends[0]!);
  });

  it('draws a ray that heard nothing as a faded one 40 cm long, with no dot, and says "không thấy vật"', () => {
    const overlay = make();
    update(overlay, world(pose(50, 40, 0), [ultrasonic(400, null)]));
    const [beam] = overlay.beams;
    closeCm(centroidCm(overlay, 'sensor-beam', { start: beam!.axis.start + 6, count: 6 }), [57.5 + 40, 40, 4]);
    // The dot is folded into one point at the ray's end: drawn as nothing.
    const position = beam!.geometry.getAttribute('position');
    for (let v = beam!.hit.start; v < beam!.hit.start + beam!.hit.count; v++) expect(position.getX(v)).toBeCloseTo(0.4, 6);
    expect(beam!.geometry.getAttribute('color').getW(beam!.axis.start)).toBeLessThan(0.5);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: true, echo: false, ray: true, hit: false, label: 'không thấy vật' });
  });

  it('draws the ray of an echo stronger than the one without, and back again', () => {
    const overlay = make();
    const alpha = () => overlay.beams[0]!.geometry.getAttribute('color').getW(overlay.beams[0]!.axis.start);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(100, 'front-wall')]));
    const strong = alpha();
    update(overlay, world(pose(50, 40, 0), [ultrasonic(400, null)]));
    expect(alpha()).toBeLessThan(strong);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(90, 'front-wall')]));
    expect(alpha()).toBe(strong);
  });

  it('leaves the cone’s surface out on the light tier, and keeps the edges, the axis ray and the dot', () => {
    const [high, low] = [make({ detail: 'high' }), make({ detail: 'low' })];
    expect(high.beams[0]!.cone).not.toBeNull();
    expect(low.beams[0]!.cone).toBeNull();
    expect(low.beams[0]!.geometry.getAttribute('position').count).toBeLessThan(high.beams[0]!.geometry.getAttribute('position').count);
    update(low, world(pose(50, 40, 0), [ultrasonic(60, 'front-wall')]));
    expect(low.probe().ultrasonics[0]).toMatchObject({ ray: true, hit: true });
  });

  it('writes the distance with the learner’s decimal sign and the messages’ unit, to a tenth', () => {
    const vi = make({ decimal: ',' });
    const en = make({ decimal: '.', unit: 'centimetres' });
    for (const overlay of [vi, en]) update(overlay, world(pose(50, 40, 0), [ultrasonic(106.449, 'front-wall')]));
    expect(vi.probe().ultrasonics[0]!.label).toBe('106,4 cm');
    expect(en.probe().ultrasonics[0]!.label).toBe('106.4 centimetres');
    update(vi, world(pose(50, 40, 0), [ultrasonic(7, 'front-wall')]), 1);
    expect(vi.probe().ultrasonics[0]!.label).toBe('7,0 cm');
  });

  it('shows no beam before there is a reading (the start view, before a run)', () => {
    const overlay = make();
    update(overlay, idle);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: false, label: null });
    expect(named(overlay, 'sensor-beam-ultrasonic')[0]!.visible).toBe(false);
  });
});

describe('the distance tag’s pace', () => {
  const run = (label: DistanceLabel) => make({ label });

  it('is painted at once the first time, then at most every 0.1 s while the reading changes, and says so in the probe', () => {
    const { label, painted } = recordingLabel();
    const overlay = run(label);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(80.0, 'wall')]), 0);
    expect(painted).toEqual(['8,0,10,0']);
    // Four frames at 60 Hz, the reading falling 0.2 cm each: held back, the probe still says what is painted.
    for (let i = 1; i <= 4; i++) update(overlay, world(pose(50, 40, 0), [ultrasonic(80 - 0.2 * i, 'wall')]), i / 60);
    expect(painted).toHaveLength(1);
    expect(overlay.probe().ultrasonics[0]!.label).toBe('80,0 cm');
    // The first frame at or past 0.1 s paints the reading it has.
    update(overlay, world(pose(50, 40, 0), [ultrasonic(79.0, 'wall')]), LABEL_PERIOD_S + 1e-9);
    expect(painted).toHaveLength(2);
    expect(overlay.probe().ultrasonics[0]!.label).toBe('79,0 cm');
  });

  it('paints a tag held back when the loop settles (flushLabels), once, to the latest reading', () => {
    const { label, painted } = recordingLabel();
    const overlay = run(label);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(40, 'wall')]), 0);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(39.8, 'wall')]), 0.02);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(39.5, 'wall')]), 0.04);
    expect(painted).toHaveLength(1);
    expect(overlay.flushLabels()).toBe(true);
    expect(painted).toHaveLength(2);
    expect(overlay.probe().ultrasonics[0]!.label).toBe('39,5 cm');
    // Nothing is behind now: the next time the loop stops it paints nothing and asks for nothing.
    expect(overlay.flushLabels()).toBe(false);
    expect(painted).toHaveLength(2);
  });

  it('paints at once when the echo comes or goes, and shows nothing stale when a reading comes back to what is painted', () => {
    const { label, painted } = recordingLabel();
    const overlay = run(label);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(40, 'wall')]), 0);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(400, null)]), 0.01);
    expect(painted).toEqual(['4,0,10,0', 'no-echo']);
    expect(overlay.probe().ultrasonics[0]!.label).toBe('không thấy vật');
    update(overlay, world(pose(50, 40, 0), [ultrasonic(41, 'wall')]), 0.02);
    expect(painted).toHaveLength(3);
    // A reading 0.03 s later that moves and returns to the tenth painted is not behind.
    update(overlay, world(pose(50, 40, 0), [ultrasonic(40.5, 'wall')]), 0.03);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(41, 'wall')]), 0.04);
    expect(overlay.flushLabels()).toBe(false);
  });

  it('settles nothing while the overlays are off', () => {
    const { label } = recordingLabel();
    const overlay = run(label);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(40, 'wall')]), 0);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(39, 'wall')]), 0.02);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(39, 'wall')]), 0.04, false);
    expect(overlay.flushLabels()).toBe(false);
  });

  it('puts the tag at the end of the ray, and its place for a ray of 40 cm when there is no echo', () => {
    const { label } = recordingLabel();
    const overlay = run(label);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(23.4, 'wall')]), 0);
    expect(overlay.labelReach(0)).toBeCloseTo(0.234, 9);
    update(overlay, world(pose(50, 40, 0), [ultrasonic(400, null)]), 0.2);
    expect(overlay.labelReach(0)).toBeCloseTo(0.4, 9);
    expect(overlay.labelShown(0)).toBe(true);
  });
});

describe('the line sensors’ spots', () => {
  const eyeRanges = (overlay: SensorOverlay) => {
    // The spots' mesh is built after the beams'; its geometry is what the eyes' vertices are in.
    const [mesh] = named(overlay, 'sensor-spots') as Mesh[];
    return mesh!.geometry;
  };

  it('lie on the mat where the readout puts each, flat at 5 mm, a halo three times the core, the tick up to the eye', () => {
    const overlay = make({ scenario: lineFollow });
    update(overlay, world(pose(25, 22.5, 0), lineReadings([false, true, false], [[31.5, 20.25], [32, 22.5], [31.5, 24.75]])));
    const geometry = eyeRanges(overlay);
    const position = geometry.getAttribute('position');
    const spotCm = [[31.5, 20.25], [32, 22.5], [31.5, 24.75]] as const;
    const per = position.count / 3;
    for (let i = 0; i < 3; i++) {
      // The halo's centre vertex is the first of each eye's vertices.
      close([position.getX(per * i), position.getY(per * i), position.getZ(per * i)], [spotCm[i]![0] / 100, 0.005, -spotCm[i]![1] / 100]);
    }
    // Its radius is the kit's 0.3 cm spot, at least 0.7 cm: the halo reaches 2.1 cm.
    expect(Math.hypot(position.getX(per * 1 + 1) - 0.32, position.getZ(per * 1 + 1) + 0.225)).toBeCloseTo(0.021, 6);
    // The tick reaches up to the eye, 1 cm over the mat (the kit's mount).
    let top = 0;
    for (let v = 0; v < position.count; v++) top = Math.max(top, position.getY(v));
    expect(top).toBeCloseTo(0.01, 6);
    expect(overlay.probe().spots.map((spot) => [spot.visible, spot.dark])).toEqual([
      [true, false],
      [true, true],
      [true, false],
    ]);
  });

  it('is a red disc where an eye reads dark and a blue ring where it reads bright, in a soft halo of the same colour', () => {
    const overlay = make({ scenario: lineFollow });
    update(overlay, world(pose(25, 22.5, 0), lineReadings([false, true, false], [[31.5, 20.25], [32, 22.5], [31.5, 24.75]])));
    const colors = eyeRanges(overlay).getAttribute('color');
    const per = colors.count / 3;
    const red = new Color('#ef4444');
    const blue = new Color('#2563eb');
    // An eye's vertices run halo (21), ring (40), disc (21), tick (8).
    const [halo, ring, disc] = [0, 21, 61];
    const at = (eye: number, offset: number) => [colors.getX(per * eye + offset), colors.getY(per * eye + offset), colors.getZ(per * eye + offset), colors.getW(per * eye + offset)];
    close(at(1, disc), [red.r, red.g, red.b, 0.95]);
    expect(at(1, ring)[3]).toBe(0);
    close(at(0, ring), [blue.r, blue.g, blue.b, 0.95]);
    expect(at(0, disc)[3]).toBe(0);
    expect(at(0, halo)[3]).toBeCloseTo(0.32, 6);
    close(at(1, halo).slice(0, 3), [red.r, red.g, red.b]);
  });

  it('hides the spot of a sensor that is lifted off the floor, and all before a run, and draws the mesh only when an eye is on the mat', () => {
    const overlay = make({ scenario: lineFollow });
    const [mesh] = named(overlay, 'sensor-spots') as Mesh[];
    update(overlay, world(pose(25, 22.5, 0), lineReadings([false, false, false], [null, [32, 22.5], null])));
    expect(overlay.probe().spots.map((spot) => spot.visible)).toEqual([false, true, false]);
    expect(mesh!.visible).toBe(true);
    update(overlay, idleSnapshot(lineFollow, kit));
    expect(overlay.probe().spots.map((spot) => spot.visible)).toEqual([false, false, false]);
    expect(mesh!.visible).toBe(false);
  });

  it('is tested against the robot’s depth like everything else, so the chassis covers what is under it', () => {
    const overlay = make({ scenario: lineFollow });
    const [mesh] = named(overlay, 'sensor-spots') as Mesh[];
    expect((mesh!.material as Material).depthTest).toBe(true);
    expect((mesh!.material as Material).depthWrite).toBe(false);
  });
});

describe('the zone of the next goal', () => {
  const lit = (overlay: SensorOverlay, id: string) => (named(overlay, `sensor-goal-${id}`)[0] as Mesh | undefined)?.visible === true;

  it('is lit before a run, so a learner sees where to go, and goes out when the goal has passed', () => {
    const overlay = make();
    update(overlay, idle);
    expect(lit(overlay, 'stop-zone')).toBe(true);
    expect(overlay.probe().zone).toBe('stop-zone');
    const passed = world(pose(135, 50, 0), [ultrasonic(14, 'front-wall')], { score: { points: 70, maxScore: 100, goals: [{ id: 'stop-near-wall', passed: true, points: 70, progress: 1 }] } });
    update(overlay, passed);
    expect(lit(overlay, 'stop-zone')).toBe(false);
    expect(overlay.probe().zone).toBeNull();
  });

  it('lights one zone at a time in a route, the next checkpoint in order', () => {
    const route = scenarioCatalog.get('rb-square-route')!;
    const overlay = make({ scenario: route });
    const shown = () => ['cp-1', 'cp-2', 'cp-3', 'cp-4'].filter((id) => lit(overlay, id));
    update(overlay, idleSnapshot(route, kit));
    expect(shown()).toEqual(['cp-1']);
    const counted = (half: boolean, full: number) => [
      { id: 'half-square', passed: half, points: 0, progress: half ? 1 : 0 },
      { id: 'full-square', passed: false, points: 0, progress: full },
    ];
    update(overlay, { ...idleSnapshot(route, kit), score: { points: 0, maxScore: 100, goals: counted(true, 0.5) } });
    expect(shown()).toEqual(['cp-3']);
  });

  it('is drawn in a strong shade of the zone’s own hue, the fill soft and the outline firm, not in a colour of its own', () => {
    const overlay = make();
    const [mesh] = named(overlay, 'sensor-goal-stop-zone') as Mesh[];
    const colors = mesh!.geometry.getAttribute('color');
    const expected = new Color(highlightColor('#d9ead3'));
    close([colors.getX(0), colors.getY(0), colors.getZ(0)], [expected.r, expected.g, expected.b]);
    // The first vertices are the fill's, the last the band's.
    expect(colors.getW(0)).toBeCloseTo(0.24, 6);
    expect(colors.getW(colors.count - 1)).toBeCloseTo(0.8, 6);
    // Green: the hue of the zone it lies on.
    expect(colors.getY(0)).toBeGreaterThan(colors.getX(0) * 1.4);
  });

  it('pulses: the glow follows the level given, between a soft rest and a stronger swing', () => {
    const overlay = make();
    update(overlay, idle, 0, true, 0);
    const [mesh] = named(overlay, 'sensor-goal-stop-zone') as Mesh[];
    const dim = (mesh!.material as MeshBasicMaterial).opacity;
    update(overlay, idle, 0, true, 1);
    expect((mesh!.material as MeshBasicMaterial).opacity).toBeGreaterThan(dim);
    expect(dim).toBeGreaterThan(0.5);
    expect((mesh!.material as MeshBasicMaterial).opacity).toBeLessThan(1.2);
  });
});

describe('the toggle', () => {
  it('hides everything when the overlays are off, and shows it again with the last reading', () => {
    const overlay = make();
    update(overlay, world(pose(50, 40, 0), [ultrasonic(60, 'front-wall')]), 0, false);
    expect(overlay.root.visible).toBe(false);
    expect(overlay.probe().shown).toBe(false);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: false, ray: false, hit: false });
    update(overlay, world(pose(50, 40, 0), [ultrasonic(60, 'front-wall')]), 1);
    expect(overlay.root.visible).toBe(true);
    expect(overlay.probe().ultrasonics[0]).toMatchObject({ visible: true, ray: true, label: '60,0 cm' });
  });
});

describe('the pose it follows', () => {
  it('is the very matrix a writePose group has, for a robot that is turned and tipped', () => {
    const overlay = make();
    const poses: Pose[] = [
      pose(50, 40, 0),
      pose(12.5, 99.25, 133),
      { xCm: 80, yCm: 55, zCm: 0.4, yawDeg: 30, rotation: (() => { const q = { x: 0.0348, y: 0.0523, z: 0.2587, w: 0.964 }; const n = Math.hypot(q.x, q.y, q.z, q.w); return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n }; })() },
    ];
    const reference = new Group();
    for (const robot of poses) {
      update(overlay, world(robot, [ultrasonic(30, 'wall')]));
      overlay.root.updateMatrixWorld(true);
      writePose(reference, robot);
      reference.updateMatrixWorld(true);
      const [robotGroup] = named(overlay, 'sensor-overlay-robot');
      robotGroup!.matrixWorld.elements.forEach((value, i) => expect(value).toBeCloseTo(reference.matrixWorld.elements[i]!, 9));
    }
  });
});

describe('what it costs', () => {
  const drawn = (overlay: SensorOverlay) => {
    const nodes: Object3D[] = [];
    overlay.root.traverseVisible((node) => {
      if (node instanceof Mesh || node instanceof Sprite) nodes.push(node);
    });
    return nodes;
  };

  it('is four draw calls with a beam, the spots, the zone and the tag all showing, one mesh each', () => {
    const { label } = recordingLabel();
    const overlay = make({ scenario: lineFollow, label });
    update(overlay, world(pose(25, 22.5, 0), lineReadings([false, true, false], [[31.5, 20.25], [32, 22.5], [31.5, 24.75]])));
    // The beam's mesh, the spots' mesh, the garage's mesh and the tag's sprite: nothing else is drawn.
    expect(drawn(overlay).map((node) => node.name).sort()).toEqual(['sensor-beam', 'sensor-goal-garage', 'sensor-label', 'sensor-spots']);
  });

  it('shares one shader program: every mesh a transparent MeshBasicMaterial with vertex colours that is tested against depth and writes none', () => {
    const overlay = make({ scenario: lineFollow });
    const meshes: Mesh[] = [];
    overlay.root.traverse((node) => {
      if (node instanceof Mesh) meshes.push(node);
    });
    // The beam, the spots and the one zone line-follow names.
    expect(meshes).toHaveLength(3);
    for (const mesh of meshes) {
      const material = mesh.material as MeshBasicMaterial;
      expect(material.isMeshBasicMaterial).toBe(true);
      expect(material.vertexColors).toBe(true);
      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(mesh.geometry.getAttribute('color').itemSize).toBe(4);
    }
    // Two materials, one of them for the zone's own opacity.
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(2);
  });

  it('is compiled with the scene though it is hidden until a reading comes', () => {
    const overlay = make();
    const nodes: Object3D[] = [];
    overlay.root.traverse((node) => nodes.push(node));
    expect(nodes.length).toBeGreaterThan(5);
    expect(nodes.every((node) => node.userData.compileWithScene === true)).toBe(true);
  });

  it('frees every geometry and material it made, once', () => {
    const overlay = make({ scenario: lineFollow });
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

  it('makes its geometry and its materials once: updating from a hundred snapshots adds no object', () => {
    const overlay = make({ scenario: lineFollow });
    const count = () => {
      let n = 0;
      overlay.root.traverse(() => n++);
      return n;
    };
    const before = count();
    for (let i = 0; i < 100; i++) {
      update(overlay, world(pose(25 + i, 22.5, i), [ultrasonic(80 - i / 3, i % 7 === 0 ? null : 'wall'), line('lineLeft', i % 2 === 0, [30 + i, 20]), line('lineCenter', true, [30 + i, 22]), line('lineRight', false, null)]), i / 60, true, (i % 10) / 10);
    }
    expect(count()).toBe(before);
  });
});
