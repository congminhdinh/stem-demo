import { describe, expect, it } from 'vitest';
import { loadBoard } from './board-schema';
import type { Kit } from './kit';
import { mechanicsIssues, modulesOfKind, robotMechanics } from './kit-mechanics';
import { loadKit } from './kit-schema';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';
import unoR3Json from './uno-r3.board.json';

// N18 R3.3: the mechanical half of a kit, what the world builds the robot from. The robot frame is chassis-centred: origin on
// the floor under the centre of the chassis body, x forward, y left, z up, in cm and degrees.

const board = loadBoard(unoR3Json);
const kit = loadKit(refUnoRoverJson, board);

type RawModule = { role: string; kind: string; port: string; mount: { posCm: number[]; yawDeg: number }; spec: Record<string, unknown> };
type RawKit = { chassis?: Record<string, unknown>; modules: RawModule[] };

/** A copy of the reference kit's JSON to break. */
const raw = (): RawKit => structuredClone(refUnoRoverJson) as unknown as RawKit;
const moduleOf = (kit: RawKit, role: string): RawModule => {
  const found = kit.modules.find((module) => module.role === role);
  if (!found) throw new Error(`no ${role}`);
  return found;
};
const indexOf = (role: string) => kit.modules.findIndex((module) => module.role === role);

function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Nothing was thrown');
}

describe('ref-uno-rover@0 mechanics (PLACEHOLDER values until the vendor measures the kit)', () => {
  it('has a 15 × 12 × 5 cm, 400 g chassis on a 15 cm track with a front ball caster', () => {
    expect(kit.chassis).toEqual({
      bodyCm: [15, 12, 5],
      clearanceCm: 1.5,
      massG: 400,
      comCm: [-0.5, 0, 3.5],
      trackCm: 15,
      casterCm: [5.5, 0, 0.75],
      casterRadiusCm: 0.75,
      frictionWheel: 1,
    });
  });

  it('drives 6.6 cm wheels with 200 rpm gear motors, the left wheel at +y', () => {
    const [left, right] = [kit.modules[indexOf('motorLeft')], kit.modules[indexOf('motorRight')]];
    const motorSpec = { maxRpm: 200, tauS: 0.05, stallTorqueNm: 0.08, gearFrictionNm: 0.025, wheelRadiusCm: 3.3, wheelWidthCm: 2.6 };
    expect(left).toMatchObject({ mount: { posCm: [-2, 7.5, 3.3], yawDeg: 0 }, spec: motorSpec });
    expect(right).toMatchObject({ mount: { posCm: [-2, -7.5, 3.3], yawDeg: 0 }, spec: motorSpec });
  });

  it('gives every module kind its spec', () => {
    const specOf = (role: string) => kit.modules[indexOf(role)]?.spec;
    expect(specOf('ultrasonic')).toEqual({ coneHalfDeg: 15, minCm: 2, maxCm: 400 });
    for (const role of ['lineLeft', 'lineCenter', 'lineRight']) {
      expect(specOf(role)).toEqual({ heightCm: 1, spotRadiusCm: 0.3, darkBelow: 0.5 });
    }
    expect(specOf('servo1')).toEqual({
      sPer60Deg: 0.1,
      minDeg: 0,
      maxDeg: 180,
      restDeg: 90,
      stallTorqueNm: 0.18,
      armLengthCm: 6,
      armWidthCm: 0.8,
      armHeightCm: 1.5,
      armMassG: 5,
    });
    for (const role of ['led1', 'buzzer', 'button1']) {
      expect(specOf(role)).toEqual({});
    }
  });

  it('mounts the sensors in the robot frame: the ultrasonic on the front face, the line sensors 1 cm above the floor', () => {
    const mountOf = (role: string) => kit.modules[indexOf(role)]?.mount;
    expect(mountOf('ultrasonic')).toEqual({ posCm: [7.5, 0, 4], yawDeg: 0 });
    expect([mountOf('lineLeft'), mountOf('lineCenter'), mountOf('lineRight')]).toEqual([
      { posCm: [7, 1.5, 1], yawDeg: 0 },
      { posCm: [7, 0, 1], yawDeg: 0 },
      { posCm: [7, -1.5, 1], yawDeg: 0 },
    ]);
    expect(mountOf('servo1')).toEqual({ posCm: [4.5, 0, 7], yawDeg: -90 });
  });

  it('is a drivable robot: robotMechanics names its two motors and its servo with typed specs', () => {
    const mechanics = robotMechanics(kit);
    expect(mechanics.chassis.trackCm).toBe(15);
    expect([mechanics.motorLeft.role, mechanics.motorRight.role]).toEqual(['motorLeft', 'motorRight']);
    expect(mechanics.motorLeft.spec.maxRpm).toBe(200);
    expect(mechanics.servos.map((servo) => [servo.role, servo.spec.sPer60Deg])).toEqual([['servo1', 0.1]]);
    expect(modulesOfKind(kit, 'line-sensor').map((module) => module.spec.heightCm)).toEqual([1, 1, 1]);
    expect(mechanicsIssues(kit)).toEqual([]);
  });
});

