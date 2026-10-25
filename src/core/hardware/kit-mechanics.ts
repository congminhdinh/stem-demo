import { z } from 'zod';
import { HardwareDataError, pathOf, type DataIssue } from './board-schema';
import { kitKey, type ChassisSpec, type Kit, type KitModule, type ModuleKind, type ModuleSpecs, type RobotRole } from './kit';

// The mechanical half of a kit (N18 R3.3): the chassis and each module's physical spec, which the world builds the robot from
// (src/core/world/robot). loadKit runs `mechanicsIssues` after the wiring rules, so a kit file with a missing motor constant,
// an unknown key or wheels that cannot rest on the floor is refused with the path of each problem, like a bad pin.
//
// Frame (kit.ts, `KitModule.mount`): chassis-centred, origin on the floor under the centre of the chassis body, x forward,
// y left, z up, cm and degrees. Every key is required: a vendor kit states every number, nothing falls back to a default.

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const positive = z.number().positive();
const pointCm = z.tuple([finite, finite, finite]);

/** The chassis (kit.ts, `ChassisSpec`). */
export const chassisSchema = z.strictObject({
  bodyCm: z.tuple([positive, positive, positive]),
  clearanceCm: z.number().min(0),
  massG: positive,
  comCm: pointCm,
  trackCm: positive,
  casterCm: pointCm,
  casterRadiusCm: positive,
  frictionWheel: positive,
}) satisfies z.ZodType<ChassisSpec>;

/** The spec of each module kind (kit.ts, `ModuleSpecs`). */
export const moduleSpecSchemas: { readonly [K in ModuleKind]: z.ZodType<ModuleSpecs[K]> } = {
  'dc-motor': z.strictObject({
    maxRpm: positive,
    tauS: z.number().min(0),
    stallTorqueNm: positive,
    gearFrictionNm: z.number().min(0),
    wheelRadiusCm: positive,
    wheelWidthCm: positive,
  }),
  servo: z.strictObject({
    sPer60Deg: positive,
    minDeg: finite,
    maxDeg: finite,
    restDeg: finite,
    stallTorqueNm: positive,
    armLengthCm: positive,
    armWidthCm: positive,
    armHeightCm: positive,
    armMassG: positive,
  }),
  ultrasonic: z.strictObject({ coneHalfDeg: z.number().positive().lt(90), minCm: z.number().min(0), maxCm: positive }),
  'line-sensor': z.strictObject({ heightCm: positive, spotRadiusCm: positive, darkBelow: z.number().gt(0).max(1) }),
  led: z.strictObject({}),
  buzzer: z.strictObject({}),
  button: z.strictObject({}),
};

/** A kit module of one kind, its spec typed. */
export type KitMechanicalModule<K extends ModuleKind> = Omit<KitModule, 'kind' | 'spec'> & { readonly kind: K; readonly spec: ModuleSpecs[K] };

/** What the world needs to build a drivable robot: the chassis, the two drive motors and every servo, in kit order. */
export type RobotMechanics = {
  readonly chassis: ChassisSpec;
  readonly motorLeft: KitMechanicalModule<'dc-motor'>;
  readonly motorRight: KitMechanicalModule<'dc-motor'>;
  readonly servos: readonly KitMechanicalModule<'servo'>[];
};

/** Lengths authored as decimals compare equal when they agree to a billionth of a centimetre. */
const SAME_CM = 1e-9;
const same = (a: number, b: number) => Math.abs(a - b) <= SAME_CM;

/**
 * Every mechanical problem of a kit, each with its path: the spec of each module against its kind, the rules a module's
 * spec and mount must keep, and, when the kit has a chassis, the drive geometry (two motors on one axle `trackCm` apart,
 * wheels and caster resting on the floor, the centre of mass inside the support so the robot stands).
 */
export function mechanicsIssues(kit: Kit): DataIssue[] {
  const issues: DataIssue[] = [];
  const add = (path: readonly PropertyKey[], message: string) => issues.push({ path: pathOf(path), message });
  let specsValid = true;
  kit.modules.forEach((module, index) => {
    const parsed = moduleSpecSchemas[module.kind].safeParse(module.spec);
    if (!parsed.success) {
      specsValid = false;
      for (const issue of parsed.error.issues) add(['modules', index, 'spec', ...issue.path], issue.message);
    }
  });
  if (!specsValid) {
    return issues;
  }

  kit.modules.forEach((module, index) => {
    const at = (...path: PropertyKey[]) => ['modules', index, ...path];
    const [, , z] = module.mount.posCm;
    if (module.kind === 'dc-motor') {
      const spec = module.spec as unknown as ModuleSpecs['dc-motor'];
      if (module.mount.yawDeg !== 0) add(at('mount', 'yawDeg'), 'a wheel rolls along x: yawDeg is 0');
      if (spec.gearFrictionNm >= spec.stallTorqueNm) {
        add(at('spec', 'gearFrictionNm'), `the gearbox friction is less than the stall torque (${spec.stallTorqueNm}), or the motor never turns`);
      }
      if (!same(z, spec.wheelRadiusCm)) {
        add(at('mount', 'posCm', 2), `a wheel rests on the floor: its centre is wheelRadiusCm = ${spec.wheelRadiusCm} above it, not ${z}`);
      }
    } else if (module.kind === 'line-sensor') {
      const spec = module.spec as unknown as ModuleSpecs['line-sensor'];
      if (!same(z, spec.heightCm)) {
        add(at('spec', 'heightCm'), `the sensor is mounted ${z} cm above the floor (mount.posCm[2]), not ${spec.heightCm}`);
      }
    } else if (module.kind === 'ultrasonic') {
      const spec = module.spec as unknown as ModuleSpecs['ultrasonic'];
      if (spec.maxCm <= spec.minCm) add(at('spec', 'maxCm'), `maxCm is more than minCm (${spec.minCm})`);
    } else if (module.kind === 'servo') {
      const spec = module.spec as unknown as ModuleSpecs['servo'];
      if (spec.maxDeg <= spec.minDeg) {
        add(at('spec', 'maxDeg'), `maxDeg is more than minDeg (${spec.minDeg})`);
      } else if (spec.maxDeg - spec.minDeg >= 360) {
        add(at('spec', 'maxDeg'), 'a servo turns less than a full circle: maxDeg − minDeg is under 360');
      } else if (spec.restDeg < spec.minDeg || spec.restDeg > spec.maxDeg) {
        add(at('spec', 'restDeg'), `restDeg is within minDeg..maxDeg (${spec.minDeg}..${spec.maxDeg})`);
      }
      if (z - spec.armHeightCm / 2 <= 0) {
        add(at('mount', 'posCm', 2), `the arm (${spec.armHeightCm} cm high, centred on the mount) clears the floor: z is more than ${spec.armHeightCm / 2}`);
      }
    }
  });

  if (kit.chassis !== undefined) {
    issues.push(...chassisIssues(kit, kit.chassis));
  }
  return issues;
}

