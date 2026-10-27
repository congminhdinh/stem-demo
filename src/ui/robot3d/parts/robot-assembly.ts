import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RobotSnapshot } from '../../../core/world/snapshot';
import type { Detail } from '../lighting/look';
import { robot3dColors as colors } from '../colors';
import type { Kit, ModuleKind } from '../../../core/hardware/kit';
import { colorLedLit, createGripperPose, gripperPoseInto, gripperStateOf, type GripperPose } from '../gripper-pose';
import { buttonPressed, lineSeesDark, toneHzOf, type GripperModel, type RobotModel } from '../robot-model';
import { servoArmYawRad, wheelSpin, type Vec3Tuple } from '../scene-math';
import { bakeMovingPlain, lambertOf, lowTierMaterials, mergeStatic, swapMaterials } from './merge';

// The robot of the 3D view built from the modelled parts (N18 R4.7): each part of robot-kit.glb (assets-src/robot3d/parts/) cloned,
// put at its kit mount (RobotModel, the same numbers the physics builds the robot from) and scaled from the kit's spec where it differs
// from the reference kit the parts are modelled to: the chassis to the body box, a wheel to its radius and width, the caster to its
// ball, the servo's arm to its length, the line bar to its eyes' spacing. The parts that never move are merged into one mesh per
// material; what moves or lights up keeps its node, found by name, and `applyRobotWorld` drives it from the snapshot every frame:
// `wheel_spin`, `servo_horn` with the flag's `flag_pennant`, `led_dome`, `line_led_<i>`, `button_cap`, `board_led_l`. A line sensor that
// sees dark lights its LED on the bar's indicator board at the deck's front edge (with a red halo), and a red spot on the mat under its
// eye. N19 E6: the gripper (part_gripper_*), its boom and lower link turned, its carriage (with the IR and colour modules merged into it)
// and fingers posed from the snapshot's robot.gripper (gripper-pose.ts), the colour sensor's LED lit while the robot runs; and, for a kit
// that mounts the ultrasonic higher than the reference kit, its standoffs (part_ultrasonic_riser).

/** The reference kit's numbers the parts are modelled to (m, three's frame of the robot group). */
export type ReferenceSizes = {
  body: RobotModel['body'];
  wheelRadiusM: number;
  wheelWidthM: number;
  casterRadiusM: number;
  casterGapM: number;
  armLengthM: number;
  armWidthM: number;
  lineSpacingM: number;
  /** N19 E6: how high the ultrasonic's mount is over the body's bottom (the part is modelled to stand on the lower plate from there). */
  ultrasonicHeightM: number;
  /** N19 E6 fix round 1 (review I3): where the board sits on the reference robot's deck (three's x of its middle). */
  boardX: number;
};

/** N19 E6: the gripper kit's numbers the gripper's parts are modelled to (m): a kit of other sizes scales them. */
export type GripperReferenceSizes = { boomLengthM: number; boomHalfSpanM: number; fingerLengthM: number; fingerThicknessM: number; fingerHeightM: number };

export function gripperReferenceSizes(reference: RobotModel): GripperReferenceSizes | null {
  const g = reference.gripper;
  return g ? { boomLengthM: g.boomLengthM, boomHalfSpanM: g.boomHalfSpanM, fingerLengthM: g.finger.lengthM, fingerThicknessM: g.finger.thicknessM, fingerHeightM: g.finger.heightM } : null;
}

export function referenceSizes(reference: RobotModel): ReferenceSizes {
  const wheel = reference.wheels[0]!;
  const zs = reference.lineSensors.map((sensor) => sensor.position[2]).sort((a, b) => a - b);
  return {
    body: reference.body,
    wheelRadiusM: wheel.radiusM,
    wheelWidthM: wheel.widthM,
    casterRadiusM: reference.caster?.radiusM ?? 0.0075,
    casterGapM: reference.caster ? reference.body.bottomM - reference.caster.position[1] : 0.0075,
    armLengthM: reference.servos[0]?.arm.lengthM ?? 0.055,
    armWidthM: reference.servos[0]?.arm.widthM ?? 0.008,
    lineSpacingM: zs.length > 1 ? (zs[zs.length - 1]! - zs[0]!) / (zs.length - 1) : 0.015,
    ultrasonicHeightM: reference.ultrasonics[0] ? reference.ultrasonics[0].position[1] - reference.body.bottomM : 0.025,
    boardX: boardPlacement(reference).x,
  };
}

