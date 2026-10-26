import type { BoardProfile } from '../../core/hardware/board';
import { kitPort, type Kit, type KitModule } from '../../core/hardware/kit';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { CM_PER_M } from '../../core/world/units';
import { robotPointToThree, type Vec3Tuple } from './scene-math';

// The robot the 3D view draws (N18 R4.2), built from the kit part by part: the chassis box, a wheel on each drive motor, the caster,
// each sensor, servo, LED, buzzer and button, each at its mount (the kit's robot frame, cm, drawn in m in the robot group's three.js
// frame: scene-math.ts). Nothing of the physics is drawn here that the kit does not say. What the parts show (a line sensor seeing dark,
// the buzzer's tone, the button held down) is read from the snapshot, by the indices worked out here once. N19 E6: the gripper (its
// pivot, boom, finger hinges and boxes, and the IR and colour sensors on its carriage), which gripper-pose.ts poses from the snapshot.

const m = (cm: number) => cm / CM_PER_M;
const num = (module: KitModule, key: string, fallback = 0): number => {
  const value = module.spec[key];
  return typeof value === 'number' ? value : fallback;
};

export type RobotModel = {
  body: { lengthM: number; widthM: number; heightM: number; bottomM: number };
  /** `outward`: the direction of the wheel's outer face along three's Z (the left wheel faces −Z). */
  wheels: { role: string; position: Vec3Tuple; radiusM: number; widthM: number; outward: 1 | -1 }[];
  caster: { position: Vec3Tuple; radiusM: number } | null;
  ultrasonics: { role: string; position: Vec3Tuple; yawRad: number }[];
  /** `sensorIndex`: the sensor's place among the snapshot's `sensors` (the kit's sensors in kit order). */
  lineSensors: { role: string; position: Vec3Tuple; sensorIndex: number }[];
  servos: { role: string; position: Vec3Tuple; mountYawDeg: number; arm: { lengthM: number; widthM: number; heightM: number } }[];
  leds: { role: string; position: Vec3Tuple }[];
  /** `pinIndex`: the module's pin among the snapshot's `pins` (the board's pins in order); -1 when it has none. */
  buzzers: { role: string; position: Vec3Tuple; pinIndex: number }[];
  buttons: { role: string; position: Vec3Tuple; pinIndex: number }[];
  /** N19 E6: the kit's gripper (a kit has one at most), or null. */
  gripper: GripperModel | null;
};

/**
 * N19 E6: a kit's gripper as the view draws it (kit.ts GripperSpec, m): the boom's pivot (the mount) in the robot group's frame, the
 * boom, the fingers' hinges in the carriage frame (u forward, v left, from the boom's tip) and the finger boxes; the angles that turn a
 * claw command into a finger angle; and the sensors that ride on the carriage, at their mounts in the carriage's three.js frame.
 */
export type GripperModel = {
  role: string;
  position: Vec3Tuple;
  boomLengthM: number;
  boomHalfSpanM: number;
  elevationAtLift0Deg: number;
  hinge: { uM: number; vM: number };
  finger: { lengthM: number; thicknessM: number; heightM: number };
  fingerOpenDeg: number;
  fingerDegPerServoDeg: number;
  jawsMeetDeg: number;
  ir: { role: string; position: Vec3Tuple; sensorIndex: number } | null;
  color: { role: string; position: Vec3Tuple; sensorIndex: number } | null;
  /** The claw servo's case on the carriage (GripperSpec `clawServo*`): its centre and size in the carriage's three.js frame, m. */
  clawServo: { center: Vec3Tuple; size: Vec3Tuple };
};

/** A placeholder chassis for a kit without one (the world needs one to run; the view still draws something sensible). */
const fallbackChassis = { bodyCm: [15, 12, 5] as const, clearanceCm: 1.5, casterCm: null, casterRadiusCm: 0 };

