// Spike (N18 R5.2a): a stand-in for the run session (R3.6) and the check (R6.2), to design the pilot scenarios against the real world
// before those tasks land. NOT production code and not their design: it wires what exists on master the obvious way and nothing more.
//
//   program   compileUnoProject → startVirtualRun (the virtual clock of R2.3) on createVirtualUno + createProgramIO (the binding of R2.2)
//   world     buildArena (R3.2) + assembleRobot (R3.3) + the sensors of R3.4, stepped at 120 Hz with stepWorld
//   goals     createGoal of R6.1, fed one GoalFrame per tick (the adapter is R3.5's; this one is the obvious one)
//
// Per tick k: the program runs up to world time k·dt, reading the sensors of the world as it is (state k); the pins become actuator
// targets; the world steps to k + 1; the goals see the frame at (k + 1)·dt. The ultrasonic echo starts 450 µs after the trigger (the wait
// the contract measured, EMU-13). Motors: dir from IN1/IN2, duty from EN, brake when IN1 = IN2 = HIGH with a duty (the hbridge never does).
import type { ProjectDocument } from '../../src/core/circuit/document';
import { localDeviceDefinitions } from '../../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../../src/core/devices/registry';
import { createProgramIO, createVirtualUno, productionKits, type Kit, type KitModule, type LineSensorSpec, type UltrasonicSpec } from '../../src/core/hardware';
import { productionProfiles } from '../../src/core/profiles';
import { createBlockPackCatalog } from '../../src/core/program/block-packs';
import { compileUnoProject } from '../../src/core/program/compile-uno-program';
import { startVirtualRun } from '../../src/core/run/__fixtures__/virtual-run';
import { createGoal, type Goal, type GoalFrame, type GoalResult } from '../../src/core/scenario/goals';
import type { Scenario } from '../../src/core/scenario/scenario';
import { applyVariant, variantOffsets } from '../../src/core/scenario/variants';
import { buildArena } from '../../src/core/world/arena/build-arena';
import { createGroundPaint } from '../../src/core/world/arena/ground-paint';
import { createPhysicsWorld, PHYSICS_DT_S } from '../../src/core/world/rapier';
import { assembleRobot, stepWorld, type ActuatorTargets } from '../../src/core/world/robot/assembly';
import type { MotorCommand } from '../../src/core/world/robot/dc-motor';
import { localToWorld, multiplyQuaternions, robotPointToLocal } from '../../src/core/world/robot/robot-frame';
import { readContacts } from '../../src/core/world/sensors/contacts';
import { LIFTED_HEIGHT_CM, measureLine } from '../../src/core/world/sensors/line';
import { isOutOfArena } from '../../src/core/world/sensors/out-of-arena';
import { measureUltrasonic } from '../../src/core/world/sensors/ultrasonic';
import { degToRad, radToDeg, worldToArena, yawOfQuaternion, yawToQuaternion } from '../../src/core/world/units';
import { robotStarterDocument } from '../../src/samples/robot-templates';

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const rules = { registry, profiles: productionProfiles, packs, kits: productionKits };
const ECHO_WAIT_US = 450;

export type VariantRun = {
  variant: number;
  start: { xCm: number; yCm: number; yawDeg: number };
  goals: GoalResult[];
  points: number;
  passed: boolean;
  /** Where the robot ended, and how far it went. */
  end: { xCm: number; yCm: number; yawDeg: number };
  pathCm: number;
  /** Ticks moving and ticks moving with a line spot on the tape (stay-on-line's own count, for the report). */
  onLine?: { moving: number; onTape: number };
  contacts: string[];
  minFrontCm?: number;
  /** The least gap between the robot's floor footprint (body and wheels) and each box, cm (0 when touching). */
  clearanceCm: Record<string, number>;
  /** The pose every 6 ticks (20 Hz): x, y, yaw. */
  track: [number, number, number][];
  programOutcome: string;
};

const portPin = (kit: Kit, role: string, pin: string): string => {
  const module = kit.modules.find((candidate) => candidate.role === role)!;
  const port = kit.ports.find((candidate) => candidate.id === module.port)!;
  return port.pins[pin]!;
};