/** The parts of robot-kit.glb a kit's robot is built from (N19 E6): a file without one of them sends the view to its simple shapes. */
export function neededParts(kit: Pick<Kit, 'modules'>): ReadonlySet<string> {
  const byKind: Partial<Record<ModuleKind, readonly string[]>> = {
    'dc-motor': ['part_tt_motor', 'part_wheel'],
    ultrasonic: ['part_ultrasonic'],
    'line-sensor': ['part_line_bar', 'part_line_leds'],
    servo: ['part_servo'],
    led: ['part_led'],
    buzzer: ['part_buzzer'],
    button: ['part_button'],
    gripper: ['part_gripper_bracket', 'part_gripper_boom', 'part_gripper_carriage', 'part_gripper_jaw_l', 'part_gripper_jaw_r'],
    'ir-obstacle': ['part_gripper_ir'],
    'color-sensor': ['part_gripper_color'],
  };
  return new Set(['part_chassis', 'part_board', 'part_caster', ...kit.modules.flatMap((module) => byKind[module.kind] ?? [])]);
}

/**
 * N19 E6: the ultrasonic's standoffs for a kit that mounts it higher over the body's bottom than the reference kit (the part stands on
 * the lower plate from the reference's height): where the standoffs' top goes (under the bracket's foot, the part's `extras.drop` under
 * the mount) and how tall they are; null when the ultrasonic is not higher (the rover).
 */
export function ultrasonicRiser(model: RobotModel, reference: ReferenceSizes, dropM = reference.ultrasonicHeightM - PLATE_M): { position: Vec3Tuple; heightM: number } | null {
  const sensor = model.ultrasonics[0];
  if (!sensor) return null;
  const heightM = sensor.position[1] - model.body.bottomM - reference.ultrasonicHeightM;
  if (heightM < 0.0005) return null;
  return { position: [sensor.position[0], sensor.position[1] - dropM, sensor.position[2]], heightM };
}

/** The controller board's size (m): its short side along x, its long side across; and the gap it keeps from a servo arm. */
export const BOARD_M = { short: 0.0533, long: 0.0686, clearance: 0.0012 } as const;
/** The chassis plates' thickness (m, assets-src/robot3d/parts/chassis.py PLATE_T). */
const PLATE_M = 0.002;

/** Where the board sits on the deck: as far forward as the servo arms let it, inside the deck (three's x, z of its middle). */
export function boardPlacement(model: RobotModel): { x: number; z: number } {
  const half = model.body.lengthM / 2;
  const fronts = model.servos.map((servo) => servo.position[0] - servo.arm.widthM / 2 - BOARD_M.clearance);
  const front = Math.min(half - 0.003, ...fronts);
  return { x: Math.max(-half + BOARD_M.short / 2, front - BOARD_M.short / 2), z: 0 };
}

/**
 * N19 E6 fix round 1 (review I3): where the board sits on a kit's deck. A kit with a servo arm puts it behind the arm (`boardPlacement`);
 * one with none (the gripper car) where the reference robot has it, over the deck the chassis part was baked under (its ambient
 * occlusion: elsewhere the deck would show the board's shade where no board is), and well behind the line sensors' indicator board.
 */
export function boardPlacementOf(model: RobotModel, reference: ReferenceSizes): { x: number; z: number } {
  if (model.servos.length > 0) return boardPlacement(model);
  const half = model.body.lengthM / 2;
  return { x: Math.min(half - BOARD_M.short / 2, Math.max(-half + BOARD_M.short / 2, reference.boardX)), z: 0 };
}

/** How far the line LEDs' board stands back from the deck's front edge (m): inside the body the physics drives. */
const LINE_LEDS_INSET_M = 0.0005;
/** The red glow over a lit line LED (a sprite of fixed size on the screen: its scale is a share of the view's height through the
 * field of view, about 12 px of a 497 px view at 40°), and the red spot on the mat under a dark eye (m across). */
const LINE_HALO_SCREEN = 0.0176;
const LINE_SPOT_M = 0.03;

/** A material whose glow the robot view sets: the high tier's standard one, or the low tier's Lambert copy. */
export type GlowMaterial = MeshStandardMaterial | MeshLambertMaterial;

export type RobotHandles = {
  wheels: { role: string; spin: Object3D }[];
  servos: { role: string; mountYawDeg: number; horn: Object3D; pennant: { node: Object3D; low: number; high: number; fromDeg: number; toDeg: number } | null }[];
  leds: { role: string; material: GlowMaterial; light: PointLight | null; halo: Object3D }[];
  lineLamps: { sensorIndex: number; material: GlowMaterial; glow: Object3D; spot: Object3D }[];
  buzzers: { pinIndex: number; waves: Object3D }[];
  buttons: { pinIndex: number; cap: Object3D; up: number; down: number }[];
  boardLed: { pinIndex: number; material: GlowMaterial } | null;
  /** N19 E6: the gripper's moving parts, which `applyRobotWorld` poses from robot.gripper; the colour sensor's LED (its carriage's material). */
  gripper: GripperHandles | null;
};

