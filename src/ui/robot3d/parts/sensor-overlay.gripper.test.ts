import { describe, expect, it } from 'vitest';
import { Mesh, MeshBasicMaterial, Sprite, Vector3, type Object3D } from 'three';
import { COLOR_NAMES, type ColorName } from '../../../core/hardware/drivers';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import { bodyPalette } from '../../../core/world/arena/body-colors';
import type { Pose, RobotSnapshot, SensorReadout } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { gripperKit, gripperTestScenario } from '../__fixtures__/gripper-scene';
import { robotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { sensorColors } from '../sensor-colors';
import { rgba, type Range } from './overlay-geometry';
import { createSensorOverlay, GRIPPER_LABEL_LIFT_M, type GripperWords, type SensorOverlay } from './sensor-overlay';
import type { WordsLabel } from './words-label';

// N19 E5: the 3D overlays of the gripper car's own sensors, from the snapshot (never worked out again): the IR beam between the jaws, 2 cm
// from its mount on the carriage, faint, and strong with a dot at its end when the IR sees something; the colour sensor's ray from its
// mount to what it meets (its range, faint, with no hit) and a spot there tinted with the colour its counts read (`shownColor`: a ring
// alone for one it cannot tell, none before its first window); both ride the carriage where robot.gripper puts it. A tag over the jaws says
// them ("IR: có vật", "Màu: đỏ"), painted only when its words change. It costs one mesh and one tag more, of the overlay's one program; a
// rover's overlay is as it was.

const scenario = gripperTestScenario;
const idle = idleSnapshot(scenario, gripperKit);
const DEG = Math.PI / 180;

const words: GripperWords = {
  irSeen: 'IR: có vật',
  irClear: 'IR: không có vật',
  color: Object.fromEntries(COLOR_NAMES.map((name) => [name, `Màu: ${({ red: 'đỏ', green: 'xanh lá', blue: 'xanh dương', yellow: 'vàng', white: 'trắng', black: 'đen', unknown: 'không rõ' } as const)[name]}`])) as Record<ColorName, string>,
  noReading: 'Màu: chưa có số đọc',
};

/** A tag that records what it is told to paint. */
function recordingWords() {
  const painted: string[] = [];
  const label: WordsLabel = {
    sprite: Object.assign(new Sprite(), { name: 'gripper-sensor-label' }),
    widthShare: 0,
    heightShare: 0,
    show(first, second) {
      label.widthShare = 0.4;
      label.heightShare = 0.8;
      painted.push([first, second].filter((line) => line !== null).join(' | '));
    },
    dispose: () => void 0,
  };
  return { label, painted };
}

const make = (label: WordsLabel | null = null, kit: Kit = gripperKit, on = scenario): SensorOverlay =>
  createSensorOverlay({ kit, model: robotModel(kit, unoR3Board), scenario: on, decimal: ',', unit: 'cm', noEchoText: 'không thấy vật', fovDeg: 40, detail: 'high', makeLabel: () => null, gripperWords: words, makeWordsLabel: () => label });
const pose = (xCm: number, yCm: number, yawDeg: number): Pose => {
  const half = (yawDeg * Math.PI) / 360;
  return { xCm, yCm, zCm: 0, yawDeg, rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } };
};
const red = { r: 14_000, g: 3000, b: 2800, c: 19_800 };
const unclear = { r: 100, g: 100, b: 50, c: 250 };
/** The readouts in kit order (ultrasonic, three line sensors, IR, colour). */
const readouts = (ir: { detected: boolean; hitId: string | null }, color: { hitId: string | null; distanceCm: number | null; rgbc?: typeof red }): SensorReadout[] => [
  { role: 'ultrasonic', kind: 'ultrasonic', cm: 30, hitId: 'wall' },
  { role: 'lineLeft', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
  { role: 'lineCenter', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
  { role: 'lineRight', kind: 'line-sensor', reflectance: 1, dark: false, spotCm: null },
  { role: 'irClaw', kind: 'ir-obstacle', ...ir },
  { role: 'color1', kind: 'color-sensor', ...color },
];
/** The car at (50, 40) facing +y, its arm lowered (lift 0) and open, with these readouts. */
const world = (sensors: SensorReadout[], liftDeg = 0, changes: Partial<RobotSnapshot> = {}): RobotSnapshot => ({
  ...idle,
  status: 'running',
  robot: { ...idle.robot, ...pose(50, 40, 90), gripper: { clawDeg: 0, liftDeg, heldId: null } },
  sensors,
  ...changes,
});
const named = (overlay: SensorOverlay, name: string): Object3D[] => {
  const found: Object3D[] = [];
  overlay.root.traverse((node) => {
    if (node.name === name) found.push(node);
  });
  return found;
};
/** The centroid, in the arena's cm, of a run of vertices of the gripper's rays. */
function centroidCm(overlay: SensorOverlay, range: Range): number[] {
  const [mesh] = named(overlay, 'sensor-gripper-rays') as Mesh[];
  overlay.root.updateMatrixWorld(true);
  const position = mesh!.geometry.getAttribute('position');
  const sum = new Vector3();
  for (let v = range.start; v < range.start + range.count; v++) sum.add(mesh!.localToWorld(new Vector3().fromBufferAttribute(position, v)));
  const mean = sum.divideScalar(range.count);
  return [mean.x * 100, -mean.z * 100, mean.y * 100];
}
const half = (range: Range, second: boolean): Range => ({ start: range.start + (second ? range.count / 2 : 0), count: range.count / 2 });
const closeCm = (actual: readonly number[], expected: readonly number[]) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 4));
/** The alpha (and the colour) of a run of the rays' vertices, all the same. */
function paintOf(overlay: SensorOverlay, range: Range): number[] {
  const colors = overlay.gripperRays!.geometry.getAttribute('color');
  const first = [colors.getX(range.start), colors.getY(range.start), colors.getZ(range.start), colors.getW(range.start)];
  for (let v = range.start; v < range.start + range.count; v++) expect([colors.getX(v), colors.getY(v), colors.getZ(v), colors.getW(v)]).toEqual(first);
  return first;
}