export async function runVariant(scenario: Scenario, program: unknown, index: number, options: { seconds?: number } = {}): Promise<VariantRun> {
  const document: ProjectDocument = { ...robotStarterDocument(scenario.key as never), program: { blocks: program as Record<string, unknown> } };
  const compiled = compileUnoProject(document, rules);
  if (!compiled.ok) throw new Error(`does not compile: ${JSON.stringify(compiled.diagnostics)}`);
  const { kit, board } = compiled;

  const offsets = variantOffsets(scenario, index);
  const { start, arena } = applyVariant(scenario, offsets);
  const world = createPhysicsWorld();
  const built = buildArena(world, arena);
  const robot = assembleRobot(world, kit, start);
  const paint = createGroundPaint(arena);

  const moduleOf = (role: string) => kit.modules.find((module) => module.role === role) as KitModule | undefined;
  const sensorPose = (module: KitModule) => {
    const pose = robot.pose();
    const position = localToWorld(pose.position, pose.rotation, robotPointToLocal(module.mount.posCm));
    return { position, rotation: multiplyQuaternions(pose.rotation, yawToQuaternion(degToRad(module.mount.yawDeg))) };
  };
  const lineRoles = ['lineLeft', 'lineCenter', 'lineRight'] as const;
  const ultrasonicModule = moduleOf('ultrasonic')!;

  let pins: () => ReturnType<ReturnType<typeof createVirtualUno>['pins']> = () => [];
  const run = startVirtualRun(compiled.ir, {
    scheduler: { delayOverheadUs: board.costsUs.delayOverhead },
    capabilities: ({ scheduler }) => {
      const uno = createVirtualUno(board, scheduler.programClock);
      uno.attachPulseSource(portPin(kit, 'ultrasonic', 'ECHO'), () => {
        const reading = measureUltrasonic(world, built, sensorPose(ultrasonicModule), ultrasonicModule.spec as UltrasonicSpec, { exclude: robot.ownsCollider });
        return reading.echoUs === 0 ? 0 : { waitUs: ECHO_WAIT_US, widthUs: reading.echoUs };
      });
      for (const role of lineRoles) {
        const module = moduleOf(role)!;
        uno.attachDigitalSource(portPin(kit, role, 'PIN'), () => measureLine(paint, sensorPose(module).position, module.spec as LineSensorSpec).level);
      }
      pins = () => uno.pins();
      return createProgramIO(kit, uno, compiled.uses);
    },
  });

  const pinState = (id: string) => pins().find((state) => state.pin === id);
  const motorCommand = (role: 'motorLeft' | 'motorRight'): MotorCommand => {
    const en = pinState(portPin(kit, role, 'EN'));
    const in1 = pinState(portPin(kit, role, 'IN1'))?.level ?? 0;
    const in2 = pinState(portPin(kit, role, 'IN2'))?.level ?? 0;
    const duty = en?.duty ?? 0;
    const dir = in1 === 1 && in2 === 0 ? 1 : in1 === 0 && in2 === 1 ? -1 : 0;
    return { duty, dir, brake: in1 === 1 && in2 === 1 && duty > 0 };
  };
  const servoPin = portPin(kit, 'servo1', 'PIN');

  // The goals, and finish-within's "when did the others last start to pass together".
  let goals: Goal[] = [];
  let streakStart: number | null = null;
  const others = (self: number) => goals.filter((_, i) => i !== self);
  goals = scenario.goals.map((spec, i) =>
    createGoal(spec, {
      arena,
      scenario,
      program,
      othersPassedAtS: () => (others(i).every((goal) => goal.result().passed) ? streakStart : null),
    }),
  );
  const finishIndex = scenario.goals.findIndex((spec) => spec.kind === 'finish-within');

  let last = robot.pose().position;
  let pathCm = 0;
  let onLine = { moving: 0, onTape: 0 };
  const contacts = new Set<string>();
  let minFrontCm: number | undefined;
  const track: [number, number, number][] = [];
  const clearanceCm: Record<string, number> = {};
  const outline = footprintOutline(kit);
  const frameAt = (tS: number, dtS: number): GoalFrame => {
    const pose = robot.pose();
    const here = worldToArena(pose.position);
    const yawRad = yawOfQuaternion(pose.rotation);
    if (Math.round(tS * 120) % 6 === 0) track.push([here.xCm, here.yCm, radToDeg(yawRad)]);
    arena.boxes.forEach((box, i) => {
      const id = box.id ?? `#box-${i}`;
      const c = Math.cos(yawRad);
      const s = Math.sin(yawRad);
      const gap = Math.min(...outline.map(([u, v]) => boxDistance(box, here.xCm + u * c - v * s, here.yCm + u * s + v * c)));
      clearanceCm[id] = Math.min(clearanceCm[id] ?? Infinity, gap);
    });
    const before = worldToArena(last);
    const moved = Math.hypot(here.xCm - before.xCm, here.yCm - before.yCm);
    const speedCmS = dtS > 0 ? moved / dtS : 0;
    last = pose.position;
    const out = isOutOfArena(arena, pose.position);
    if (!out) pathCm += speedCmS * dtS;
    const spots = lineRoles.flatMap((role) => {
      const p = worldToArena(sensorPose(moduleOf(role)!).position);
      return p.heightCm > LIFTED_HEIGHT_CM ? [] : [[p.xCm, p.yCm] as [number, number]];
    });
    if (speedCmS > 1) {
      onLine.moving += 1;
      if (spots.some(([x, y]) => paint.groundReflectanceAt(x, y, 0) <= 0.25)) onLine.onTape += 1;
    }
    const touching = readContacts(world, built, robot.bodies).filter((info) => !info.tags.includes('ground'));
    for (const info of touching) contacts.add(info.id);
    const front = measureUltrasonic(world, built, sensorPose(ultrasonicModule), ultrasonicModule.spec as UltrasonicSpec, { exclude: robot.ownsCollider });
    if (front.echoUs > 0) minFrontCm = Math.min(minFrontCm ?? Infinity, front.cm);
    const servoDeg = robot.servoAngles().servo1;
    return {
      tS,
      robot: {
        xCm: here.xCm,
        yCm: here.yCm,
        yawDeg: radToDeg(yawOfQuaternion(pose.rotation)),
        speedCmS,
        footprint: { kind: 'circle', radiusCm: 11 },
        lineSpotsCm: spots,
      },
      objects: {},
      contacts: touching.map((info) => ({ otherId: info.id, tags: info.tags })),
      servoDeg: servoDeg === undefined ? {} : { servo1: Math.min(180, Math.max(0, servoDeg)) },
      leds: {},
      buzzerHz: null,
      outOfArena: out,
    };
  };
  const feed = (frame: GoalFrame, dtS: number) => {
    goals.forEach((goal) => goal.update(frame, dtS));
    const allOthers = goals.every((goal, i) => i === finishIndex || goal.result().passed);
    if (allOthers) streakStart ??= frame.tS;
    else streakStart = null;
  };

  feed(frameAt(0, 0), 0);
  const ticks = Math.round((options.seconds ?? scenario.timeLimitS) / PHYSICS_DT_S);
  for (let k = 0; k < ticks; k++) {
    await run.tick(k);
    await Promise.resolve();
    const targets: ActuatorTargets = {
      motors: { motorLeft: motorCommand('motorLeft'), motorRight: motorCommand('motorRight') },
      ...(pinState(servoPin)?.servoDeg != null ? { servos: { servo1: pinState(servoPin)!.servoDeg! } } : {}),
    };
    robot.applyActuators(targets);
    stepWorld(world, robot);
    feed(frameAt(((k + 1) * 1000) / 120 / 1000, PHYSICS_DT_S), PHYSICS_DT_S);
  }
  run.stop();
  const results = goals.map((goal) => goal.result());
  const pose = robot.pose();
  const end = worldToArena(pose.position);
  world.free();
  return {
    variant: index,
    start,
    goals: results,
    points: results.reduce((sum, result) => sum + result.points, 0),
    passed: results.every((result) => result.passed),
    end: { xCm: end.xCm, yCm: end.yCm, yawDeg: radToDeg(yawOfQuaternion(pose.rotation)) },
    pathCm,
    ...(scenario.arena.paint.lines.length > 0 ? { onLine } : {}),
    contacts: [...contacts].sort(),
    clearanceCm,
    track,
    ...(minFrontCm === undefined ? {} : { minFrontCm }),
    programOutcome: run.outcome()?.status ?? 'running',
  };
}