export type GripperHandles = {
  model: GripperModel;
  boom: Object3D;
  link: Object3D | null;
  carriage: Object3D;
  jawLeft: Object3D;
  jawRight: Object3D;
  led: GlowMaterial | null;
  /** The lit LED's halo (a sprite of fixed size on the screen, as a line lamp's): the LED is a few millimetres across. */
  ledHalo: Object3D | null;
  /** The pose each frame writes into (made once). */
  pose: GripperPose;
  /**
   * What the nodes show now (N19 E9): the claw and the arm of the last pose, and whether the LED was lit (null: nothing posed yet). A frame at
   * the same state writes nothing: an arm at rest, which is most frames of a run, makes no arithmetic and no object, whatever tier of the
   * JIT the code is in (the interpreter boxes every double it computes: 265 bytes a pose, robot-assembly.gripper.allocation.test.ts).
   */
  posedFor: { clawDeg: number; liftDeg: number; lit: boolean | null };
};

export type AssembledRobot = { root: Group; handles: RobotHandles; dispose(): void };

export type AssemblyOptions = {
  detail: Detail;
  shadows: boolean;
  /** The servo whose arm carries the scenario's flag (a goal on its angle), with the angle the flag is fully up at; or null. */
  flag: { role: string; upDeg: number } | null;
  /** The board pin of its "L" LED (D13 on an UNO-compatible board), as an index of the snapshot's pins, or -1. */
  boardLedPin: number;
  /** The soft round shadow under the robot (the low tier's only shadow). */
  blob: Texture;
  /** N19 E6: the gripper kit's sizes its parts are modelled to (GltfRobot.tsx), for a kit with a gripper. */
  gripperReference?: GripperReferenceSizes | null;
};

type PartSource = (name: string) => Object3D | null;

/** A deep copy of a template that shares its geometries and materials; null when there is no such template. */
function cloneOf(source: PartSource, name: string): Object3D | null {
  const template = source(name);
  if (!template) return null;
  const copy = template.clone(true);
  copy.position.set(0, 0, 0);
  copy.rotation.set(0, 0, 0);
  copy.scale.set(1, 1, 1);
  return copy;
}

const set = (node: Object3D, [x, y, z]: Vec3Tuple) => node.position.set(x, y, z);

/** Gives `node` its own copy of its material (a part whose look changes while the robot runs), which `owned` frees; on the low tier a Lambert one. */
function ownMaterial(node: Object3D | undefined, owned: Material[], low: boolean): GlowMaterial | null {
  if (!(node instanceof Mesh) || Array.isArray(node.material)) return null;
  const original = node.material as MeshStandardMaterial;
  const copy = low ? lambertOf(original) : original.clone();
  node.material = copy;
  owned.push(copy);
  return copy;
}

/** A jumper wire's path: from `a` up, along, and down into `b` (m, robot group frame), sagging a little. */
function wirePath(a: Vector3, b: Vector3, lift: number): Vector3[] {
  const high = Math.max(a.y, b.y) + lift;
  return [a, new Vector3(a.x, high, a.z), new Vector3((a.x + b.x) / 2, high + lift * 0.3, (a.z + b.z) / 2), new Vector3(b.x, high, b.z), b];
}

