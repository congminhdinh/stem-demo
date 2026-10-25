import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Box3, BufferGeometry, Material, Mesh, Texture, Vector3, type Object3D } from 'three';
import { productionKits, unoR3Board } from '../../../core/hardware/catalog';
import type { Kit } from '../../../core/hardware/kit';
import type { PinState } from '../../../core/hardware/virtual-uno';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { loadTestAssets } from '../__fixtures__/load-glb';
import type { RobotAssets } from '../assets/robot-assets';
import { robotModel, type RobotModel } from '../robot-model';
import { idleSnapshot } from '../scene-math';
import { flagOf } from './GltfRobot';
import { applyRobotWorld, assembleRobot, boardPlacement, referenceSizes, type AssemblyOptions } from './robot-assembly';

// N18 R4.7: the robot built from the modelled parts (robot-kit.glb) is the robot the physics simulates: every part at its kit mount,
// the wheels of the kit's radius and width, the chassis' plates the body box, the sensors where they read; a kit of other sizes makes
// a robot of other sizes from the same files. Everything the robot makes for itself is freed by dispose().

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const model = robotModel(kit, unoR3Board);
const reference = referenceSizes(model);
let assets: Record<'high' | 'low', RobotAssets>;

beforeAll(async () => {
  assets = { high: await loadTestAssets('high'), low: await loadTestAssets('low') };
});

const options = (detail: 'high' | 'low', changes: Partial<AssemblyOptions> = {}): AssemblyOptions => ({ detail, shadows: detail === 'high', flag: null, boardLedPin: 13, blob: new Texture(), ...changes });
const worldOf = (node: Object3D) => node.getWorldPosition(new Vector3()).toArray();
const close = (actual: number[], expected: readonly number[], digits = 6) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));

/** The bounding box of the meshes under `node` in the robot's frame. */
function boundsOf(node: Object3D): Box3 {
  node.updateWorldMatrix(true, true);
  const box = new Box3();
  node.traverse((child) => {
    if (child instanceof Mesh && child.visible) box.union(new Box3().setFromObject(child, true));
  });
  return box;
}

/** A tyre's outer radius about its axle (three's z in the wheel's frame), from its vertices. */
function tyreRadius(spin: Object3D): number {
  const tyre = spin.getObjectByName('tyre') as Mesh;
  const position = tyre.geometry.getAttribute('position');
  let r = 0;
  for (let i = 0; i < position.count; i++) r = Math.max(r, Math.hypot(position.getX(i), position.getY(i)));
  return r * spin.parent!.scale.x;
}