describe('loadKit refuses mechanics that do not fit, naming the path', () => {
  it('refuses a module spec with a missing, unknown or out-of-range key, per kind', () => {
    const missing = raw();
    delete moduleOf(missing, 'motorLeft').spec.maxRpm;
    expect(thrown(() => loadKit(missing, board))).toMatch(/modules\.0\.spec\.maxRpm: /);
    const unknown = raw();
    moduleOf(unknown, 'led1').spec.colour = 'red';
    expect(thrown(() => loadKit(unknown, board))).toMatch(new RegExp(`modules\\.${indexOf('led1')}\\.spec: Unrecognized key: "colour"`));
    const negative = raw();
    moduleOf(negative, 'motorRight').spec.wheelRadiusCm = 0;
    expect(thrown(() => loadKit(negative, board))).toMatch(/modules\.1\.spec\.wheelRadiusCm: Too small/);
    const cone = raw();
    moduleOf(cone, 'ultrasonic').spec.coneHalfDeg = 90;
    expect(thrown(() => loadKit(cone, board))).toMatch(/modules\.2\.spec\.coneHalfDeg: Too big/);
    const text = raw();
    moduleOf(text, 'servo1').spec.sPer60Deg = 'fast';
    expect(thrown(() => loadKit(text, board))).toMatch(new RegExp(`modules\\.${indexOf('servo1')}\\.spec\\.sPer60Deg: `));
  });

  it('refuses a chassis with a missing or unknown key', () => {
    const missing = raw();
    delete missing.chassis?.trackCm;
    expect(thrown(() => loadKit(missing, board))).toMatch(/chassis\.trackCm: /);
    const unknown = raw();
    Object.assign(unknown.chassis ?? {}, { bodyLengthCm: 15 });
    expect(thrown(() => loadKit(unknown, board))).toMatch(/chassis: Unrecognized key: "bodyLengthCm"/);
    const flat = raw();
    Object.assign(flat.chassis ?? {}, { bodyCm: [15, 12] });
    expect(thrown(() => loadKit(flat, board))).toMatch(/chassis\.bodyCm: /);
  });

  it('refuses wheels that are not on one axle, trackCm apart, resting on the floor and rolling forward', () => {
    const offTrack = raw();
    moduleOf(offTrack, 'motorLeft').mount.posCm = [-2, 7, 3.3];
    expect(thrown(() => loadKit(offTrack, board))).toMatch(/modules\.0\.mount\.posCm\.1: the left wheel is at y = 7\.5 \(trackCm \/ 2, left is \+y\), not 7/);
    const mirrored = raw();
    moduleOf(mirrored, 'motorLeft').mount.posCm = [-2, -7.5, 3.3];
    moduleOf(mirrored, 'motorRight').mount.posCm = [-2, 7.5, 3.3];
    const mirroredMessage = thrown(() => loadKit(mirrored, board));
    expect(mirroredMessage).toMatch(/modules\.0\.mount\.posCm\.1: the left wheel is at y = 7\.5/);
    expect(mirroredMessage).toMatch(/modules\.1\.mount\.posCm\.1: the right wheel is at y = -7\.5/);
    const skewed = raw();
    moduleOf(skewed, 'motorRight').mount.posCm = [-1, -7.5, 3.3];
    expect(thrown(() => loadKit(skewed, board))).toMatch(/modules\.1\.mount\.posCm\.0: the wheels share one axle: x = -2 as for motorLeft, not -1/);
    const floating = raw();
    moduleOf(floating, 'motorRight').mount.posCm = [-2, -7.5, 4];
    expect(thrown(() => loadKit(floating, board))).toMatch(/modules\.1\.mount\.posCm\.2: a wheel rests on the floor: its centre is wheelRadiusCm = 3\.3 above it, not 4/);
    const turned = raw();
    moduleOf(turned, 'motorLeft').mount.yawDeg = 10;
    expect(thrown(() => loadKit(turned, board))).toMatch(/modules\.0\.mount\.yawDeg: a wheel rolls along x: yawDeg is 0/);
  });

  it('refuses a gearbox whose friction the motor cannot overcome', () => {
    const stuck = raw();
    moduleOf(stuck, 'motorRight').spec.gearFrictionNm = 0.08;
    expect(thrown(() => loadKit(stuck, board))).toMatch(
      /modules\.1\.spec\.gearFrictionNm: the gearbox friction is less than the stall torque \(0\.08\), or the motor never turns/,
    );
    const missing = raw();
    delete moduleOf(missing, 'motorLeft').spec.gearFrictionNm;
    expect(thrown(() => loadKit(missing, board))).toMatch(/modules\.0\.spec\.gearFrictionNm: /);
  });

  it('refuses a robot that would tip over or float: centre of mass outside the wheels and caster, caster off the floor', () => {
    const tail = raw();
    Object.assign(tail.chassis ?? {}, { comCm: [-3, 0, 3.5] });
    expect(thrown(() => loadKit(tail, board))).toMatch(/chassis\.comCm\.0: the centre of mass is between the axle \(x = -2\) and the caster \(x = 5\.5\), or the robot tips over/);
    const side = raw();
    Object.assign(side.chassis ?? {}, { comCm: [0, 8, 3.5] });
    expect(thrown(() => loadKit(side, board))).toMatch(/chassis\.comCm\.1: the centre of mass is between the wheels \(\|y\| < 7\.5\)/);
    const buried = raw();
    Object.assign(buried.chassis ?? {}, { comCm: [0, 0, 0] });
    expect(thrown(() => loadKit(buried, board))).toMatch(/chassis\.comCm\.2: the centre of mass is above the floor/);
    const caster = raw();
    Object.assign(caster.chassis ?? {}, { casterCm: [5.5, 0, 1] });
    expect(thrown(() => loadKit(caster, board))).toMatch(/chassis\.casterCm\.2: the caster rests on the floor: its centre is casterRadiusCm = 0\.75 above it, not 1/);
    const light = raw();
    Object.assign(light.chassis ?? {}, { massG: 5 });
    expect(thrown(() => loadKit(light, board))).toMatch(/chassis\.massG: the whole robot \(5 g\) weighs more than its servo arms \(5 g\)/);
  });

  it('refuses a chassis without both drive motors', () => {
    const oneMotor = raw();
    oneMotor.modules = oneMotor.modules.filter((module) => module.role !== 'motorRight');
    expect(thrown(() => loadKit(oneMotor, board))).toMatch(/modules: a kit with a chassis drives on motorLeft and motorRight; it has no motorRight/);
  });

  it('refuses sensor and servo specs that contradict themselves or the mount', () => {
    const line = raw();
    moduleOf(line, 'lineCenter').spec.heightCm = 1.5;
    expect(thrown(() => loadKit(line, board))).toMatch(
      new RegExp(`modules\\.${indexOf('lineCenter')}\\.spec\\.heightCm: the sensor is mounted 1 cm above the floor \\(mount\\.posCm\\[2\\]\\), not 1\\.5`),
    );
    const sonar = raw();
    moduleOf(sonar, 'ultrasonic').spec.minCm = 400;
    expect(thrown(() => loadKit(sonar, board))).toMatch(/modules\.2\.spec\.maxCm: maxCm is more than minCm \(400\)/);
    const at = indexOf('servo1');
    const range = raw();
    moduleOf(range, 'servo1').spec.minDeg = 180;
    expect(thrown(() => loadKit(range, board))).toMatch(new RegExp(`modules\\.${at}\\.spec\\.maxDeg: maxDeg is more than minDeg \\(180\\)`));
    const rest = raw();
    moduleOf(rest, 'servo1').spec.restDeg = 200;
    expect(thrown(() => loadKit(rest, board))).toMatch(new RegExp(`modules\\.${at}\\.spec\\.restDeg: restDeg is within minDeg\\.\\.maxDeg \\(0\\.\\.180\\)`));
    const wide = raw();
    moduleOf(wide, 'servo1').spec.maxDeg = 360;
    expect(thrown(() => loadKit(wide, board))).toMatch(new RegExp(`modules\\.${at}\\.spec\\.maxDeg: a servo turns less than a full circle`));
    const low = raw();
    moduleOf(low, 'servo1').mount.posCm = [4.5, 0, 0.5];
    expect(thrown(() => loadKit(low, board))).toMatch(new RegExp(`modules\\.${at}\\.mount\\.posCm\\.2: the arm \\(1\\.5 cm high, centred on the mount\\) clears the floor`));
  });
});

describe('robotMechanics', () => {
  it('needs a chassis to build a robot', () => {
    const { chassis: _chassis, ...bare } = kit;
    void _chassis;
    expect(thrown(() => robotMechanics(bare as Kit))).toMatch(/Kit "ref-uno-rover@0" is not valid:\n {2}chassis: the world needs the chassis to build the robot/);
  });

  it('refuses a hand-built kit whose mechanics are invalid, with the same paths as loadKit', () => {
    const broken: Kit = { ...kit, modules: kit.modules.map((module) => (module.role === 'motorLeft' ? { ...module, spec: {} } : module)) };
    expect(thrown(() => robotMechanics(broken))).toMatch(/modules\.0\.spec\.maxRpm: /);
  });
});