// Lowered (lift 0): the boom 40° down, the carriage 5·cos 40° ahead of the pivot (4.5, 0, 4.9) and 5·sin 40° below it; the sensors on it
// at u 0.3, v ±0.6 (the IR left, the colour sensor right). The car faces +y: forward is +y, left is −x.
const tipX = 4.5 + 5 * Math.cos(40 * DEG);
const tipZ = 4.9 - 5 * Math.sin(40 * DEG);

describe('the gripper car’s IR beam (N19 E5)', () => {
  it('runs 2 cm forward from its mount on the carriage, level, wherever the arm holds it', () => {
    const overlay = make();
    overlay.update(world(readouts({ detected: false, hitId: null }, { hitId: null, distanceCm: null })), true, 0.5, 0);
    const rays = overlay.gripperRays!;
    closeCm(centroidCm(overlay, half(rays.irTube!, false)), [50 - 0.6, 40 + tipX + 0.3, tipZ]);
    closeCm(centroidCm(overlay, half(rays.irTube!, true)), [50 - 0.6, 40 + tipX + 0.3 + 2, tipZ]);
    closeCm(centroidCm(overlay, rays.irDot!), [50 - 0.6, 40 + tipX + 2.3, tipZ]);
    // Raised (lift 90: the boom 50° up), the beam goes up with the carriage.
    overlay.update(world(readouts({ detected: false, hitId: null }, { hitId: null, distanceCm: null }), 90), true, 0.5, 0);
    closeCm(centroidCm(overlay, half(rays.irTube!, false)), [49.4, 40 + 4.5 + 5 * Math.cos(50 * DEG) + 0.3, 4.9 + 5 * Math.sin(50 * DEG)]);
    expect(overlay.probe().gripper!.ir).toEqual({ role: 'irClaw', visible: true, detected: false });
  });

  it('is faint with no dot while it sees nothing, strong with its dot when it sees something', () => {
    const overlay = make();
    const rays = () => overlay.gripperRays!;
    overlay.update(world(readouts({ detected: false, hitId: 'cube-black' }, { hitId: null, distanceCm: null })), true, 0.5, 0);
    // The colour attribute is float32: to six digits.
    paintOf(overlay, rays().irTube!).forEach((value, i) => expect(value).toBeCloseTo(rgba(sensorColors.ir, 0.35)[i]!, 6));
    expect(paintOf(overlay, rays().irDot!)[3]).toBe(0);
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: null, distanceCm: null })), true, 0.5, 0);
    expect(paintOf(overlay, rays().irTube!)[3]).toBeCloseTo(0.95, 6);
    expect(paintOf(overlay, rays().irDot!)[3]).toBeCloseTo(0.95, 6);
    expect(overlay.probe().gripper!.ir).toEqual({ role: 'irClaw', visible: true, detected: true });
  });
});