describe('the modelled robot (N18 R4.7)', () => {
  for (const detail of ['high', 'low'] as const) {
    it(`puts each wheel at its motor's mount with the kit's radius and width, on the ${detail} tier`, () => {
      const robot = assembleRobot(model, reference, assets[detail].part, options(detail));
      robot.root.updateMatrixWorld(true);
      expect(robot.handles.wheels.map((wheel) => wheel.role)).toEqual(['motorLeft', 'motorRight']);
      robot.handles.wheels.forEach((wheel, i) => {
        close(worldOf(wheel.spin), model.wheels[i]!.position);
        expect(tyreRadius(wheel.spin)).toBeCloseTo(model.wheels[i]!.radiusM, 4);
        // The tread's width across the axle is the kit's wheel width.
        const box = boundsOf(wheel.spin);
        expect(box.max.z - box.min.z).toBeCloseTo(model.wheels[i]!.widthM, 3);
      });
      robot.dispose();
    });
  }

  it('builds the chassis plates to the kit body: 15 × 12 cm, from 1.5 cm above the floor to 6.5 cm', () => {
    const robot = assembleRobot(model, reference, assets.high.part, options('high'));
    const merged = robot.root.children.find((node) => node.name.startsWith('merged_anodised_orange')) as Mesh;
    const box = new Box3().setFromObject(merged, true);
    close(box.min.toArray(), [-0.075, 0.015, -0.06], 4);
    close(box.max.toArray(), [0.075, 0.065, 0.06], 4);
    robot.dispose();
  });

  it('puts the ultrasonic ranger, the line sensors’ lamps, the caster, the servo’s shaft and the modules at their mounts', () => {
    const robot = assembleRobot(model, reference, assets.high.part, options('high', { flag: { role: 'servo1', upDeg: 150 } }));
    robot.root.updateMatrixWorld(true);
    const named = (name: string) => {
      const found: Object3D[] = [];
      robot.root.traverse((node) => node.name === name && found.push(node));
      return found;
    };
    close(worldOf(named('part_ultrasonic')[0]!), model.ultrasonics[0]!.position);
    close(worldOf(named('part_caster')[0]!), model.caster!.position);
    close(worldOf(named('servo_horn')[0]!), model.servos[0]!.position);
    close(worldOf(named('part_led')[0]!), model.leds[0]!.position);
    close(worldOf(named('part_buzzer')[0]!), model.buzzers[0]!.position);
    close(worldOf(named('part_button')[0]!), model.buttons[0]!.position);
    // Each line sensor's lamp sits in line with its own eye across the robot (three's z), the lamps in the sensors' order in the snapshot,
    // on the deck's top at its front edge, where it shows from behind and above, inside the body the physics drives (its nose); its red
    // spot lies on the mat right under the eye.
    const deck = model.body.bottomM + model.body.heightM;
    for (const sensor of model.lineSensors) {
      const lamp = robot.handles.lineLamps.find((item) => item.sensorIndex === sensor.sensorIndex)!;
      const at = lamp.glow.parent!.getWorldPosition(new Vector3());
      expect(at.z).toBeCloseTo(sensor.position[2], 4);
      expect(at.x).toBeGreaterThan(model.body.lengthM / 2 - 0.012);
      expect(at.y).toBeGreaterThan(deck);
      // The LED itself (not its halo, a sprite).
      const mesh = lamp.glow.parent as Mesh;
      mesh.geometry.computeBoundingBox();
      const led = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
      expect(led.max.x).toBeLessThanOrEqual(model.body.lengthM / 2 + 1e-6);
      close(lamp.spot.getWorldPosition(new Vector3()).toArray(), [sensor.position[0], 0.0009, sensor.position[2]]);
    }
    robot.dispose();
  });

  it('sits the board on the deck behind the servo arm’s sweep', () => {
    expect(boardPlacement(model).x).toBeCloseTo(0.015 - 0.004 - 0.0012 - 0.0533 / 2, 9);
  });

  it('makes a robot of another kit’s sizes from the same parts: a bigger body, bigger wheels', () => {
    const big: RobotModel = {
      ...model,
      body: { lengthM: 0.18, widthM: 0.14, heightM: 0.06, bottomM: 0.02 },
      wheels: model.wheels.map((wheel) => ({ ...wheel, radiusM: 0.04, widthM: 0.03, position: [wheel.position[0], 0.04, wheel.position[2] * (0.085 / 0.075)] as const })),
    };
    const robot = assembleRobot(big, reference, assets.high.part, options('high'));
    robot.root.updateMatrixWorld(true);
    const merged = robot.root.children.find((node) => node.name.startsWith('merged_anodised_orange')) as Mesh;
    const box = new Box3().setFromObject(merged, true);
    close(box.min.toArray(), [-0.09, 0.02, -0.07], 4);
    close(box.max.toArray(), [0.09, 0.08, 0.07], 4);
    robot.handles.wheels.forEach((wheel, i) => {
      close(worldOf(wheel.spin), big.wheels[i]!.position);
      expect(tyreRadius(wheel.spin)).toBeCloseTo(0.04, 4);
      const bounds = boundsOf(wheel.spin);
      expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.03, 3);
    });
    robot.dispose();
  });

  it('draws the low tier with Lambert materials, its plain parts as one vertex-coloured mesh, in fewer draws', () => {
    const count = (root: Object3D) => {
      let meshes = 0;
      root.traverse((node) => node instanceof Mesh && node.visible && meshes++);
      return meshes;
    };
    const high = assembleRobot(model, reference, assets.high.part, options('high'));
    const low = assembleRobot(model, reference, assets.low.part, options('low'));
    const materials = new Set<Material>();
    low.root.traverse((node) => node instanceof Mesh && materials.add(node.material as Material));
    for (const material of materials) expect(['MeshLambertMaterial', 'MeshBasicMaterial']).toContain(material.type);
    expect([...materials].filter((material) => material.name === 'plain-low')).toHaveLength(1);
    expect(count(low.root)).toBeLessThan(count(high.root));
    expect(count(high.root)).toBeLessThanOrEqual(60);
    high.dispose();
    low.dispose();
  });

  it('frees every geometry and material it made, and none of the templates’', () => {
    const robot = assembleRobot(model, reference, assets.low.part, options('low'));
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    robot.root.traverse((node) => {
      if (node instanceof Mesh) {
        geometries.add(node.geometry);
        materials.add(node.material as Material);
      }
    });
    const templates = new Set<BufferGeometry>();
    for (const name of ['part_chassis', 'part_board', 'part_tt_motor', 'part_wheel', 'part_caster', 'part_ultrasonic', 'part_line_bar', 'part_servo', 'part_led', 'part_buzzer', 'part_button']) {
      assets.low.part(name)!.traverse((node) => node instanceof Mesh && templates.add(node.geometry));
    }
    // Some meshes are the templates' (the parts that move are cloned, not merged): those the cache keeps.
    expect([...geometries].some((geometry) => templates.has(geometry))).toBe(true);
    const spies = [...geometries, ...materials].map((item) => vi.spyOn(item, 'dispose'));
    robot.dispose();
    for (const geometry of geometries) expect((geometry.dispose as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(templates.has(geometry) ? 0 : 1);
    // On the low tier every material is the robot's own (Lambert copies, the glows, the shadow): each freed once.
    for (const material of materials) expect((material.dispose as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
    for (const spy of spies) spy.mockRestore();
  });
});

describe('what the modelled robot shows (N18 R4.7)', () => {
  const scenario = scenarioCatalog.get('rb-servo-gate')!;
  const idle = idleSnapshot(scenario, kit);

  it('raises the flag of rb-servo-gate up its mast as the arm turns to the goal’s angle, and turns the arm about its shaft', () => {
    const flag = flagOf(scenario);
    expect(flag).toEqual({ role: 'servo1', upDeg: 150 });
    const robot = assembleRobot(model, reference, assets.high.part, options('high', { flag }));
    const servo = robot.handles.servos[0]!;
    const pennant = servo.pennant!;
    expect(pennant.high).toBeGreaterThan(pennant.low + 0.04);
    applyRobotWorld(robot.handles, { ...idle, robot: { ...idle.robot, servoDeg: { servo1: 0 } } }, '#f00', '#300');
    expect(pennant.node.position.y).toBeCloseTo(pennant.low, 9);
    applyRobotWorld(robot.handles, { ...idle, robot: { ...idle.robot, servoDeg: { servo1: 160 } } }, '#f00', '#300');
    expect(pennant.node.position.y).toBeCloseTo(pennant.high, 9);
    expect(servo.horn.rotation.y).toBeCloseTo(((-90 + 160) * Math.PI) / 180, 9);
    robot.dispose();
  });

  it('shows no flag where no goal asks for the servo, and lights the LED, the line lamps and the board’s L LED from the world', () => {
    const robot = assembleRobot(model, reference, assets.high.part, options('high'));
    expect(robot.handles.servos[0]!.pennant).toBeNull();
    const pins: PinState[] = unoR3Board.pins.map((pin) => ({ pin: pin.id, mode: 'OUTPUT', level: pin.id === 'D13' ? 1 : 0, duty: 0, toneHz: null, servoDeg: null }));
    const lit = { ...idle, leds: { led1: true }, pins, sensors: [{ role: 'ultrasonic', kind: 'ultrasonic' as const, cm: 40, hitId: null }, ...model.lineSensors.map((s, i) => ({ role: s.role, kind: 'line-sensor' as const, reflectance: 0, dark: i === 1, spotCm: [0, 0] as [number, number] }))] };
    applyRobotWorld(robot.handles, lit, '#ff3b30', '#7f1d1d');
    expect(robot.handles.leds[0]!.material.emissiveIntensity).toBeGreaterThan(0);
    expect(robot.handles.leds[0]!.light!.intensity).toBeGreaterThan(0);
    expect(robot.handles.lineLamps.map((lamp) => lamp.glow.visible)).toEqual(robot.handles.lineLamps.map((lamp) => lamp.sensorIndex === 2));
    expect(robot.handles.lineLamps.map((lamp) => lamp.spot.visible)).toEqual(robot.handles.lineLamps.map((lamp) => lamp.sensorIndex === 2));
    expect(robot.handles.boardLed!.material.emissiveIntensity).toBeGreaterThan(0);
    // Pressed: the button's cap goes down by its travel.
    const button = robot.handles.buttons[0]!;
    applyRobotWorld(robot.handles, { ...idle, pins: pins.map((pin): PinState => (pin.pin === 'D3' ? { ...pin, mode: 'INPUT', level: 0 } : pin)) }, '#f00', '#300');
    expect(button.cap.position.y).toBeCloseTo(button.down, 9);
    expect(button.up - button.down).toBeCloseTo(0.0015, 6);
    robot.dispose();
  });
});