/** Jumper wires between the board's headers and the modules (high detail only): one mesh, each wire's colour in its vertices. */
function buildWires(model: RobotModel, board: { x: number; deck: number }, owned: { geometries: BufferGeometry[]; materials: Material[] }): Mesh | null {
  const headerTop = board.deck + 0.006 + 0.0016 + 0.0085;
  const front = board.x + BOARD_M.short / 2 - 0.0017;
  const back = board.x - BOARD_M.short / 2 + 0.0017;
  const wires: { points: Vector3[]; colour: string }[] = [];
  const palette = ['#e53935', '#202124', '#fbc02d', '#43a047', '#1e88e5', '#fb8c00'];
  model.ultrasonics.forEach((sensor) => {
    // Out of the digital header, along the deck, down through a plate hole beside the transducers, to the ranger's pins.
    for (let k = 0; k < 4; k++) {
      const z = -0.006 + k * 0.00254;
      const a = new Vector3(front, headerTop, z - 0.012);
      const hole = new Vector3(model.body.lengthM / 2 - 0.021, model.body.bottomM + model.body.heightM, 0.024 + k * 0.0022);
      const pin = new Vector3(sensor.position[0] - 0.0128, sensor.position[1] - 0.016, (k - 1.5) * 0.00254);
      wires.push({ points: [a, new Vector3(a.x + 0.006, headerTop + 0.004, a.z), new Vector3(hole.x - 0.01, hole.y + 0.004, hole.z), hole, new Vector3(hole.x + 0.002, hole.y - 0.012, hole.z * 0.6), pin], colour: palette[[0, 1, 2, 3][k]!]! });
    }
  });
  const modules = [...model.leds, ...model.buzzers, ...model.buttons];
  modules.forEach((module, i) => {
    for (let k = 0; k < 2; k++) {
      const a = new Vector3(back, headerTop, -0.012 + i * 0.006 + k * 0.00254);
      const b = new Vector3(module.position[0] + 0.0062 + 0.002 * (i === modules.length - 1 ? 1 : 0), module.position[1] + 0.004, module.position[2] + (k - 0.5) * 0.00254);
      wires.push({ points: wirePath(a, b, 0.006), colour: palette[k === 0 ? 0 : 1]! });
    }
  });
  if (wires.length === 0) return null;
  const parts = wires.map(({ points, colour }) => {
    const tube = new TubeGeometry(new CatmullRomCurve3(points, false, 'centripetal'), 24, 0.0006, 5, false);
    const c = new Color(colour);
    const rgb = new Float32Array(tube.getAttribute('position').count * 3);
    for (let i = 0; i < rgb.length; i += 3) [rgb[i], rgb[i + 1], rgb[i + 2]] = [c.r, c.g, c.b];
    tube.setAttribute('color', new Float32BufferAttribute(rgb, 3));
    return tube;
  });
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) return null;
  const material = new MeshStandardMaterial({ name: 'jumper-wire', vertexColors: true, roughness: 0.45, metalness: 0 });
  owned.geometries.push(geometry);
  owned.materials.push(material);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'wires';
  mesh.castShadow = true;
  return mesh;
}

/** The gripper's one material (parts/gripper.py `atlas_material`), whose glow map is the colour sensor's LED. */
const GRIPPER_MATERIAL = 'gripper_atlas';
/** The colour sensor's LED lit: its glow's strength through the carriage's emissive map (the atlas's LED cell). */
const COLOR_LED_INTENSITY = 2.4;
/** The lit LED's halo: a share of the view's height (about 24 px of a 497 px view at 40°: its soft edge leaves a glow of about 10), warm white. */
const COLOR_LED_HALO_SCREEN = 0.036;

/**
 * N19 E6: the gripper on `root`: the bracket (static: merged with the robot), its lower link and the boom turned about the pivot, the
 * carriage with the IR and colour modules on it merged into one mesh a material (its own material, whose glow is the colour LED), the
 * fingers at their hinges. A kit of other sizes than the reference's scales the boom and the fingers.
 */
function assembleGripper(
  g: GripperModel,
  root: Group,
  need: (name: string) => Object3D,
  owned: { geometries: BufferGeometry[]; materials: Material[] },
  options: AssemblyOptions,
  low: ReturnType<typeof lowTierMaterials> | null,
): GripperHandles {
  const ref = options.gripperReference ?? null;
  const along = ref ? g.boomLengthM / ref.boomLengthM : 1;
  const across = ref ? g.boomHalfSpanM / ref.boomHalfSpanM : 1;
  const moving = (node: Object3D) => {
    node.userData.moves = true;
    node.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = options.shadows;
        child.receiveShadow = options.shadows;
      }
    });
    return node;
  };
  const bracket = need('part_gripper_bracket');
  set(bracket, g.position);
  root.add(bracket);
  const link = bracket.getObjectByName('gripper_link') ?? null;
  if (link) {
    moving(link);
    link.scale.set(along, 1, across);
  }
  const boom = moving(need('part_gripper_boom'));
  set(boom, g.position);
  boom.scale.set(along, 1, across);
  root.add(boom);
  // The carriage and what rides on it, one mesh a material in the carriage's frame.
  const carriage = need('part_gripper_carriage');
  let ledAt: Vec3Tuple | null = null;
  for (const [rider, name] of [
    [g.ir, 'part_gripper_ir'],
    [g.color, 'part_gripper_color'],
  ] as const) {
    if (!rider) continue;
    const part = need(name);
    set(part, rider.position);
    carriage.add(part);
    const face = part.userData.led as readonly number[] | undefined;
    if (name === 'part_gripper_color' && face?.length === 3) ledAt = [rider.position[0] + face[0]!, rider.position[1] + face[1]!, rider.position[2] + face[2]!];
  }
  const merged = mergeStatic(carriage as Group, { castShadow: options.shadows, receiveShadow: options.shadows, plain: null });
  for (const mesh of merged) owned.geometries.push(mesh.geometry);
  for (const node of [...carriage.children]) if (!(node instanceof Mesh)) node.removeFromParent();
  let led: GlowMaterial | null = null;
  if (g.color) {
    // The atlas's material: its emissive map lights the LED's cell only (assets-src/robot3d/parts/gripper.py).
    const glowing = merged.find((mesh) => (mesh.material as Material).name === GRIPPER_MATERIAL);
    if (glowing) {
      const original = glowing.material as MeshStandardMaterial;
      led = low ? lambertOf(original) : original.clone();
      led.emissiveIntensity = 0;
      glowing.material = led;
      owned.materials.push(led);
    }
  }
  let ledHalo: Object3D | null = null;
  if (led && ledAt) {
    // Added to what is behind it, as light is: a white LED's glow reads on the pale board and on a white mat alike.
    const material = new SpriteMaterial({ name: 'color-led-halo', color: colors.colorLedLit, map: options.blob, transparent: true, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false });
    owned.materials.push(material);
    const halo = new Sprite(material);
    halo.name = 'color_led_halo';
    halo.scale.set(COLOR_LED_HALO_SCREEN, COLOR_LED_HALO_SCREEN, 1);
    set(halo, ledAt);
    halo.visible = false;
    // Compiled with the scene though hidden (Scene.tsx), as a line lamp's: its program is the zones' tags'.
    halo.userData.compileWithScene = true;
    carriage.add(halo);
    ledHalo = halo;
  }
  moving(carriage);
  root.add(carriage);
  const jaw = (name: string) => {
    const part = moving(need(name));
    if (ref) part.scale.set(g.finger.lengthM / ref.fingerLengthM, g.finger.heightM / ref.fingerHeightM, g.finger.thicknessM / ref.fingerThicknessM);
    root.add(part);
    return part;
  };
  return { model: g, boom, link, carriage, jawLeft: jaw('part_gripper_jaw_l'), jawRight: jaw('part_gripper_jaw_r'), led, ledHalo, pose: createGripperPose(), posedFor: { clawDeg: Number.NaN, liftDeg: Number.NaN, lit: null } };
}

