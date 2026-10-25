// Spike (N18 R5.2a): a stand-in for the run session (R3.6) and the check (R6.2), to design the pilot scenarios against the real world
// before those tasks land. NOT production code and not their design: it wires what exists on master the obvious way and nothing more.
//
//   program   compileUnoProject → startVirtualRun (the virtual clock of R2.3) on createVirtualUno + createProgramIO (the binding of R2.2)
//   world     createScenarioWorld (R3.5: the variant's arena and start, the start checked, the settle, one measure per tick)
//   goals     createGoal of R6.1, fed toGoalFrame(world.snapshot(), world.frameExtras()) each tick (R3.5's adapter)
//
// Per tick k: the program runs up to world time k·dt, reading the sensors the world measured for tick k (the echo starts 450 µs after
// the trigger, the wait the contract measured, EMU-13); the pins become actuator targets (motor: dir from IN1/IN2, duty from EN, brake
// when IN1 = IN2 = HIGH with a duty, which the hbridge helper never does; servo: its pin's angle); the world steps to k + 1; the goals
// see the frame of k + 1. finish-within is told when the other goals last started to pass together and stayed so (R6.1's note for R6.2).
import type { ProjectDocument } from '../../src/core/circuit/document';
import { localDeviceDefinitions } from '../../src/core/devices/local-catalog';
import { createDeviceRegistry } from '../../src/core/devices/registry';
import { createProgramIO, createVirtualUno, productionKits, type Kit } from '../../src/core/hardware';
import { productionProfiles } from '../../src/core/profiles';
import { createBlockPackCatalog } from '../../src/core/program/block-packs';
import { compileUnoProject } from '../../src/core/program/compile-uno-program';
import { startVirtualRun } from '../../src/core/run/__fixtures__/virtual-run';
import { createGoal, type Goal, type GoalFrame, type GoalResult } from '../../src/core/scenario/goals';
import type { Scenario } from '../../src/core/scenario/scenario';
import { createGroundPaint } from '../../src/core/world/arena/ground-paint';
import { toGoalFrame } from '../../src/core/world/goal-frame';
import { PHYSICS_DT_S, PHYSICS_HZ } from '../../src/core/world/rapier';
import type { MotorCommand } from '../../src/core/world/robot/dc-motor';
import { degToRad } from '../../src/core/world/units';
import { createScenarioWorld } from '../../src/core/world/world';
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
  /** Where the robot ended, and how far it drove (the guard goals' path: Σ speed · dt, the frame's axle speed). */
  end: { xCm: number; yCm: number; yawDeg: number };
  pathCm: number;
  /** Distance driven and distance driven with a line spot on the tape (Σ speed · dt): stay-on-line's own share, for the report. */
  onLine?: { drivenCm: number; onTapeCm: number };
  /** The farthest the middle of the body got from its start (the guard goals' reach). */
  reachCm: number;
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

  const world = await createScenarioWorld(scenario, kit, index);
  const arena = world.arena;
  const paint = createGroundPaint(arena);
  const lineRoles = ['lineLeft', 'lineCenter', 'lineRight'] as const;

  let pins: () => ReturnType<ReturnType<typeof createVirtualUno>['pins']> = () => [];
  const run = startVirtualRun(compiled.ir, {
    scheduler: { delayOverheadUs: board.costsUs.delayOverhead },
    capabilities: ({ scheduler }) => {
      const uno = createVirtualUno(board, scheduler.programClock);
      uno.attachPulseSource(portPin(kit, 'ultrasonic', 'ECHO'), () => {
        const reading = world.sense.ultrasonic('ultrasonic');
        return reading.echoUs === 0 ? 0 : { waitUs: ECHO_WAIT_US, widthUs: reading.echoUs };
      });
      for (const role of lineRoles) uno.attachDigitalSource(portPin(kit, role, 'PIN'), () => world.sense.line(role).level);
      pins = () => uno.pins();
      return createProgramIO(kit, uno, compiled.uses);
    },
  });

  const pinState = (id: string) => pins().find((state) => state.pin === id);
  const motorCommand = (role: 'motorLeft' | 'motorRight'): MotorCommand => {
    const duty = pinState(portPin(kit, role, 'EN'))?.duty ?? 0;
    const in1 = pinState(portPin(kit, role, 'IN1'))?.level ?? 0;
    const in2 = pinState(portPin(kit, role, 'IN2'))?.level ?? 0;
    const dir = in1 === 1 && in2 === 0 ? 1 : in1 === 0 && in2 === 1 ? -1 : 0;
    return { duty, dir, brake: in1 === 1 && in2 === 1 && duty > 0 };
  };
  const servoPin = portPin(kit, 'servo1', 'PIN');

  // The goals, and finish-within's "when did the others last start to pass together".
  let streakStart: number | null = null;
  const goals: Goal[] = [];
  scenario.goals.forEach((spec, i) =>
    goals.push(
      createGoal(spec, {
        arena,
        scenario,
        program,
        othersPassedAtS: () => (goals.every((goal, j) => j === i || goal.result().passed) ? streakStart : null),
      }),
    ),
  );
  const finishIndex = scenario.goals.findIndex((spec) => spec.kind === 'finish-within');

  let pathCm = 0;
  const onLine = { drivenCm: 0, onTapeCm: 0 };
  let origin: [number, number] | undefined;
  let reachCm = 0;
  const contacts = new Set<string>();
  let minFrontCm: number | undefined;
  const track: [number, number, number][] = [];
  const clearanceCm: Record<string, number> = {};
  const outline = footprintOutline(kit);
  const observe = (frame: GoalFrame, dtS: number) => {
    const { xCm, yCm, yawDeg, speedCmS, lineSpotsCm = [] } = frame.robot;
    if (Math.round(frame.tS * PHYSICS_HZ) % 6 === 0) track.push([xCm, yCm, yawDeg]);
    if (!frame.outOfArena) pathCm += speedCmS * dtS;
    if (!frame.outOfArena && speedCmS > 0) {
      onLine.drivenCm += speedCmS * dtS;
      if (lineSpotsCm.some(([x, y]) => paint.groundReflectanceAt(x, y, 0) <= 0.25)) onLine.onTapeCm += speedCmS * dtS;
    }
    if (!frame.outOfArena) {
      origin ??= [xCm, yCm];
      reachCm = Math.max(reachCm, Math.hypot(xCm - origin[0], yCm - origin[1]));
    }
    for (const contact of frame.contacts) contacts.add(contact.otherId);
    const front = world.sense.ultrasonic('ultrasonic');
    if (front.echoUs > 0) minFrontCm = Math.min(minFrontCm ?? Infinity, front.cm);
    const a = degToRad(yawDeg);
    arena.boxes.forEach((box, i) => {
      const id = box.id ?? `#box-${i}`;
      const gap = Math.min(...outline.map(([u, v]) => boxDistance(box, xCm + u * Math.cos(a) - v * Math.sin(a), yCm + u * Math.sin(a) + v * Math.cos(a))));
      clearanceCm[id] = Math.min(clearanceCm[id] ?? Infinity, gap);
    });
  };
  const feed = (dtS: number) => {
    const frame = toGoalFrame(world.snapshot(), world.frameExtras());
    observe(frame, dtS);
    goals.forEach((goal) => goal.update(frame, dtS));
    if (goals.every((goal, i) => i === finishIndex || goal.result().passed)) streakStart ??= frame.tS;
    else streakStart = null;
  };

  feed(0);
  const ticks = Math.round((options.seconds ?? scenario.timeLimitS) * PHYSICS_HZ);
  for (let k = 0; k < ticks; k++) {
    await run.tick(k);
    await Promise.resolve();
    const servoDeg = pinState(servoPin)?.servoDeg;
    world.applyActuators({
      motors: { motorLeft: motorCommand('motorLeft'), motorRight: motorCommand('motorRight') },
      ...(servoDeg == null ? {} : { servos: { servo1: servoDeg } }),
    });
    world.step(PHYSICS_DT_S);
    feed(PHYSICS_DT_S);
  }
  run.stop();
  const results = goals.map((goal) => goal.result());
  const end = world.snapshot().robot;
  const start = track[0]!;
  world.dispose();
  return {
    variant: index,
    start: { xCm: start[0], yCm: start[1], yawDeg: start[2] },
    goals: results,
    points: results.reduce((sum, result) => sum + result.points, 0),
    passed: results.every((result) => result.passed),
    end: { xCm: end.xCm, yCm: end.yCm, yawDeg: end.yawDeg },
    pathCm,
    reachCm,
    ...(scenario.arena.paint.lines.length > 0 ? { onLine } : {}),
    contacts: [...contacts].sort(),
    ...(minFrontCm === undefined ? {} : { minFrontCm }),
    clearanceCm,
    track,
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
