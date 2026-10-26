import { productionKits } from '../../hardware/catalog';
import type { Kit } from '../../hardware/kit';
import { parseArena, type ArenaInput } from '../arena/arena-schema';
import { buildArena, type BuiltArena } from '../arena/build-arena';
import { createPhysicsWorld, PHYSICS_DT_S, type PhysicsWorld } from '../rapier';
import { assembleRobot, stepWorld, type RobotBody, type RobotStart } from '../robot/assembly';
import type { MotorCommand } from '../robot/dc-motor';
import { graspObjects, type Grasp, type GraspObject } from '../robot/grasp';
import type { Gripper, GripperTargets } from '../robot/gripper';

// N19 B1/B2 test harness: the gripper car in a physics world of its own, stepped the way world.ts steps it (stepWorld, then the grasp
// machine), with plain scripts that set the targets each tick, as the G0.1 spike did (spikes/n19-grasp/scenarios.ts). No Blockly, no
// virtual UNO. Measures that need Math trigonometry stay in the tests (this file is world code for lint: dmath or exact Math only).

export const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
export const DT = PHYSICS_DT_S;
export const seconds = (s: number): number => Math.round(s / DT);

export const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
export const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
export const forward = (duty: number): MotorCommand => ({ duty, dir: 1, brake: false });
export const backward = (duty: number): MotorCommand => ({ duty, dir: -1, brake: false });

export type GripperScene = {
  readonly world: PhysicsWorld;
  readonly arena: BuiltArena;
  readonly robot: RobotBody;
  readonly gripper: Gripper;
  readonly grasp: Grasp;
  /** Ticks stepped since the scene was built (after the robot's settle). */
  readonly tick: number;
  /** Both drive motors, until the next call (the gripper's targets do not stop them). */
  drive(command: MotorCommand): void;
  /** The gripper's servo targets (a field left out holds). */
  set(targets: GripperTargets): void;
  /** One tick: stepWorld, then the grasp machine (world.ts's order). */
  step(): void;
  object(id: string): GraspObject;
  dispose(): void;
};

/** The gripper kit's robot at `start` in `arena`, settled (assembleRobot), with the arena's objects for the grasp machine. */
export function gripperScene(input: ArenaInput, start: RobotStart, kit: Kit = gripperKit): GripperScene {
  const world = createPhysicsWorld();
  try {
    const parsed = parseArena(input);
    const arena = buildArena(world, parsed);
    const robot = assembleRobot(world, kit, start, { graspObjects: graspObjects(parsed, arena) });
    const gripper = robot.gripper;
    const grasp = robot.grasp;
    if (gripper === null || grasp === null) throw new Error(`kit ${kit.id} has no gripper`);
    let motor = COAST;
    let tick = 0;
    return {
      world,
      arena,
      robot,
      gripper,
      grasp,
      get tick() {
        return tick;
      },
      drive(command) {
        motor = command;
        robot.applyActuators({ motors: { motorLeft: motor, motorRight: motor } });
      },
      set(targets) {
        robot.applyActuators({ motors: { motorLeft: motor, motorRight: motor }, gripper: targets });
      },
      step() {
        stepWorld(world, robot);
        tick += 1;
        grasp.update(DT);
      },
      object(id) {
        const found = grasp.objects.find((object) => object.id === id);
        if (found === undefined) throw new Error(`no object ${id}`);
        return found;
      },
      dispose() {
        grasp.release();
        world.free();
      },
    };
  } catch (error) {
    world.free();
    throw error;
  }
}

/** A script: one `yield` per tick (the scene steps between them). */
export type Script = Generator<void, void, void>;

export function* wait(ticks: number): Script {
  for (let i = 0; i < ticks; i++) yield;
}

export function* until(done: () => boolean, maxTicks: number): Script {
  for (let i = 0; i < maxTicks && !done(); i++) yield;
}

/** Runs `script` for `ticks` ticks: each tick the script's next step, then one step of the scene, then `onTick`. */
export function run(scene: GripperScene, script: Script, ticks: number, onTick?: () => void): void {
  for (let t = 0; t < ticks; t++) {
    script.next();
    scene.step();
    onTick?.();
  }
}

/** A cube of `sizeCm` on its own spot of the floor. */
export const cube = (id: string, centerCm: readonly [number, number], massG: number, sizeCm = 4) => ({
  shape: 'box' as const,
  id,
  centerCm: [centerCm[0], centerCm[1]] as [number, number],
  sizeCm: [sizeCm, sizeCm, sizeCm] as [number, number, number],
  massG,
});

/**
 * The pick of the spike: lower to `liftDeg` and open, drive in at `duty` until the cube's centre is at carriage u ≤ `u` (+ 0.25 cm for
 * the tick's travel), brake, close to 80°, wait for the attach (at most 0.6 s), and 0.2 s more.
 */
export function* pick(scene: GripperScene, id: string, options: { readonly liftDeg: number; readonly u: number; readonly duty?: number }): Script {
  const target = scene.object(id);
  scene.set({ liftDeg: options.liftDeg, clawDeg: 0 });
  yield* wait(seconds(0.35));
  scene.drive(forward(options.duty ?? 140));
  yield* until(() => scene.grasp.view(target).u <= options.u + 0.25, seconds(4));
  scene.drive(BRAKE);
  yield* wait(seconds(0.3));
  scene.set({ clawDeg: 80 });
  yield* until(() => scene.grasp.heldId !== null, seconds(0.6));
  yield* wait(seconds(0.2));
}
