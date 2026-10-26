import { beforeAll, describe, expect, it } from 'vitest';
import type { UltrasonicSpec } from '../../hardware/kit';
import { gripperKit, gripperScene, run, seconds, wait, type GripperScene } from '../__fixtures__/gripper-scene';
import { getRapier, initPhysics, type Collider } from '../rapier';
import { localToWorld, multiplyQuaternions, robotPointToLocal } from '../robot/robot-frame';
import { rotateVector, yawToQuaternion } from '../units';
import type { ColliderLookup, SensedCollider } from './collider-lookup';
import { measureUltrasonic, ultrasonicRayDirections } from './ultrasonic';

// N19 B5 (ruling E67 I4: visual = collider): the claw servo's case on the carriage is a collider, and the gripper car's HC-SR04 hears it as
// it hears the jaws and the carriage (world.ts: its ultrasonic leaves out the chassis only). Raised in front of the sensor, a real servo
// blocks it (cf. LEGO SPIKE's "the arm blocks the distance sensor"): which lift angles do, part by part, for D4's lesson solutions (they
// read the distance at lift 0° or 90°). Each part of the gripper is named on its own here, which world.ts's lookup does not do (`#gripper`).

beforeAll(() => initPhysics(), 30_000);

const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
const ultrasonic = gripperKit.modules.find((module) => module.kind === 'ultrasonic')!;
const spec = ultrasonic.spec as unknown as UltrasonicSpec;
/** A wall whose face is 60 cm past the ultrasonic (mount x 7.5): out of reach of every part of the gripper. */
const WALL_FACE_X = START.xCm + 7.5 + 60;

type Part = 'boom' | 'carriage' | 'claw servo' | 'finger';

/** The arena's colliders as the arena names them, and each part of the gripper under its own name. */
function partLookup(scene: GripperScene): ColliderLookup<SensedCollider> {
  const { gripper } = scene;
  const part = (collider: Collider): Part | null => {
    const parent = collider.parent()?.handle;
    if (parent === gripper.boom.handle) return 'boom';
    if (parent === gripper.carriage.handle) return collider.handle === gripper.carriage.collider(1).handle ? 'claw servo' : 'carriage';
    if (gripper.fingers.some((finger) => finger.body.handle === parent)) return 'finger';
    return null;
  };
  return {
    infoOf(collider) {
      const info = scene.arena.infoOf(collider);
      if (info !== undefined) return info;
      const name = part(collider);
      return name === null ? undefined : { id: name, tags: [], ultrasonic: true };
    },
  };
}

/** Where the ultrasonic is now: its mount on the chassis. */
function sensorPose(scene: GripperScene) {
  const position = scene.robot.chassis.translation();
  const rotation = scene.robot.chassis.rotation();
  return {
    position: localToWorld(position, rotation, robotPointToLocal(ultrasonic.mount.posCm)),
    rotation: multiplyQuaternions(rotation, yawToQuaternion(0)),
  };
}

/** What the ultrasonic hears now, its gripper's parts named, and how far, cm. The chassis is left out, as world.ts does. */
function heard(scene: GripperScene): { id: string; cm: number } {
  const exclude = (collider: Collider) => scene.robot.ownsCollider(collider) && !scene.gripper.ownsCollider(collider);
  const reading = measureUltrasonic(scene.world, partLookup(scene), sensorPose(scene), spec, { exclude });
  return { id: reading.hit === null ? 'none' : reading.hit.id, cm: reading.cm };
}

/** For each of the five rays, the part of the gripper it meets first within 4 m, the arena left out ('none' when it meets none). */
function raysOnGripper(scene: GripperScene): string[] {
  const pose = sensorPose(scene);
  const lookup = partLookup(scene);
  return ultrasonicRayDirections(spec.coneHalfDeg).map((direction) => {
    const ray = new (getRapier().Ray)(pose.position, rotateVector(pose.rotation, direction));
    const hit = scene.world.castRay(ray, 4, true, undefined, undefined, undefined, undefined, (collider: Collider) => scene.gripper.ownsCollider(collider));
    return hit === null ? 'none' : lookup.infoOf(hit.collider)!.id;
  });
}

