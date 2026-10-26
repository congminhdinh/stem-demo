import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, BufferGeometry, Material, Mesh, MeshLambertMaterial, MeshStandardMaterial, Texture, Vector3, type Object3D } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { gripperPose } from '../gripper-pose';
import { robotModel, type RobotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { applyRobotWorld, assembleRobot, BOARD_M, boardPlacement, gripperReferenceSizes, neededParts, referenceSizes, ultrasonicRiser, type AssemblyOptions } from './robot-assembly';

// N19 E6: the gripper car built from the modelled parts (robot-kit.glb's part_gripper_*, assets-src/robot3d/parts/gripper.py) is the car
// the physics simulates: the boom pivots at the GR1 mount, the carriage hangs level at its tip, each finger turns about its hinge and is
// the physics' finger box, the sensors sit on the carriage at their mounts; it is posed from the snapshot's robot.gripper every frame, its
// colour sensor's LED lit while the robot runs; it adds few draws and few triangles (plan §3), and frees what it made.

const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
const reference = referenceSizes(robotModel(roverKit, unoR3Board));
const model = robotModel(gripperKit, unoR3Board);
const gripperReference = gripperReferenceSizes(model)!;
const g = model.gripper!;
let assets: Record<'high' | 'low', RobotAssets>;

beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});

const options = (detail: 'high' | 'low'): AssemblyOptions => ({ detail, shadows: detail === 'high', flag: null, boardLedPin: 13, blob: new Texture(), gripperReference });
const idle = idleSnapshot(scenarioCatalog.get('rb-line-follow')!, gripperKit);
const at = (clawDeg: number, liftDeg: number, status: RobotSnapshot['status'] = 'idle'): RobotSnapshot => ({ ...idle, status, robot: { ...idle.robot, gripper: { clawDeg, liftDeg, heldId: null } } });
const worldOf = (node: Object3D) => node.getWorldPosition(new Vector3()).toArray();
const close = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
const meshCount = (root: Object3D) => {
  let count = 0;
  root.traverse((node) => node instanceof Mesh && node.visible && count++);
  return count;
};
/** The vertices of the meshes under `node`, in `node`'s own frame. */
function verticesOf(node: Object3D): Vector3[] {
  node.updateWorldMatrix(true, true);
  const toNode = node.matrixWorld.clone().invert();
  const out: Vector3[] = [];
  node.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const position = (child.geometry as BufferGeometry).getAttribute('position');
    for (let i = 0; i < position.count; i++) out.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).applyMatrix4(toNode));
  });
  return out;
}
const span = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)];