describe('the gripper car’s colour spot (N19 E5)', () => {
  it('reaches what the sensor meets, 1.4 cm on, the spot there facing the sensor; with no hit its 4 cm range and no spot', () => {
    const overlay = make();
    const rays = overlay.gripperRays!;
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red })), true, 0.5, 0);
    const mount = [50 + 0.6, 40 + tipX + 0.3, tipZ];
    closeCm(centroidCm(overlay, half(rays.colorRay!, false)), mount);
    closeCm(centroidCm(overlay, half(rays.colorRay!, true)), [mount[0]!, mount[1]! + 1.4, mount[2]!]);
    // The disc stands 0.13 cm off the face, towards the sensor, in its ring 0.1 cm off.
    closeCm(centroidCm(overlay, rays.spot!), [mount[0]!, mount[1]! + 1.4 - 0.13, mount[2]!]);
    closeCm(centroidCm(overlay, rays.ring!), [mount[0]!, mount[1]! + 1.4 - 0.1, mount[2]!]);
    expect(overlay.probe().gripper!.color).toEqual({ role: 'color1', visible: true, hit: true, reachCm: 1.4, color: 'red' });
    overlay.update(world(readouts({ detected: false, hitId: null }, { hitId: null, distanceCm: null, rgbc: unclear })), true, 0.5, 0);
    closeCm(centroidCm(overlay, half(rays.colorRay!, true)), [mount[0]!, mount[1]! + 4, mount[2]!]);
    expect(paintOf(overlay, rays.spot!)[3]).toBe(0);
    expect(paintOf(overlay, rays.ring!)[3]).toBe(0);
    expect(overlay.probe().gripper!.color).toMatchObject({ hit: false, reachCm: 4 });
  });

  it('is tinted with the colour the counts read, in its dark ring; a ring alone for one it cannot tell or before its first window', () => {
    const overlay = make();
    const rays = overlay.gripperRays!;
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red })), true, 0.5, 0);
    const tint = rgba(bodyPalette.red, 1);
    paintOf(overlay, rays.spot!).forEach((value, i) => expect(value).toBeCloseTo(tint[i]!, 6));
    expect(paintOf(overlay, rays.ring!)[3]).toBeCloseTo(0.95, 6);
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: unclear })), true, 0.5, 0);
    expect(paintOf(overlay, rays.spot!)[3]).toBe(0);
    expect(paintOf(overlay, rays.ring!)[3]).toBeCloseTo(0.95, 6);
    expect(overlay.probe().gripper!.color!.color).toBe('unknown');
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4 })), true, 0.5, 0);
    expect(paintOf(overlay, rays.spot!)[3]).toBe(0);
    expect(overlay.probe().gripper!.color!.color).toBeNull();
  });
});

describe('the gripper car’s tag (N19 E5)', () => {
  it('says what the IR and the colour sensor read, over the jaws’ middle, painted only when its words change', () => {
    const { label, painted } = recordingWords();
    const overlay = make(label);
    expect(label.sprite.position.toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.03, GRIPPER_LABEL_LIFT_M, 0]);
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red })), true, 0.5, 0);
    // The same words at rest (new counts of the same red, the arm a little higher): no paint.
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.41, rgbc: { r: 14_100, g: 3010, b: 2810, c: 19_920 } }), 5), true, 0.5, 0.1);
    overlay.update(world(readouts({ detected: false, hitId: null }, { hitId: null, distanceCm: null })), true, 0.5, 0.2);
    overlay.update(world(readouts({ detected: false, hitId: null }, { hitId: null, distanceCm: null, rgbc: unclear })), true, 0.5, 0.3);
    expect(painted).toEqual(['IR: có vật | Màu: đỏ', 'IR: không có vật | Màu: chưa có số đọc', 'IR: không có vật | Màu: không rõ']);
    expect(overlay.probe().gripper!.label).toEqual(['IR: không có vật', 'Màu: không rõ']);
    expect(overlay.gripperLabelShown()).toBe(true);
  });

  it('is gone with the overlay, and before there is a reading (the idle world has none)', () => {
    const { label } = recordingWords();
    const overlay = make(label);
    overlay.update(idle, true, 0.5, 0);
    expect(named(overlay, 'sensor-gripper')[0]!.visible).toBe(false);
    expect(overlay.gripperLabelShown()).toBe(false);
    expect(overlay.probe().gripper).toEqual({ ir: { role: 'irClaw', visible: false, detected: false }, color: { role: 'color1', visible: false, hit: false, reachCm: 0, color: null }, label: null });
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red })), false, 0.5, 0);
    expect(overlay.root.visible).toBe(false);
    expect(overlay.gripperLabelShown()).toBe(false);
    expect(overlay.probe().gripper!.label).toBeNull();
  });
});