/** Steps the arm to `liftDeg` (and the claw to `clawDeg`) and lets it settle. */
function pose(scene: GripperScene, liftDeg: number, clawDeg: number, ticks = seconds(0.1)) {
  scene.set({ liftDeg, clawDeg });
  run(scene, wait(ticks), ticks);
}

/** Runs of equal readings over the lift angles, as "from–to: reading". */
function runsOf(readings: readonly string[]): string[] {
  const runs: string[] = [];
  let start = 0;
  for (let deg = 1; deg <= readings.length; deg++) {
    if (deg === readings.length || readings[deg] !== readings[start]) {
      runs.push(`${start}–${deg - 1}: ${readings[start]}`);
      start = deg;
    }
  }
  return runs;
}

describe('the gripper car’s ultrasonic and the claw servo’s case (N19 B5)', () => {
  /** The scene, its arm swept from 0° to 90° in 1° steps at `clawDeg`: at each angle what the ultrasonic hears and what each ray meets. */
  function sweep(clawDeg: number) {
    const scene = gripperScene({ ground: { sizeCm: [250, 100], color: '#ffffff' }, walls: [{ id: 'wall', fromCm: [WALL_FACE_X + 1, 5], toCm: [WALL_FACE_X + 1, 95] }] }, START);
    try {
      pose(scene, 0, clawDeg, seconds(0.5));
      const readings: string[] = [];
      const rays: string[][] = [];
      for (let liftDeg = 0; liftDeg <= 90; liftDeg++) {
        pose(scene, liftDeg, clawDeg);
        expect(Math.abs(scene.gripper.liftDeg() - liftDeg), `lift ${liftDeg}`).toBeLessThan(0.5);
        // Whole cm: the wall reads 59.9–60.0 as the arm's weight moves over the wheels.
        const { id, cm } = heard(scene);
        readings.push(`${id} ${Math.round(cm)}`);
        rays.push(raysOnGripper(scene));
      }
      return { readings, rays };
    } finally {
      scene.dispose();
    }
  }

  it('reads the claw servo where it stands in front of the HC-SR04 (lift 8–40°), then the carriage (41–52°); the wall 60 cm away below and above', () => {
    for (const clawDeg of [0, 80]) {
      const { readings } = sweep(clawDeg);
      // Measured (ref-uno-gripper@0, PLACEHOLDER geometry): the case's back face 0.5–1.7 cm ahead of the sensor, the carriage's 1.5 cm,
      // both nearer than the sensor's 2 cm, so it reads its near end. The fingers never come into the cone: the claw does not matter.
      expect(runsOf(readings), `claw ${clawDeg}`).toEqual(['0–7: wall 60', '8–40: claw servo 2', '41–52: carriage 2', '53–90: wall 60']);
    }
  }, 60_000);

  it('keeps the five-ray cone clear of the whole gripper at lift 0–3° and 56–90°; from 4° the lowest ray grazes the servo’s top first', () => {
    for (const clawDeg of [0, 80]) {
      const { rays } = sweep(clawDeg);
      const clear = rays.map((meets) => meets.every((part) => part === 'none'));
      expect(runsOf(clear.map(String)), `claw ${clawDeg}`).toEqual(['0–3: true', '4–55: false', '56–90: true']);
      // Lift 4–7°: only the lowest ray (the fifth) meets the case, on its top at more than 60° from its normal: no echo, the wall is heard.
      for (let liftDeg = 4; liftDeg <= 7; liftDeg++) expect(rays[liftDeg], `lift ${liftDeg}`).toEqual(['none', 'none', 'none', 'none', 'claw servo']);
      // The case is in the cone from 4° to 41°, and the first part any ray meets there; never a finger.
      for (let liftDeg = 4; liftDeg <= 55; liftDeg++) {
        expect(rays[liftDeg]!.includes('claw servo'), `lift ${liftDeg}`).toBe(liftDeg <= 41);
        expect(rays[liftDeg]!.includes('finger'), `lift ${liftDeg}`).toBe(false);
      }
    }
  }, 60_000);
});