function chassisIssues(kit: Kit, chassis: ChassisSpec): DataIssue[] {
  const issues: DataIssue[] = [];
  const add = (path: readonly PropertyKey[], message: string) => issues.push({ path: pathOf(path), message });
  const indexOfMotor = (role: RobotRole) => kit.modules.findIndex((module) => module.role === role && module.kind === 'dc-motor');
  const left = indexOfMotor('motorLeft');
  const right = indexOfMotor('motorRight');
  const missing = [left < 0 ? 'motorLeft' : null, right < 0 ? 'motorRight' : null].filter((role) => role !== null);
  if (missing.length > 0) {
    add(['modules'], `a kit with a chassis drives on motorLeft and motorRight; it has no ${missing.join(' and no ')}`);
    return issues;
  }
  const half = chassis.trackCm / 2;
  const [xLeft, yLeft] = kit.modules[left]!.mount.posCm;
  const [xRight, yRight] = kit.modules[right]!.mount.posCm;
  if (!same(yLeft, half)) add(['modules', left, 'mount', 'posCm', 1], `the left wheel is at y = ${half} (trackCm / 2, left is +y), not ${yLeft}`);
  if (!same(yRight, -half)) add(['modules', right, 'mount', 'posCm', 1], `the right wheel is at y = ${-half} (−trackCm / 2), not ${yRight}`);
  if (!same(xRight, xLeft)) add(['modules', right, 'mount', 'posCm', 0], `the wheels share one axle: x = ${xLeft} as for motorLeft, not ${xRight}`);

  const [casterX, , casterZ] = chassis.casterCm;
  if (!same(casterZ, chassis.casterRadiusCm)) {
    add(['chassis', 'casterCm', 2], `the caster rests on the floor: its centre is casterRadiusCm = ${chassis.casterRadiusCm} above it, not ${casterZ}`);
  }
  const [comX, comY, comZ] = chassis.comCm;
  if (!(Math.min(xLeft, casterX) < comX && comX < Math.max(xLeft, casterX))) {
    add(['chassis', 'comCm', 0], `the centre of mass is between the axle (x = ${xLeft}) and the caster (x = ${casterX}), or the robot tips over`);
  }
  if (!(Math.abs(comY) < half)) add(['chassis', 'comCm', 1], `the centre of mass is between the wheels (|y| < ${half})`);
  if (!(comZ > 0)) add(['chassis', 'comCm', 2], 'the centre of mass is above the floor (z > 0)');

  const armsG = kit.modules.reduce((sum, module) => sum + (module.kind === 'servo' ? (module.spec as unknown as ModuleSpecs['servo']).armMassG : 0), 0);
  if (!(chassis.massG > armsG)) add(['chassis', 'massG'], `the whole robot (${chassis.massG} g) weighs more than its servo arms (${armsG} g)`);
  return issues;
}

function throwIfInvalid(kit: Kit, issues: readonly DataIssue[]): void {
  if (issues.length > 0) {
    throw new HardwareDataError(`Kit "${kitKey(kit)}"`, issues);
  }
}

/** The kit's modules of one kind, in kit order, with typed specs. Throws a HardwareDataError when the kit's mechanics are invalid. */
export function modulesOfKind<K extends ModuleKind>(kit: Kit, kind: K): KitMechanicalModule<K>[] {
  throwIfInvalid(kit, mechanicsIssues(kit));
  return kit.modules.filter((module) => module.kind === kind) as unknown as KitMechanicalModule<K>[];
}

/** The chassis, the drive motors and the servos of a kit, typed. Throws a HardwareDataError naming each path when the kit has no chassis or invalid mechanics. */
export function robotMechanics(kit: Kit): RobotMechanics {
  if (kit.chassis === undefined) {
    throw new HardwareDataError(`Kit "${kitKey(kit)}"`, [{ path: 'chassis', message: 'the world needs the chassis to build the robot' }]);
  }
  throwIfInvalid(kit, mechanicsIssues(kit));
  const motors = kit.modules.filter((module) => module.kind === 'dc-motor') as unknown as KitMechanicalModule<'dc-motor'>[];
  return {
    chassis: kit.chassis,
    motorLeft: motors.find((module) => module.role === 'motorLeft')!,
    motorRight: motors.find((module) => module.role === 'motorRight')!,
    servos: kit.modules.filter((module) => module.kind === 'servo') as unknown as KitMechanicalModule<'servo'>[],
  };
}