describe('the modelled gripper car (N19 E6)', () => {
  for (const detail of ['high', 'low'] as const) {
    it(`pivots the boom at the mount, hangs the carriage level at its tip and puts the fingers at their hinges, as robot.gripper says (${detail})`, () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      for (const [claw, lift] of [
        [0, 90],
        [0, 0],
        [80, 45],
      ] as const) {
        applyRobotWorld(robot.handles, at(claw, lift), '#f00', '#300');
        robot.root.updateMatrixWorld(true);
        const pose = gripperPose(g, { clawDeg: claw, liftDeg: lift });
        close(worldOf(handles.boom), g.position);
        expect(handles.boom.rotation.z).toBeCloseTo(pose.elevationRad, 9);
        // The parallelogram's lower link turns as the boom does, about its own pivot under the boom's.
        expect(handles.link!.rotation.z).toBeCloseTo(pose.elevationRad, 9);
        expect(worldOf(handles.link!)[0]).toBeCloseTo(g.position[0], 9);
        expect(worldOf(handles.link!)[1]).toBeLessThan(g.position[1] - 0.005);
        close(worldOf(handles.carriage), pose.tip);
        expect(handles.carriage.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
        close(worldOf(handles.jawLeft), pose.jawLeft);
        close(worldOf(handles.jawRight), pose.jawRight);
        expect(handles.jawLeft.rotation.y).toBeCloseTo(pose.betaRad, 9);
        expect(handles.jawRight.rotation.y).toBeCloseTo(-pose.betaRad, 9);
      }
      robot.dispose();
    });
  }

  it('draws each finger as the physics’ finger box past the carriage: 5 cm along, 0.4 cm thick, 1.2 cm high, its pad on the inner side', () => {
    const robot = assembleRobot(model, reference, assets.high.part, options('high'));
    const { jawLeft, jawRight } = robot.handles.gripper!;
    for (const [jaw, inner] of [
      [jawLeft, 1],
      [jawRight, -1],
    ] as const) {
      const past = verticesOf(jaw).filter((v) => v.x > g.hinge.uM + 0.002);
      const [x0, x1] = span(past.map((v) => v.x));
      const [y0, y1] = span(past.map((v) => v.y));
      const [z0, z1] = span(past.map((v) => v.z));
      expect(x1).toBeCloseTo(g.finger.lengthM, 4);
      expect(x0).toBeGreaterThan(0);
      expect(y0).toBeCloseTo(-g.finger.heightM / 2, 4);
      expect(y1).toBeCloseTo(g.finger.heightM / 2, 4);
      // Three's z is the robot's −y: the left finger's inner side (robot −y) is +z.
      expect(inner > 0 ? z1 : -z0).toBeCloseTo(g.finger.thicknessM / 2, 4);
      expect(inner > 0 ? -z0 : z1).toBeCloseTo(g.finger.thicknessM / 2, 4);
    }
    robot.dispose();
  });

  it('draws the boom’s arms as the physics’ plates (at ±boomHalfSpanCm, 1 cm high) and nothing of the carriage between the jaws past its front', () => {
    const robot = assembleRobot(model, reference, assets.high.part, options('high'));
    applyRobotWorld(robot.handles, at(0, 0), '#f00', '#300');
    const { boom, carriage } = robot.handles.gripper!;
    const arms = verticesOf(boom).filter((v) => Math.abs(Math.abs(v.z) - g.boomHalfSpanM) < 0.0021);
    const [ax0, ax1] = span(arms.map((v) => v.x));
    expect(ax0).toBeCloseTo(-0.005, 3);
    expect(ax1).toBeCloseTo(g.boomLengthM + 0.005, 3);
    expect(Math.max(...arms.map((v) => Math.abs(v.y)))).toBeCloseTo(0.005, 4);
    // Between the fingers' hinges, the carriage (with the IR and colour modules on it) ends at the physics' carriage box: 0.5 cm ahead.
    const middle = verticesOf(carriage).filter((v) => Math.abs(v.z) < g.hinge.vM - 0.004 && Math.abs(v.y) < 0.0062);
    expect(Math.max(...middle.map((v) => v.x))).toBeLessThanOrEqual(0.005 + 1e-6);
    robot.dispose();
  });

  it('puts the IR and colour modules on the carriage at their mounts, and lights the colour sensor’s LED while the robot runs', () => {
    for (const detail of ['high', 'low'] as const) {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const handles = robot.handles.gripper!;
      expect(handles.led).not.toBeNull();
      // The carriage's own copy of the gripper's material (its glow map, the LED's cell, is the file's texture: Node's loader drops it).
      expect(handles.led!).toBeInstanceOf(detail === 'high' ? MeshStandardMaterial : MeshLambertMaterial);
      expect(handles.led!.name).toMatch(/^gripper_atlas/);
      expect(assets[detail].part('part_gripper_carriage')!.getObjectsByProperty('type', 'Mesh').every((mesh) => (mesh as Mesh).material !== handles.led)).toBe(true);
      // Its halo at the LED's face on the colour module (the module's mount on the carriage, plus the face's offset `extras.led`).
      const face = assets[detail].part('part_gripper_color')!.userData.led as number[];
      close(handles.ledHalo!.position.toArray(), [g.color!.position[0] + face[0]!, g.color!.position[1] + face[1]!, g.color!.position[2] + face[2]!], 9);
      expect(handles.ledHalo!.position.x).toBeLessThanOrEqual(0.005);
      applyRobotWorld(robot.handles, at(0, 90, 'idle'), '#f00', '#300');
      expect(handles.led!.emissiveIntensity).toBe(0);
      expect(handles.ledHalo!.visible).toBe(false);
      applyRobotWorld(robot.handles, at(0, 90, 'running'), '#f00', '#300');
      expect(handles.led!.emissiveIntensity).toBeGreaterThan(1);
      expect(handles.ledHalo!.visible).toBe(true);
      applyRobotWorld(robot.handles, at(0, 90, 'finished'), '#f00', '#300');
      expect(handles.led!.emissiveIntensity).toBe(0);
      expect(handles.ledHalo!.visible).toBe(false);
      robot.dispose();
    }
  });

  for (const [detail, draws, triangles] of [
    ['high', 6, 6000],
    ['low', 6, 2500],
  ] as const) {
    it(`adds at most ${draws} draws and ${triangles} triangles to the car (${detail}: each moving part one mesh, the bracket merged)`, () => {
      const without: RobotModel = { ...model, gripper: null };
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      const bare = assembleRobot(without, reference, assets[detail].part, options(detail));
      expect(meshCount(robot.root) - meshCount(bare.root)).toBeLessThanOrEqual(draws);
      let tris = 0;
      for (const name of ['part_gripper_bracket', 'part_gripper_boom', 'part_gripper_carriage', 'part_gripper_jaw_l', 'part_gripper_jaw_r', 'part_gripper_ir', 'part_gripper_color']) {
        assets[detail].part(name)!.traverse((node) => {
          if (node instanceof Mesh) tris += ((node.geometry as BufferGeometry).index?.count ?? 0) / 3;
        });
      }
      expect(tris).toBeLessThanOrEqual(triangles);
      robot.dispose();
      bare.dispose();
    });
  }

  it('stands the gripper kit’s ultrasonic (1 cm higher than the reference kit’s) on standoffs down to the lower plate; the rover has none', () => {
    const riser = ultrasonicRiser(model, reference)!;
    expect(riser.heightM).toBeCloseTo(0.01, 12);
    const part = assets.high.part('part_ultrasonic_riser')!.clone(true);
    part.position.set(...riser.position);
    part.scale.y = riser.heightM / Number(part.userData.height);
    const box = new Box3().setFromObject(part, true);
    expect(box.max.y - box.min.y).toBeCloseTo(0.01, 4);
    // Its foot on the lower plate's top (0.2 cm thick), its top under the ultrasonic bracket's foot.
    expect(box.min.y).toBeCloseTo(model.body.bottomM + 0.002, 4);
    expect(ultrasonicRiser(robotModel(roverKit, unoR3Board), reference)).toBeNull();
    const plain = assembleRobot(robotModel(roverKit, unoR3Board), reference, assets.high.part, { ...options('high'), gripperReference: null });
    expect(plain.handles.gripper).toBeNull();
    plain.dispose();
  });

  it('sits the board as far forward as the line sensors’ indicator board lets it on a car with no servo arm (the gripper car)', () => {
    // The indicator board reaches 1.2 cm back from 0.05 cm inside the deck's front edge; the board keeps its 1.2 mm from it.
    expect(boardPlacement(model).x + BOARD_M.short / 2).toBeCloseTo(model.body.lengthM / 2 - 0.0005 - 0.012 - BOARD_M.clearance, 9);
  });

  it('frees every geometry and material it made for the gripper, and none of the templates’', () => {
    const robot = assembleRobot(model, reference, assets.high.part, options('high'));
    const handles = robot.handles.gripper!;
    const made: (BufferGeometry | Material)[] = [];
    handles.carriage.traverse((node) => node instanceof Mesh && made.push(node.geometry, node.material as Material));
    const spies = made.map((item) => vi.spyOn(item, 'dispose'));
    const templates = new Set<BufferGeometry>();
    assets.high.part('part_gripper_jaw_l')!.traverse((node) => node instanceof Mesh && templates.add(node.geometry));
    const jawGeometry = (handles.jawLeft.children.find((child) => child instanceof Mesh) as Mesh | undefined)?.geometry;
    expect(jawGeometry && templates.has(jawGeometry)).toBe(true);
    const jawSpy = vi.spyOn(jawGeometry!, 'dispose');
    robot.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(jawSpy).not.toHaveBeenCalled();
    for (const spy of [...spies, jawSpy]) spy.mockRestore();
  });
});

describe('the parts a kit’s robot needs (N19 E6: Scene.tsx draws the simple robot without one of them)', () => {
  it('for the rover: N18’s twelve, so that a file without the gripper’s parts never sends a rover lesson to the simple shapes', () => {
    expect([...neededParts(roverKit)].sort()).toEqual(['part_board', 'part_button', 'part_buzzer', 'part_caster', 'part_chassis', 'part_led', 'part_line_bar', 'part_line_leds', 'part_servo', 'part_tt_motor', 'part_ultrasonic', 'part_wheel']);
  });

  it('for the gripper car: its own modules’ parts and the gripper’s, not the flag servo’s or the buzzer’s', () => {
    expect([...neededParts(gripperKit)].sort()).toEqual([
      'part_board',
      'part_button',
      'part_caster',
      'part_chassis',
      'part_gripper_boom',
      'part_gripper_bracket',
      'part_gripper_carriage',
      'part_gripper_color',
      'part_gripper_ir',
      'part_gripper_jaw_l',
      'part_gripper_jaw_r',
      'part_led',
      'part_line_bar',
      'part_line_leds',
      'part_tt_motor',
      'part_ultrasonic',
      'part_wheel',
    ]);
  });
});