export function robotModel(kit: Kit, board: BoardProfile): RobotModel {
  const chassis = kit.chassis ?? fallbackChassis;
  const [length, width, height] = chassis.bodyCm;
  // N19 E6: the snapshot's sensors are the kit's sensors in kit order, the gripper's IR and colour sensors among them.
  const sensorKinds = new Set(['ultrasonic', 'line-sensor', 'ir-obstacle', 'color-sensor']);
  const sensorIndex = (module: KitModule) => kit.modules.filter((other) => sensorKinds.has(other.kind)).indexOf(module);
  const pinIndex = (module: KitModule) => {
    const pin = kitPort(kit, module.port)?.pins.PIN;
    return pin === undefined ? -1 : board.pins.findIndex((spec) => spec.id === pin);
  };
  const at = (module: KitModule) => robotPointToThree(module.mount.posCm);
  const of = (kind: KitModule['kind']) => kit.modules.filter((module) => module.kind === kind);
  return {
    body: { lengthM: m(length), widthM: m(width), heightM: m(height), bottomM: m(chassis.clearanceCm) },
    wheels: of('dc-motor').map((module) => ({
      role: module.role,
      position: at(module),
      radiusM: m(num(module, 'wheelRadiusCm', 3)),
      widthM: m(num(module, 'wheelWidthCm', 2)),
      outward: module.mount.posCm[1] >= 0 ? -1 : 1,
    })),
    caster: kit.chassis ? { position: robotPointToThree(kit.chassis.casterCm), radiusM: m(kit.chassis.casterRadiusCm) } : null,
    ultrasonics: of('ultrasonic').map((module) => ({ role: module.role, position: at(module), yawRad: (module.mount.yawDeg * Math.PI) / 180 })),
    lineSensors: of('line-sensor').map((module) => ({ role: module.role, position: at(module), sensorIndex: sensorIndex(module) })),
    servos: of('servo').map((module) => ({
      role: module.role,
      position: at(module),
      mountYawDeg: module.mount.yawDeg,
      arm: { lengthM: m(num(module, 'armLengthCm', 5)), widthM: m(num(module, 'armWidthCm', 0.8)), heightM: m(num(module, 'armHeightCm', 1)) },
    })),
    leds: of('led').map((module) => ({ role: module.role, position: at(module) })),
    buzzers: of('buzzer').map((module) => ({ role: module.role, position: at(module), pinIndex: pinIndex(module) })),
    buttons: of('button').map((module) => ({ role: module.role, position: at(module), pinIndex: pinIndex(module) })),
    gripper: gripperOf(kit, sensorIndex),
  };
}

function gripperOf(kit: Kit, sensorIndex: (module: KitModule) => number): GripperModel | null {
  const module = kit.modules.find((candidate) => candidate.kind === 'gripper');
  if (!module) return null;
  const rider = (kind: KitModule['kind']) => {
    const found = kit.modules.find((candidate) => candidate.kind === kind && candidate.mount.on === 'gripper');
    return found ? { role: found.role, position: robotPointToThree(found.mount.posCm), sensorIndex: sensorIndex(found) } : null;
  };
  return {
    role: module.role,
    position: robotPointToThree(module.mount.posCm),
    boomLengthM: m(num(module, 'boomLengthCm', 5)),
    boomHalfSpanM: m(num(module, 'boomHalfSpanCm', 6.6)),
    elevationAtLift0Deg: num(module, 'boomElevationAtLift0Deg', -40),
    hinge: { uM: m(num(module, 'fingerHingeUCm', 0.5)), vM: m(num(module, 'fingerHingeVCm', 2.2)) },
    finger: { lengthM: m(num(module, 'fingerLengthCm', 5)), thicknessM: m(num(module, 'fingerThicknessCm', 0.4)), heightM: m(num(module, 'jawHeightCm', 1.2)) },
    fingerOpenDeg: num(module, 'fingerOpenDeg', 12),
    fingerDegPerServoDeg: num(module, 'fingerDegPerServoDeg', 0.445),
    jawsMeetDeg: num(module, 'jawsMeetDeg', 80),
    ir: rider('ir-obstacle'),
    color: rider('color-sensor'),
    clawServo: {
      center: robotPointToThree([num(module, 'clawServoCenterUCm', -0.13), num(module, 'clawServoCenterVCm', 0), num(module, 'clawServoCenterWCm', 1.535)]),
      size: [m(num(module, 'clawServoSizeUCm', 1.22)), m(num(module, 'clawServoSizeWCm', 2.27)), m(num(module, 'clawServoSizeVCm', 2.28))],
    },
  };
}

/** Whether the line sensor at `sensorIndex` sees dark on this tick (false before a run, when the snapshot has no readouts). */
export function lineSeesDark(world: RobotSnapshot, sensorIndex: number): boolean {
  const readout = world.sensors[sensorIndex];
  return readout?.kind === 'line-sensor' && readout.dark;
}

/** The tone the board plays on the pin at `pinIndex`, Hz, or null. */
export function toneHzOf(world: RobotSnapshot, pinIndex: number): number | null {
  return world.pins[pinIndex]?.toneHz ?? null;
}

/** Whether the button on the pin at `pinIndex` is held: the kit wires it to GND, so its pin reads LOW while it is down. */
export function buttonPressed(world: RobotSnapshot, pinIndex: number): boolean {
  return world.pins[pinIndex]?.level === 0;
}