/** Points along the edges of the robot's floor footprint (body box and drive wheels), every 0.5 cm, in the robot frame (x forward, y left). */
function footprintOutline(kit: Kit): [number, number][] {
  const [length, width] = kit.chassis!.bodyCm;
  const rects: [number, number, number, number][] = [[0, 0, length / 2, width / 2]];
  for (const module of kit.modules) {
    if (module.kind !== 'dc-motor') continue;
    const spec = module.spec as { wheelRadiusCm: number; wheelWidthCm: number };
    rects.push([module.mount.posCm[0], module.mount.posCm[1], spec.wheelRadiusCm, spec.wheelWidthCm / 2]);
  }
  const points: [number, number][] = [];
  for (const [cx, cy, hx, hy] of rects) {
    for (let t = -hx; t <= hx + 1e-9; t += 0.5) points.push([cx + t, cy - hy], [cx + t, cy + hy]);
    for (let t = -hy; t <= hy + 1e-9; t += 0.5) points.push([cx - hx, cy + t], [cx + hx, cy + t]);
  }
  return points;
}

/** How far a floor point is from a box (0 inside), cm. */
function boxDistance(box: { centerCm: readonly [number, number]; sizeCm: readonly [number, number, number]; yawDeg: number }, x: number, y: number): number {
  const a = degToRad(box.yawDeg);
  const dx = x - box.centerCm[0];
  const dy = y - box.centerCm[1];
  const lx = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) - box.sizeCm[0] / 2;
  const ly = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a)) - box.sizeCm[1] / 2;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}