describe('what the gripper’s overlays cost (N19 E5)', () => {
  it('one mesh and one tag more, of the overlay’s one program; the rover’s overlay has neither', () => {
    const { label } = recordingWords();
    const overlay = make(label);
    overlay.update(world(readouts({ detected: true, hitId: 'cube-red' }, { hitId: 'cube-red', distanceCm: 1.4, rgbc: red })), true, 0.5, 0);
    const shown: Object3D[] = [];
    overlay.root.traverseVisible((node) => {
      if (node instanceof Mesh || node instanceof Sprite) shown.push(node);
    });
    // The ultrasonic beam (its tag is the test's none; no line sensor's spot is on the mat here), the gripper's rays and its tag.
    expect(shown.map((node) => node.name).sort()).toEqual(['gripper-sensor-label', 'sensor-beam', 'sensor-gripper-rays']);
    const rays = named(overlay, 'sensor-gripper-rays')[0] as Mesh;
    const beam = named(overlay, 'sensor-beam')[0] as Mesh;
    expect(rays.material).toBe(beam.material);
    expect((rays.material as MeshBasicMaterial).vertexColors).toBe(true);
    const rover = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
    const roverOverlay = make(label, rover, scenarioCatalog.get('rb-stop-at-wall')!);
    expect(named(roverOverlay, 'sensor-gripper')).toEqual([]);
    expect(roverOverlay.gripperRays).toBeNull();
    expect(roverOverlay.gripperLabel).toBeNull();
    expect(roverOverlay.probe().gripper).toBeNull();
  });
});


describe('when the gripper car’s overlay asks for a frame (N19 E4/E5 minor round, review 2 N2)', () => {
  // A goal placed by colour (red cube to the red zone), then one to reach the warehouse: the goal zone lit changes when the first passes, and
  // only the colours tell which zone the first one needs (the cube's own red, with no round shown).
  const label = { vi: 'x', en: 'x' };
  const goals = [
    { id: 'sort', kind: 'object-placed', label, points: 50, object: 'cube-red', zoneByColor: { [bodyPalette.red]: 'red-zone', [bodyPalette.blue]: 'blue-zone' }, fully: true, maxTiltDeg: 15, restS: 0.5, carried: true, maxSlideCm: 3, minCarryLiftCm: 1, minCarryCm: 5 },
    { id: 'home', kind: 'reach-zone', label, points: 50, zone: 'kho' },
  ] as unknown as typeof scenario.goals;
  const sorting = { ...scenario, goals };
  const before = world([], 0, { score: { points: 0, maxScore: 100, goals: [] } });
  const after = world([], 0, { score: { points: 50, maxScore: 100, goals: [{ id: 'sort', passed: true, points: 50, progress: 1 }] } });

  it('tells the change it draws: the red zone lit (the cube’s own colour), then the warehouse, with the very colours it lights by', () => {
    const overlay = make(null, gripperKit, sorting);
    overlay.update(before, true, 0.5, 0);
    expect(overlay.probe().zone).toBe('red-zone');
    overlay.update(after, true, 0.5, 0);
    expect(overlay.probe().zone).toBe('kho');
    // The frame check sees that change (without the colours both would light the warehouse, and the change would go unseen).
    expect(overlay.sameView(before, after)).toBe(false);
    expect(overlay.sameView(before, { ...before, t: 1 })).toBe(true);
  });

  it('follows the round’s colours too: a round painting the cube blue lights the blue zone, and the check knows it', () => {
    const overlay = make(null, gripperKit, sorting);
    overlay.setRoundColors({ 'cube-red': bodyPalette.blue });
    overlay.update(before, true, 0.5, 0);
    expect(overlay.probe().zone).toBe('blue-zone');
    expect(overlay.sameView(before, after)).toBe(false);
  });
});
