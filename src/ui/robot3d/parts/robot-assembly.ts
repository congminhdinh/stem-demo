import {
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
import { buttonPressed, lineSeesDark, toneHzOf, type RobotModel } from '../robot-model';
import { servoArmYawRad, wheelSpin, type Vec3Tuple } from '../scene-math';
import { bakeMovingPlain, lambertOf, lowTierMaterials, mergeStatic, swapMaterials } from './merge';

// The robot of the 3D view built from the modelled parts (N18 R4.7): each part of robot-kit.glb (assets-src/robot3d/parts/) cloned,
// put at its kit mount (RobotModel, the same numbers the physics builds the robot from) and scaled from the kit's spec where it differs
// from the reference kit the parts are modelled to: the chassis to the body box, a wheel to its radius and width, the caster to its
// ball, the servo's arm to its length, the line bar to its eyes' spacing. The parts that never move are merged into one mesh per
// material; what moves or lights up keeps its node, found by name, and `applyRobotWorld` drives it from the snapshot every frame:
// `wheel_spin`, `servo_horn` with the flag's `flag_pennant`, `led_dome`, `line_led_<i>`, `button_cap`, `board_led_l`.

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
};

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
  };
}

/** The controller board's size (m): its short side along x, its long side across; and the gap it keeps from a servo arm. */
export const BOARD_M = { short: 0.0533, long: 0.0686, clearance: 0.0012 } as const;

/** Where the board sits on the deck: as far forward as the servo arms let it, inside the deck (three's x, z of its middle). */
export function boardPlacement(model: RobotModel): { x: number; z: number } {
  const half = model.body.lengthM / 2;
  const fronts = model.servos.map((servo) => servo.position[0] - servo.arm.widthM / 2 - BOARD_M.clearance);
  const front = Math.min(half - 0.003, ...fronts);
  return { x: Math.max(-half + BOARD_M.short / 2, front - BOARD_M.short / 2), z: 0 };
}

/** A material whose glow the robot view sets: the high tier's standard one, or the low tier's Lambert copy. */
export type GlowMaterial = MeshStandardMaterial | MeshLambertMaterial;

export type RobotHandles = {
  wheels: { role: string; spin: Object3D }[];
  servos: { role: string; mountYawDeg: number; horn: Object3D; pennant: { node: Object3D; low: number; high: number; fromDeg: number; toDeg: number } | null }[];
  leds: { role: string; material: GlowMaterial; light: PointLight | null; halo: Object3D }[];
  lineLamps: { sensorIndex: number; material: GlowMaterial; glow: Object3D }[];
  buzzers: { pinIndex: number; waves: Object3D }[];
  buttons: { pinIndex: number; cap: Object3D; up: number; down: number }[];
  boardLed: { pinIndex: number; material: GlowMaterial } | null;
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
  const handles: RobotHandles = { wheels: [], servos: [], leds: [], lineLamps: [], buzzers: [], buttons: [], boardLed: null };
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

  const board = boardPlacement(model);
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
    eyes.forEach((eye, i) => {
      const node = bar.getObjectByName(`line_led_${i}`);
      const material = ownMaterial(node, owned.materials, low !== null);
      if (!node || !material) return;
      node.userData.moves = true;
      const glow = new Mesh(new SphereGeometry(0.0035, 12, 8), new MeshBasicMaterial({ color: colors.lineSensorDark, transparent: true, opacity: 0.45, depthWrite: false }));
      owned.geometries.push(glow.geometry);
      owned.materials.push(glow.material);
      glow.visible = false;
      glow.userData.moves = true;
      node.add(glow);
      handles.lineLamps.push({ sensorIndex: eye.sensorIndex, material, glow });
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

/** Shows `world` on the assembled robot: wheels, servo arms and the flag, LEDs, line lamps, buzzer waves, buttons, the board's L LED. */
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
    led.material.emissive.set(lit ? ledOn : ledOff);
    led.material.emissiveIntensity = lit ? 3.2 : 0;
    led.halo.visible = lit;
    if (led.light) led.light.intensity = lit ? 0.004 : 0;
  }
  for (const lamp of handles.lineLamps) {
    const dark = lineSeesDark(world, lamp.sensorIndex);
    lamp.material.emissive.set(dark ? colors.lineSensorDark : '#000000');
    lamp.material.emissiveIntensity = dark ? 3 : 0;
    lamp.glow.visible = dark;
  }
  for (const buzzer of handles.buzzers) buzzer.waves.visible = toneHzOf(world, buzzer.pinIndex) !== null;
  for (const button of handles.buttons) button.cap.position.y = buttonPressed(world, button.pinIndex) ? button.down : button.up;
  if (handles.boardLed) {
    const on = world.pins[handles.boardLed.pinIndex]?.level === 1 && world.pins[handles.boardLed.pinIndex]?.mode === 'OUTPUT';
    handles.boardLed.material.emissive.set(on ? '#ffb020' : '#000000');
    handles.boardLed.material.emissiveIntensity = on ? 2.5 : 0;
  }
}