/**
 * Builds the robot for `model` from the parts in `source`. Throws when a part the model needs is missing from the kit file (the caller
 * then draws the procedural robot).
 */
export function assembleRobot(model: RobotModel, reference: ReferenceSizes, source: PartSource, options: AssemblyOptions): AssembledRobot {
  const root = new Group();
  root.name = 'robot';
  const owned = { geometries: [] as BufferGeometry[], materials: [] as Material[] };
  const need = (name: string) => {
    const copy = cloneOf(source, name);
    if (!copy) throw new Error(`The robot kit file has no ${name}.`);
    return copy;
  };
  const handles: RobotHandles = { wheels: [], servos: [], leds: [], lineLamps: [], buzzers: [], buttons: [], boardLed: null, gripper: null };
  const lowCache = new Map<Material, Material>();
  const low = options.detail === 'low' ? lowTierMaterials(lowCache) : null;
  const { body } = model;
  const deck = body.bottomM + body.heightM;

  // The chassis: the reference body box stretched to the kit's, its plates kept at the kit's clearance and height.
  const chassis = need('part_chassis');
  const k = body.heightM / reference.body.heightM;
  chassis.scale.set(body.lengthM / reference.body.lengthM, k, body.widthM / reference.body.widthM);
  chassis.position.set(0, body.bottomM - reference.body.bottomM * k, 0);
  root.add(chassis);

  const board = boardPlacementOf(model, reference);
  const boardPart = need('part_board');
  boardPart.position.set(board.x, deck, board.z);
  root.add(boardPart);
  const led = ownMaterial(boardPart.getObjectByName('board_led_l'), owned.materials, low !== null);
  if (led && options.boardLedPin >= 0) {
    boardPart.getObjectByName('board_led_l')!.userData.moves = true;
    handles.boardLed = { pinIndex: options.boardLedPin, material: led };
  }

  for (const wheel of model.wheels) {
    const mirror = wheel.outward > 0 ? -1 : 1;
    const motor = need('part_tt_motor');
    set(motor, wheel.position);
    motor.position.z -= wheel.outward * ((wheel.widthM - reference.wheelWidthM) / 2);
    motor.scale.set(1, 1, mirror);
    root.add(motor);
    const part = need('part_wheel');
    set(part, wheel.position);
    const r = wheel.radiusM / reference.wheelRadiusM;
    part.scale.set(r, r, (wheel.widthM / reference.wheelWidthM) * mirror);
    const spin = part.getObjectByName('wheel_spin');
    if (!spin) throw new Error('The wheel has no wheel_spin.');
    spin.userData.moves = true;
    for (const node of spin.children) node.castShadow = options.shadows;
    root.add(part);
    handles.wheels.push({ role: wheel.role, spin });
  }

  if (model.caster) {
    const caster = need('part_caster');
    set(caster, model.caster.position);
    const s = model.caster.radiusM / reference.casterRadiusM;
    caster.scale.set(s, (body.bottomM - model.caster.position[1]) / reference.casterGapM, s);
    root.add(caster);
  }

  for (const sensor of model.ultrasonics) {
    const part = need('part_ultrasonic');
    set(part, sensor.position);
    part.rotation.y = sensor.yawRad;
    root.add(part);
  }

  if (model.lineSensors.length > 0) {
    const bar = need('part_line_bar');
    // Left to right: robot y down, three's z up.
    const eyes = [...model.lineSensors].sort((a, b) => a.position[2] - b.position[2]);
    const zs = eyes.map((eye) => eye.position[2]);
    const middle = (zs[0]! + zs[zs.length - 1]!) / 2;
    bar.position.set(eyes[0]!.position[0], eyes[0]!.position[1], middle);
    const spacing = eyes.length > 1 ? (zs[zs.length - 1]! - zs[0]!) / (eyes.length - 1) : reference.lineSpacingM;
    bar.scale.set(1, 1, spacing / reference.lineSpacingM);
    root.add(bar);
    // The bar's indicator board on the deck's front edge, its lamps in line with the eyes.
    const board = need('part_line_leds');
    board.position.set(body.lengthM / 2 - LINE_LEDS_INSET_M, deck, middle);
    board.scale.set(1, 1, spacing / reference.lineSpacingM);
    root.add(board);
    // What a dark eye lights: a red glow over its LED that keeps its size on the screen (it reads from the far free view as well as up
    // close), and a soft red spot on the mat under the eye. Both share the shader programs of what is always drawn (the zones' tags,
    // the contact shadow): a program first needed in the middle of a run would be compiled there, a hitch on a software renderer.
    const haloMaterial = new SpriteMaterial({ name: 'line-halo', color: colors.lineLampLit, map: options.blob, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: false });
    const spotMaterial = new MeshBasicMaterial({ name: 'line-spot', color: colors.lineSensorDark, alphaMap: options.blob, transparent: true, opacity: 0.75, depthWrite: false });
    const spotGeometry = new PlaneGeometry(LINE_SPOT_M, LINE_SPOT_M).rotateX(-Math.PI / 2);
    owned.materials.push(haloMaterial, spotMaterial);
    owned.geometries.push(spotGeometry);
    eyes.forEach((eye, i) => {
      const node = board.getObjectByName(`line_led_${i}`);
      const material = ownMaterial(node, owned.materials, low !== null);
      if (!node || !material) return;
      node.userData.moves = true;
      const glow = new Sprite(haloMaterial);
      glow.name = `line_halo_${i}`;
      glow.scale.set(LINE_HALO_SCREEN, LINE_HALO_SCREEN, 1);
      glow.position.y = 0.0028;
      glow.visible = false;
      glow.userData.moves = true;
      // Compiled with the scene though hidden (Scene.tsx): its program is needed the moment an eye sees dark.
      glow.userData.compileWithScene = true;
      node.add(glow);
      const spot = new Mesh(spotGeometry, spotMaterial);
      spot.name = `line_spot_${i}`;
      spot.position.set(eye.position[0], 0.0009, eye.position[2]);
      spot.renderOrder = 1;
      spot.visible = false;
      spot.userData.moves = true;
      root.add(spot);
      handles.lineLamps.push({ sensorIndex: eye.sensorIndex, material, glow, spot });
    });
  }

  for (const servo of model.servos) {
    const part = need('part_servo');
    set(part, servo.position);
    root.add(part);
    const horn = part.getObjectByName('servo_horn');
    if (!horn) throw new Error('The servo has no servo_horn.');
    horn.userData.moves = true;
    const arm = horn.getObjectByName('servo_arm');
    if (arm) arm.scale.x = servo.arm.lengthM / reference.armLengthM;
    const mast = horn.getObjectByName('flag_mast');
    const pennantNode = horn.getObjectByName('flag_pennant');
    let pennant: RobotHandles['servos'][number]['pennant'] = null;
    if (mast) {
      mast.position.x = servo.arm.lengthM - servo.arm.widthM / 2;
      mast.visible = options.flag?.role === servo.role;
      if (mast.visible && pennantNode) {
        const restDeg = 0;
        pennant = { node: pennantNode, low: Number(pennantNode.userData.low ?? 0.03), high: Number(pennantNode.userData.high ?? 0.08), fromDeg: restDeg, toDeg: options.flag!.upDeg };
      }
    }
    handles.servos.push({ role: servo.role, mountYawDeg: servo.mountYawDeg, horn, pennant });
  }

  for (const item of model.leds) {
    const part = need('part_led');
    set(part, item.position);
    root.add(part);
    const dome = part.getObjectByName('led_dome');
    const material = ownMaterial(dome, owned.materials, low !== null);
    if (!dome || !material) continue;
    dome.userData.moves = true;
    const halo = new Mesh(new SphereGeometry(0.0085, 16, 10), new MeshBasicMaterial({ color: colors.ledOn, transparent: true, opacity: 0.22, depthWrite: false }));
    owned.geometries.push(halo.geometry);
    owned.materials.push(halo.material);
    halo.position.y = 0.0075;
    halo.visible = false;
    halo.userData.moves = true;
    part.add(halo);
    let light: PointLight | null = null;
    if (options.detail === 'high') {
      // Always there, dark while the LED is off: switching a light on or off would recompile every lit material.
      light = new PointLight(colors.ledOn, 0, 0.3, 2);
      light.position.set(0, 0.011, 0);
      part.add(light);
    }
    handles.leds.push({ role: item.role, material, light, halo });
  }

  for (const item of model.buzzers) {
    const part = need('part_buzzer');
    set(part, item.position);
    root.add(part);
    const waves = new Group();
    waves.userData.moves = true;
    waves.visible = false;
    waves.position.y = 0.014;
    const wave = new MeshBasicMaterial({ color: colors.buzzerWave, transparent: true, opacity: 0.7, depthWrite: false, side: DoubleSide });
    owned.materials.push(wave);
    [0.009, 0.014].forEach((radius, ring) => {
      const geometry = new RingGeometry(radius - 0.0011, radius, 32);
      owned.geometries.push(geometry);
      const mesh = new Mesh(geometry, wave);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = ring * 0.003;
      waves.add(mesh);
    });
    part.add(waves);
    handles.buzzers.push({ pinIndex: item.pinIndex, waves });
  }

  for (const item of model.buttons) {
    const part = need('part_button');
    set(part, item.position);
    root.add(part);
    const cap = part.getObjectByName('button_cap');
    if (!cap) continue;
    cap.userData.moves = true;
    const travel = Number(cap.userData.travel ?? 0.0015);
    handles.buttons.push({ pinIndex: item.pinIndex, cap, up: cap.position.y, down: cap.position.y - travel });
  }

  const riser = ultrasonicRiser(model, reference);
  if (riser) {
    const part = source('part_ultrasonic_riser') ? need('part_ultrasonic_riser') : null;
    if (part) {
      const drop = Number(part.userData.drop ?? reference.ultrasonicHeightM - PLATE_M);
      const at = ultrasonicRiser(model, reference, drop)!;
      set(part, at.position);
      part.scale.y = at.heightM / Number(part.userData.height ?? at.heightM);
      root.add(part);
    }
  }

  if (model.gripper) handles.gripper = assembleGripper(model.gripper, root, need, owned, options, low);

  // The parts that never move, merged by material (on the low tier: every plain one into one vertex-coloured mesh, the rest Lambert).
  const merged = mergeStatic(root, { castShadow: options.shadows, receiveShadow: options.shadows, plain: low?.plain ?? null, ...(low ? { swap: low.swap } : {}) });
  for (const mesh of merged) owned.geometries.push(mesh.geometry);
  if (low) {
    const glows = new Set<Material>([...handles.leds.map((led) => led.material), ...handles.lineLamps.map((lamp) => lamp.material), ...(handles.boardLed ? [handles.boardLed.material] : [])]);
    bakeMovingPlain(root, low.plain, glows, owned.geometries);
    swapMaterials(root, low.swap);
    owned.materials.push(...lowCache.values());
  } else {
    const wires = buildWires(model, { x: board.x, deck }, owned);
    if (wires) root.add(wires);
  }
  for (const node of [...root.children]) if (node.children.length === 0 && !(node instanceof Mesh) && !(node instanceof PointLight)) node.removeFromParent();

  // The contact shadow under the robot.
  const blobGeometry = new PlaneGeometry(body.lengthM * 1.5, (body.widthM + 2 * (model.wheels[0]?.widthM ?? 0)) * 1.35);
  blobGeometry.rotateX(-Math.PI / 2);
  const blobMaterial = new MeshBasicMaterial({ color: '#000000', alphaMap: options.blob, transparent: true, opacity: options.shadows ? 0.32 : 0.55, depthWrite: false });
  const blob = new Mesh(blobGeometry, blobMaterial);
  blob.name = 'contact-shadow';
  blob.position.y = 0.0006;
  blob.renderOrder = -1;
  owned.geometries.push(blobGeometry);
  owned.materials.push(blobMaterial);
  root.add(blob);

  return {
    root,
    handles,
    dispose() {
      for (const geometry of owned.geometries) geometry.dispose();
      for (const material of owned.materials) material.dispose();
    },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A lit LED's light, candela: a red pool on the deck round it a few centimetres across (0.02 cd is 22 lux at 3 cm). */
const LED_LIGHT_CD = 0.02;

/** Shows `world` on the assembled robot: wheels, servo arms and the flag, LEDs, line lamps, buzzer waves, buttons, the board's L LED. */
/** N18 P2: the colours `applyRobotWorld` sets, each parsed once a page (three's Color.set parses a string every call: every LED, every frame). */
const parsedColours = new Map<string, Color>();
function colourOf(css: string): Color {
  let colour = parsedColours.get(css);
  if (!colour) parsedColours.set(css, (colour = new Color(css)));
  return colour;
}
const BOARD_LED_ON = '#ffb020';
const UNLIT = '#000000';

export function applyRobotWorld(handles: RobotHandles, world: RobotSnapshot, ledOn: string, ledOff: string): void {
  for (const wheel of handles.wheels) wheel.spin.rotation.z = wheelSpin(world.robot.wheelRad[wheel.role === 'motorRight' ? 1 : 0]);
  for (const servo of handles.servos) {
    const deg = world.robot.servoDeg[servo.role] ?? 0;
    servo.horn.rotation.y = servoArmYawRad(servo.mountYawDeg, deg);
    if (servo.pennant) {
      const { node, low, high, fromDeg, toDeg } = servo.pennant;
      const t = Math.min(1, Math.max(0, (deg - fromDeg) / Math.max(1e-6, toDeg - fromDeg)));
      node.position.y = lerp(low, high, t);
    }
  }
  for (const led of handles.leds) {
    const lit = world.leds[led.role] === true;
    led.material.emissive.copy(colourOf(lit ? ledOn : ledOff));
    led.material.emissiveIntensity = lit ? 3.2 : 0;
    led.halo.visible = lit;
    if (led.light) led.light.intensity = lit ? LED_LIGHT_CD : 0;
  }
  for (const lamp of handles.lineLamps) {
    const dark = lineSeesDark(world, lamp.sensorIndex);
    // A saturated red, not so bright that the tone mapping takes it towards white (pink); off, the lamp's own dark red.
    lamp.material.emissive.copy(colourOf(dark ? colors.lineLampLit : UNLIT));
    lamp.material.emissiveIntensity = dark ? 1.4 : 0;
    lamp.glow.visible = dark;
    lamp.spot.visible = dark;
  }
  for (const buzzer of handles.buzzers) buzzer.waves.visible = toneHzOf(world, buzzer.pinIndex) !== null;
  for (const button of handles.buttons) button.cap.position.y = buttonPressed(world, button.pinIndex) ? button.down : button.up;
  if (handles.boardLed) {
    const on = world.pins[handles.boardLed.pinIndex]?.level === 1 && world.pins[handles.boardLed.pinIndex]?.mode === 'OUTPUT';
    handles.boardLed.material.emissive.copy(colourOf(on ? BOARD_LED_ON : UNLIT));
    handles.boardLed.material.emissiveIntensity = on ? 2.5 : 0;
  }
  if (handles.gripper) poseGripper(handles.gripper, world);
}

/**
 * N19 E6: the gripper as robot.gripper says (gripper-pose.ts: the boom and its link turned, the carriage level at the tip, the fingers),
 * written into the nodes and the handles' pose: nothing is made a frame (fix round 1, review M1). N19 E9: and nothing is done when the claw
 * and the arm are where the last frame left them (`posedFor`), nor to the LED when it is as it was.
 */
export function poseGripper(gripper: GripperHandles, world: RobotSnapshot): void {
  const state = gripperStateOf(world);
  const posed = gripper.posedFor;
  if (state.clawDeg !== posed.clawDeg || state.liftDeg !== posed.liftDeg) {
    const { tip, jawLeft, jawRight, elevationRad, betaRad } = gripperPoseInto(gripper.pose, gripper.model, state);
    gripper.boom.rotation.z = elevationRad;
    if (gripper.link) gripper.link.rotation.z = elevationRad;
    gripper.carriage.position.set(tip[0], tip[1], tip[2]);
    gripper.jawLeft.position.set(jawLeft[0], jawLeft[1], jawLeft[2]);
    gripper.jawLeft.rotation.y = betaRad;
    gripper.jawRight.position.set(jawRight[0], jawRight[1], jawRight[2]);
    gripper.jawRight.rotation.y = 0 - betaRad;
    posed.clawDeg = state.clawDeg;
    posed.liftDeg = state.liftDeg;
  }
  const lit = colorLedLit(world);
  if (lit !== posed.lit) {
    if (gripper.led) gripper.led.emissiveIntensity = lit ? COLOR_LED_INTENSITY : 0;
    if (gripper.ledHalo) gripper.ledHalo.visible = lit;
    posed.lit = lit;
  }
}
