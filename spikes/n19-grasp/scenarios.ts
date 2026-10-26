// N19 G0.1 grasp spike: the eight scenarios of the brief, the measures, the level sweep, ms/tick and the determinism hashes.
// Plain scripts set the targets each tick (generators: one `yield` per tick); no Blockly, no virtual UNO.
//
// Measures use Math trig (pitchRollDeg, angleDeg): measurement only, never written back into the world (ADR 0001 §4.6).

import { parseArena, type ArenaInput } from '../../src/core/world/arena/arena-schema';
import type { MotorCommand } from '../../src/core/world/robot/dc-motor';
import { createWorld } from '../../src/core/world/world';
import { rotateVector } from '../../src/core/world/units';
import type { GripperOptions, LinkMode, ServoLaw, FingerMode } from './gripper';
import { BREAK_FORCE_N, GRIPPER_SPEC, SQUEEZE_N } from './params';
import {
  anyNaN,
  angleDeg,
  casterContact,
  createRoverSim,
  createSim,
  DT,
  gripperPenetrationM,
  gripperTouchesChassis,
  HASH_OFFSET,
  hashBits,
  hashInt,
  hashQ6,
  hex,
  pitchRollDeg,
  relativePose,
  roverKit,
  type Sim,
} from './sim';

export type Config = {
  readonly name: string;
  readonly law: ServoLaw;
  readonly link: LinkMode;
  readonly fingers: FingerMode;
  readonly fingerFriction: number;
  readonly tuning: NonNullable<GripperOptions['tuning']>;
};

/** §4.4 exactly: the servo-arm law, the hold motor, +4 PGS, solid fingers with jawFriction. */
export const PLAN: Config = { name: 'plan', law: 'servo', link: 'hold-motor', fingers: 'collider', fingerFriction: GRIPPER_SPEC.jawFriction, tuning: { extraPgs: 4, boomRotorInertia: 0 } };
/**
 * What the spike found works (trace.ts, ADR 0003 §G0.1): the braking law at half the worst-case deceleration, the parallelogram's
 * angular lock, a small reflected rotor inertia on the boom (PLACEHOLDER 5e-5 kg·m²), +8 PGS and +4 solver iterations on the
 * gripper's island; solid frictionless fingers.
 */
export const TUNED_COLLIDER: Config = {
  name: 'tuned-collider',
  law: 'servo-brake',
  link: 'chassis-lock',
  fingers: 'collider',
  fingerFriction: 0,
  tuning: { extraPgs: 8, extraSolver: 4, boomRotorInertia: 5e-5, decelFactor: 0.5 },
};
/** The same with sensor-only fingers (the D-G5 fallback). */
export const TUNED_SENSOR: Config = { ...TUNED_COLLIDER, name: 'tuned-sensor', fingers: 'sensor' };
export const CONFIGS = [PLAN, TUNED_COLLIDER, TUNED_SENSOR] as const;

const r = (v: number, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const FORWARD: MotorCommand = { duty: 0, dir: 1, brake: false };
const BRAKE: MotorCommand = { duty: 0, dir: 0, brake: true };
const COAST: MotorCommand = { duty: 0, dir: 0, brake: false };
const forward = (duty: number): MotorCommand => ({ ...FORWARD, duty });
const backward = (duty: number): MotorCommand => ({ duty, dir: -1, brake: false });
const seconds = (s: number) => Math.round(s / DT);

const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
/** The carriage origin (boom tip) ahead of the chassis origin at lift φ, cm (from the GR1 mount, boom 5 cm, elevation φ − 40°). */
const tipX = (liftDeg: number) => 4.5 + 5 * Math.cos(((liftDeg - 40) * Math.PI) / 180);
const ground = (sizeCm: [number, number]): ArenaInput['ground'] => ({ sizeCm, color: '#ffffff' });
const cube = (id: string, xCm: number, massG: number) => ({ shape: 'box' as const, id, centerCm: [xCm, 50] as [number, number], sizeCm: [4, 4, 4] as [number, number, number], massG });

// ---------------------------------------------------------------------------------------------------------------------------
// Per-tick recorder

type Recorder = ReturnType<typeof createRecorder>;
type Motion = { maxPitch: number; minPitch: number; maxRoll: number; casterMinLoadN: number; casterMaxHeightMm: number; casterTicksOff: number };
const motion = (): Motion => ({ maxPitch: 0, minPitch: 0, maxRoll: 0, casterMinLoadN: Number.POSITIVE_INFINITY, casterMaxHeightMm: Number.NEGATIVE_INFINITY, casterTicksOff: 0 });
/** The caster is off the floor when its ball's lowest point is more than this above it (production's wall test: < 0.1 mm). */
const CASTER_OFF_MM = 0.1;

/**
 * Per-tick measures. Pitch, roll and caster are kept for the whole run (`all`) and, once `setWindow` is called, for that window only
 * (`window`: what an acceptance line names, e.g. the braking or the wall hit). Penetration is kept by phase: while closing (before the
 * first attach), while held, and after (released, broken, or a claw that closed without an attach).
 */
function createRecorder(sim: Sim, cubeId: string) {
  const target = sim.object(cubeId);
  const all = motion();
  let win: Motion | null = null;
  let windowRange: { from: number; to: number } | null = null;
  const m = {
    maxLevel: 0,
    penClosingMm: 0,
    penHeldMm: 0,
    penAfterMm: 0,
    penCarriageMm: 0,
    jitterMm: 0,
    jitterDeg: 0,
    maxExternalN: 0,
    gripperChassisTicks: 0,
    nan: false,
    cubeMaxBottomCm: Number.NEGATIVE_INFINITY,
  };
  let everHeld = false;
  let closed = false;
  let opened = false;
  let heldRef: { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } } | null = null;
  const addMotion = (into: Motion, pitch: number, roll: number, caster: { loadN: number; heightM: number }) => {
    into.maxPitch = Math.max(into.maxPitch, pitch);
    into.minPitch = Math.min(into.minPitch, pitch);
    into.maxRoll = Math.max(into.maxRoll, Math.abs(roll));
    into.casterMinLoadN = Math.min(into.casterMinLoadN, caster.loadN);
    into.casterMaxHeightMm = Math.max(into.casterMaxHeightMm, caster.heightM * 1000);
    if (caster.heightM * 1000 > CASTER_OFF_MM) into.casterTicksOff += 1;
  };
  const round = (o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r(v) : v]));
  return {
    setWindow(from: number, to: number) {
      windowRange = { from, to };
      win = motion();
    },
    sample() {
      const tick = sim.tick;
      const { pitch, roll } = pitchRollDeg(sim.robot.chassis.rotation());
      const caster = casterContact(sim);
      addMotion(all, pitch, roll, caster);
      if (win !== null && windowRange !== null && tick >= windowRange.from && tick < windowRange.to) addMotion(win, pitch, roll, caster);
      m.maxLevel = Math.max(m.maxLevel, Math.abs(sim.gripper.carriageLevelErrorDeg()));
      const held = sim.grasp.heldId === cubeId;
      everHeld ||= held;
      const fingerPen = gripperPenetrationM(sim, target.collider, 'fingers') * 1000;
      if (sim.gripper.clawCommandDeg > 0) closed = true;
      else if (closed) opened = true;
      if (held) m.penHeldMm = Math.max(m.penHeldMm, fingerPen);
      else if (!everHeld && !opened) m.penClosingMm = Math.max(m.penClosingMm, fingerPen);
      else m.penAfterMm = Math.max(m.penAfterMm, fingerPen);
      m.penCarriageMm = Math.max(m.penCarriageMm, gripperPenetrationM(sim, target.collider, 'carriage') * 1000);
      if (held) {
        const rel = relativePose(sim.gripper.carriage, target.body);
        heldRef ??= rel;
        const dx = rel.p.x - heldRef.p.x;
        const dy = rel.p.y - heldRef.p.y;
        const dz = rel.p.z - heldRef.p.z;
        const dot = Math.abs(heldRef.q.x * rel.q.x + heldRef.q.y * rel.q.y + heldRef.q.z * rel.q.z + heldRef.q.w * rel.q.w);
        m.jitterMm = Math.max(m.jitterMm, Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000);
        m.jitterDeg = Math.max(m.jitterDeg, angleDeg({ x: 0, y: 0, z: 0, w: Math.min(1, dot) }));
        m.maxExternalN = Math.max(m.maxExternalN, sim.grasp.lastExternalN);
      } else {
        heldRef = null;
      }
      if (gripperTouchesChassis(sim)) m.gripperChassisTicks += 1;
      if (anyNaN(sim.bodies)) m.nan = true;
      m.cubeMaxBottomCm = Math.max(m.cubeMaxBottomCm, target.body.translation().y * 100 - 2);
    },
    summary() {
      return { ...round(m), all: round(all), ...(win === null ? {} : { window: round(win) }) };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Script helpers (generators: one yield per tick)

type Script = Generator<void, void, void>;
function* wait(ticks: number): Script {
  for (let i = 0; i < ticks; i++) yield;
}
function* until(pred: () => boolean, maxTicks: number): Script {
  for (let i = 0; i < maxTicks && !pred(); i++) yield;
}
/** Forward distance of the chassis along world +X since `x0`, cm. */
const along = (sim: Sim, x0: number) => (sim.robot.chassis.translation().x - x0) * 100;

/** Lower, open, drive slowly in until the cube's centre is at carriage u ≤ `u`, brake, close, wait for the attach. */
function* pick(sim: Sim, cubeId: string, opts: { liftDeg: number; u: number; duty?: number }): Script {
  const target = sim.object(cubeId);
  sim.gripper.setLift(opts.liftDeg);
  sim.gripper.setClaw(0);
  yield* wait(seconds(0.35));
  sim.drive(forward(opts.duty ?? 140));
  yield* until(() => sim.grasp.view(target).u <= opts.u + 0.25, seconds(4));
  sim.drive(BRAKE);
  yield* wait(seconds(0.3));
  sim.gripper.setClaw(80);
  yield* until(() => sim.grasp.heldId !== null, seconds(0.6));
  yield* wait(seconds(0.2));
}
function* driveCm(sim: Sim, cm: number, duty: number): Script {
  const x0 = sim.robot.chassis.translation().x;
  sim.drive(cm >= 0 ? forward(duty) : backward(duty));
  yield* until(() => (cm >= 0 ? along(sim, x0) >= cm : along(sim, x0) <= cm), seconds(6));
  sim.drive(BRAKE);
}

type Outcome = Record<string, unknown>;
/** Runs a script to `ticks`, sampling after every step; returns the recorder and the per-tick hashes. */
function run(sim: Sim, script: Script, ticks: number, recorder: Recorder | null, onTick?: () => void) {
  let traj = HASH_OFFSET;
  for (let t = 0; t < ticks; t++) {
    script.next();
    sim.step();
    traj = hashBits(traj, sim.bodies);
    traj = hashInt(traj, sim.grasp.heldId === null ? 0 : 1);
    recorder?.sample();
    onTick?.();
  }
  return { trajBits: hex(traj), finalQ6: hex(hashQ6(HASH_OFFSET, sim.bodies)) };
}

const events = (sim: Sim) => sim.grasp.events.map((e) => ({ ...e, thetaCDeg: r(e.thetaCDeg), ...(e.forceN === undefined ? {} : { forceN: r(e.forceN, 2) }), t: r(e.tick * DT) }));
const cubePose = (sim: Sim, id: string) => {
  const p = sim.object(id).body.translation();
  return { xCm: r(p.x * 100), yCm: r(-p.z * 100), zCm: r(p.y * 100) };
};
/** Tilt of a box from upright on any face: the least angle between world up and ± a face normal, degrees. */
function tiltDeg(sim: Sim, id: string): number {
  const q = sim.object(id).body.rotation();
  let best = 90;
  for (const axis of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    const a = rotateVector(q, axis);
    best = Math.min(best, (Math.acos(Math.min(1, Math.abs(a.y))) * 180) / Math.PI);
  }
  return best;
}

function newSim(config: Config, arena: ArenaInput): Sim {
  return createSim({ arena, start: START, fingers: config.fingers, fingerFriction: config.fingerFriction, law: config.law, link: config.link, tuning: config.tuning });
}

// ---------------------------------------------------------------------------------------------------------------------------
// Scenarios

export const S1_TICKS = 3000;

/** 1 and 2: pick from the floor at lift 0°, close, lift to 90°, drive 50 cm, lower, release, back off; 3000 ticks. */
export function scenarioCarry(config: Config, massG: number, record = true, offsetCm: readonly [number, number] = [0, 0]): Outcome & { hash: { trajBits: string; finalQ6: string } } {
  const placed = cube('cube', START.xCm + tipX(0) + 3 + 8 + offsetCm[0], massG);
  const arena: ArenaInput = { ground: ground([200, 100]), objects: [{ ...placed, centerCm: [placed.centerCm[0], placed.centerCm[1] + offsetCm[1]] }] };
  const sim = newSim(config, arena);
  const recorder = record ? createRecorder(sim, 'cube') : null;
  const phase: Record<string, number> = {};
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
    phase.attachU = r(sim.grasp.view(sim.object('cube')).u);
    phase.attachW = r(sim.grasp.view(sim.object('cube')).w);
    sim.gripper.setLift(90);
    yield* wait(seconds(0.5));
    phase.liftedBottomCm = r(sim.object('cube').body.translation().y * 100 - 2);
    yield* driveCm(sim, 50, 200);
    yield* wait(seconds(0.6));
    sim.gripper.setLift(0);
    yield* wait(seconds(0.5));
    sim.gripper.setClaw(0);
    yield* wait(seconds(0.4));
    yield* driveCm(sim, -10, 120);
    for (;;) yield;
  })();
  const hash = run(sim, script, S1_TICKS, recorder);
  const out = { massG, events: events(sim), phase, cubeEnd: cubePose(sim, 'cube'), cubeTiltEndDeg: r(tiltDeg(sim, 'cube')), liveJointsEnd: sim.grasp.liveJoints, ...(recorder ? recorder.summary() : {}), hash };
  sim.dispose();
  return out;
}

/** 3: a 60 g cube (over maxPayloadG): close on it, lift to 90°, hold 1 s, open. It must never attach (nor be carried by friction). */
export function scenarioTooHeavy(config: Config): Outcome {
  const arena: ArenaInput = { ground: ground([200, 100]), objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, 60)] };
  const sim = newSim(config, arena);
  const recorder = createRecorder(sim, 'cube');
  const info: Record<string, unknown> = {};
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
    info.clawAfterCloseDeg = r(sim.gripper.clawDeg());
    sim.gripper.setLift(90);
    yield* wait(seconds(1.0));
    info.cubeBottomAtLift90Cm = r(sim.object('cube').body.translation().y * 100 - 2);
    sim.gripper.setClaw(0);
    yield* wait(seconds(0.4));
    for (;;) yield;
  })();
  run(sim, script, seconds(4), recorder);
  const out = { massG: 60, ...info, events: events(sim), cubeEnd: cubePose(sim, 'cube'), ...recorder.summary() };
  sim.dispose();
  return out;
}

/** 4: brake (or coast) from top speed holding 50 g at a lift angle. */
export function scenarioBrake(config: Config, liftDeg: number, stop: 'brake' | 'coast'): Outcome {
  const arena: ArenaInput = { ground: ground([300, 100]), objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, 50)] };
  const sim = newSim(config, arena);
  const recorder = createRecorder(sim, 'cube');
  const info: Record<string, unknown> = {};
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
    sim.gripper.setLift(liftDeg);
    yield* wait(seconds(0.5));
    sim.drive(forward(255));
    yield* wait(seconds(1.5));
    info.speedAtStopMS = r(Math.abs(sim.robot.linvel().x), 4);
    recorder.setWindow(sim.tick, sim.tick + seconds(1.5));
    sim.drive(stop === 'brake' ? BRAKE : COAST);
    const x0 = sim.robot.chassis.translation().x;
    yield* wait(seconds(1.5));
    info.stopDistanceCm = r(along(sim, x0), 2);
    for (;;) yield;
  })();
  run(sim, script, seconds(5), recorder);
  const out = { liftDeg, stop, ...info, heldAtEnd: sim.grasp.heldId, events: events(sim), ...recorder.summary() };
  sim.dispose();
  return out;
}

/**
 * 5: drive the held cube into a wall at ~0.4 m/s (duty 226 after a 60 cm run-up). Grasped at u 4 the cube sticks 0.5 cm past the
 * fingertips and meets the wall first; grasped at u 3 the fingertips do.
 */
export function scenarioWall(config: Config, liftDeg: number, after: 'push' | 'coast-on-contact', graspU = 4): Outcome {
  const wallX = START.xCm + tipX(0) + graspU + 8 + 60;
  const arena: ArenaInput = { ground: ground([250, 100]), walls: [{ id: 'wall', fromCm: [wallX + 1, 10], toCm: [wallX + 1, 90] }], objects: [cube('cube', START.xCm + tipX(0) + graspU + 8, 15)] };
  const sim = newSim(config, arena);
  const recorder = createRecorder(sim, 'cube');
  const info: Record<string, unknown> = {};
  let wallCollider: ReturnType<Sim['world']['getCollider']> | null = null;
  for (const [handle, c] of sim.arena.colliders) if (c.id === 'wall') wallCollider = sim.world.getCollider(handle);
  const touchesWall = () => {
    let touch = false;
    for (const collider of [...sim.gripper.colliders, sim.object('cube').collider, sim.robot.chassis.collider(0)]) {
      sim.world.contactPair(collider, wallCollider!, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactImpulse(i) > 0 || manifold.contactDist(i) <= 0.0005) touch = true;
      });
    }
    return touch;
  };
  let impact = -1;
  const pitchLog: { tick: number; pitch: number; w: number }[] = [];
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 0, u: graspU });
    info.attachU = r(sim.grasp.view(sim.object('cube')).u);
    sim.gripper.setLift(liftDeg);
    yield* wait(seconds(0.5));
    sim.drive(forward(226));
    let speed = 0;
    yield* until(() => {
      if (touchesWall()) return true;
      speed = Math.abs(sim.robot.linvel().x);
      return false;
    }, seconds(4));
    impact = sim.tick;
    info.speedBeforeImpactMS = r(speed, 4);
    recorder.setWindow(sim.tick, sim.tick + seconds(1.5));
    if (after === 'coast-on-contact') sim.drive(COAST);
    yield* wait(seconds(1.5));
    sim.drive(COAST);
    for (;;) yield;
  })();
  run(sim, script, seconds(6), recorder, () => {
    if (impact >= 0 && sim.tick <= impact + seconds(1.5)) {
      const w = sim.robot.chassis.angvel();
      pitchLog.push({ tick: sim.tick, pitch: pitchRollDeg(sim.robot.chassis.rotation()).pitch, w: Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z) });
    }
  });
  // Settled: from this tick on (within the 1.5 s window), pitch within 0.2° of its final value and |ω| ≤ 0.05 rad/s.
  const final = pitchLog.length > 0 ? pitchLog[pitchLog.length - 1]!.pitch : 0;
  let settled = -1;
  for (let i = pitchLog.length - 1; i >= 0; i--) {
    if (Math.abs(pitchLog[i]!.pitch - final) > 0.2 || pitchLog[i]!.w > 0.05) break;
    settled = pitchLog[i]!.tick;
  }
  const out = {
    liftDeg,
    after,
    graspU,
    ...info,
    impactT: r(impact * DT),
    settleAfterImpactS: settled < 0 ? null : r((settled - impact) * DT),
    pitchAtWindowEnd: r(final),
    heldAtEnd: sim.grasp.heldId,
    events: events(sim),
    ...recorder.summary(),
  };
  sim.dispose();
  return out;
}

/** 6: grasp at lift 10° (the cube's centre below the carriage's), then command lift 0°: the cube meets the floor first. */
export function scenarioPress(config: Config): Outcome {
  const arena: ArenaInput = { ground: ground([200, 100]), objects: [cube('cube', START.xCm + tipX(10) + 3 + 8, 15)] };
  const sim = newSim(config, arena);
  const recorder = createRecorder(sim, 'cube');
  const info: Record<string, unknown> = {};
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 10, u: 3 });
    info.attachW = r(sim.grasp.view(sim.object('cube')).w);
    sim.gripper.setLift(60);
    yield* wait(seconds(0.5));
    recorder.setWindow(sim.tick, sim.tick + seconds(2.5));
    sim.gripper.setLift(0); // the press
    yield* wait(seconds(2.5));
    info.liftReachedDeg = r(sim.gripper.liftDeg());
    for (;;) yield;
  })();
  run(sim, script, seconds(6), recorder);
  const out = { ...info, heldAtEnd: sim.grasp.heldId, events: events(sim), ...recorder.summary() };
  sim.dispose();
  return out;
}

/** 7: lift so the held cube's bottom is ~1 cm above the floor, release; tilt after landing. */
export function scenarioDrop(config: Config): Outcome {
  const arena: ArenaInput = { ground: ground([200, 100]), objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, 15)] };
  const sim = newSim(config, arena);
  const recorder = createRecorder(sim, 'cube');
  const info: Record<string, unknown> = {};
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
    sim.gripper.setLift(90);
    yield* wait(seconds(0.5));
    sim.gripper.setLift(14); // bottom = 3.214 + 5·sin(14° − 40°) − 0.31 + 0.31 ≈ 1.02 cm (grasped at w ≈ +0.31)
    yield* wait(seconds(0.6));
    info.bottomBeforeReleaseCm = r(sim.object('cube').body.translation().y * 100 - 2);
    sim.gripper.setClaw(0);
    yield* wait(seconds(1.0));
    info.tiltAfterLandingDeg = r(tiltDeg(sim, 'cube'));
    info.cubeAfter = cubePose(sim, 'cube');
    for (;;) yield;
  })();
  run(sim, script, seconds(5), recorder);
  const out = { ...info, tiltEndDeg: r(tiltDeg(sim, 'cube')), events: events(sim), ...recorder.summary() };
  sim.dispose();
  return out;
}

/** 8: carry the cube at a lift angle over a 6×6×4 cm 40 g base, release; offset and tilt on the base. */
export function scenarioStack(config: Config, liftDeg: number): Outcome {
  const cubeX = START.xCm + tipX(0) + 3 + 8;
  const baseX = cubeX + 40;
  const arena: ArenaInput = {
    ground: ground([200, 100]),
    objects: [cube('cube', cubeX, 15), { shape: 'box', id: 'base', centerCm: [baseX, 50], sizeCm: [6, 6, 4], massG: 40 }],
  };
  const sim = newSim(config, arena);
  const recorder = createRecorder(sim, 'cube');
  const info: Record<string, unknown> = { heldCubeHitBase: false };
  const base0 = { x: 0, z: 0 };
  const script = (function* (): Script {
    yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
    sim.gripper.setLift(liftDeg);
    yield* wait(seconds(0.6));
    info.heldBottomCm = r(sim.object('cube').body.translation().y * 100 - 2);
    const b = sim.object('base').body.translation();
    base0.x = b.x;
    base0.z = b.z;
    sim.drive(forward(140));
    yield* until(() => {
      sim.world.contactPair(sim.object('cube').collider, sim.object('base').collider, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactImpulse(i) > 0 || manifold.contactDist(i) <= 0.0005) info.heldCubeHitBase = true;
      });
      return sim.object('cube').body.translation().x >= base0.x - 0.006;
    }, seconds(5));
    sim.drive(BRAKE);
    yield* wait(seconds(0.5));
    const bb = sim.object('base').body.translation();
    info.baseMovedBeforeReleaseCm = r(Math.sqrt((bb.x - base0.x) ** 2 + (bb.z - base0.z) ** 2) * 100);
    info.cubeOverBaseBeforeReleaseCm = r(Math.abs(sim.object('cube').body.translation().x - bb.x) * 100);
    sim.gripper.setClaw(0);
    yield* wait(seconds(0.6));
    yield* driveCm(sim, -8, 90);
    yield* wait(seconds(1.0));
    for (;;) yield;
  })();
  run(sim, script, seconds(9), recorder);
  const c = sim.object('cube').body.translation();
  const b = sim.object('base').body.translation();
  const out = {
    liftDeg,
    ...info,
    offsetCm: r(Math.sqrt((c.x - b.x) ** 2 + (c.z - b.z) ** 2) * 100),
    cubeOnBase: c.y * 100 > 5.5,
    cubeZCm: r(c.y * 100),
    cubeTiltDeg: r(tiltDeg(sim, 'cube')),
    baseMovedCm: r(Math.sqrt((b.x - base0.x) ** 2 + (b.z - base0.z) ** 2) * 100),
    baseTiltDeg: r(tiltDeg(sim, 'base')),
    events: events(sim),
    ...recorder.summary(),
  };
  sim.dispose();
  return out;
}

/** Robustness: scenario 1 with the cube placed off its spot (dx along the approach, dy across), 15 g and 50 g. */
export function robustness(config: Config): Outcome[] {
  const rows: Outcome[] = [];
  for (const massG of [15, 50]) {
    for (const offset of [[-2, 0], [-1, 0], [1, 0], [2, 0], [0, -0.5], [0, 0.5], [0, -1], [0, 1]] as const) {
      const o = scenarioCarry(config, massG, true, offset) as Record<string, unknown>;
      const all = o.all as Record<string, number>;
      rows.push({ massG, offsetCm: offset, events: (o.events as { kind: string }[]).map((e) => e.kind).join(','), maxPitch: all.maxPitch, casterTicksOff: all.casterTicksOff, maxLevel: o.maxLevel, penClosingMm: o.penClosingMm, penHeldMm: o.penHeldMm, jitterMm: o.jitterMm, cubeEnd: o.cubeEnd, cubeTiltEndDeg: o.cubeTiltEndDeg });
    }
  }
  return rows;
}

/** Carriage level over lift angles: at rest after each move (static) and the most during the move, empty and holding 50 g. */
export function levelSweep(config: Config): Outcome {
  const out: Record<string, unknown> = {};
  for (const massG of [0, 50]) {
    const arena: ArenaInput = { ground: ground([200, 100]), objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, massG === 0 ? 15 : 50)] };
    const sim = newSim(config, arena);
    const rows: unknown[] = [];
    const script = (function* (): Script {
      if (massG > 0) yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
      else yield* wait(1);
      let previous = sim.gripper.liftCommandDeg;
      for (const lift of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 45, 0]) {
        sim.gripper.setLift(lift);
        let moving = 0;
        let over = 0;
        let reach = -1;
        for (let i = 0; i < seconds(0.5); i++) {
          yield;
          moving = Math.max(moving, Math.abs(sim.gripper.carriageLevelErrorDeg()));
          const l = sim.gripper.liftDeg();
          over = Math.max(over, lift >= previous ? l - lift : lift - l);
          if (reach < 0 && Math.abs(l - lift) < 0.5) reach = i + 1;
        }
        rows.push({ lift, restLevelDeg: r(sim.gripper.carriageLevelErrorDeg(), 4), maxLevelMovingDeg: r(moving), liftErrorDeg: r(sim.gripper.liftDeg() - lift), overshootDeg: r(over), reachTicks: reach });
        previous = lift;
      }
    })();
    for (let t = 0; t < seconds(0.35 + 4 + 1.1) + 12 * seconds(0.5) + 5; t++) {
      if (script.next().done === true) break;
      sim.step();
    }
    out[massG === 0 ? 'empty' : 'held50g'] = { held: sim.grasp.heldId, rows };
    sim.dispose();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Cost: ms/tick of scenario 1, gripper world vs rover worlds (same motor commands)

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const batch: number[] = [];
  for (let i = 0; i + 10 <= samples.length; i += 10) batch.push(samples.slice(i, i + 10).reduce((a, b) => a + b, 0) / 10);
  const bs = batch.sort((a, b) => a - b);
  return { median: r(q(0.5), 4), p95: r(q(0.95), 4), mean: r(samples.reduce((a, b) => a + b, 0) / samples.length, 4), batch10Median: r(bs[Math.floor(bs.length / 2)]!, 4), batch10P95: r(bs[Math.floor(bs.length * 0.95)]!, 4) };
}

/** Times scenario 1's 3000 ticks (step only) for a config, after a warm-up run. Records the drive commands for the rover replay. */
export function timeCarry(config: Config, now: () => number) {
  const one = () => {
    const arena: ArenaInput = { ground: ground([200, 100]), objects: [cube('cube', START.xCm + tipX(0) + 3 + 8, 15)] };
    const sim = newSim(config, arena);
    const commands: MotorCommand[] = [];
    let current: MotorCommand = COAST;
    const drive = sim.drive.bind(sim);
    (sim as { drive: Sim['drive'] }).drive = (command) => {
      current = command;
      drive(command);
    };
    const script = (function* (): Script {
      yield* pick(sim, 'cube', { liftDeg: 0, u: 3 });
      sim.gripper.setLift(90);
      yield* wait(seconds(0.5));
      yield* driveCm(sim, 50, 200);
      yield* wait(seconds(0.6));
      sim.gripper.setLift(0);
      yield* wait(seconds(0.5));
      sim.gripper.setClaw(0);
      yield* wait(seconds(0.4));
      yield* driveCm(sim, -10, 120);
      for (;;) yield;
    })();
    const samples: number[] = [];
    for (let t = 0; t < S1_TICKS; t++) {
      script.next();
      commands.push(current);
      const t0 = now();
      sim.step();
      samples.push(now() - t0);
    }
    sim.dispose();
    return { samples, commands };
  };
  one();
  const { samples, commands } = one();
  return { stats: stats(samples), commands };
}

/** The rover baseline with the same builders (physics only), replaying the commands. */
export function timeRover(commands: readonly MotorCommand[], now: () => number) {
  const one = () => {
    const sim = createRoverSim({ ground: ground([200, 100]), objects: [cube('cube', START.xCm + 60, 15)] }, START);
    const samples: number[] = [];
    for (const command of commands) {
      sim.drive(command);
      const t0 = now();
      sim.step();
      samples.push(now() - t0);
    }
    sim.dispose();
    return samples;
  };
  one();
  return stats(one());
}

/** Production's whole rover world (world.ts: sensors, contacts, measures each tick), replaying the commands. */
export async function timeProductionRover(commands: readonly MotorCommand[], now: () => number) {
  const one = async () => {
    const world = await createWorld({ arena: parseArena({ ground: ground([200, 100]), objects: [cube('cube', START.xCm + 60, 15)] }), start: START, kit: roverKit(), seed: 1 });
    const samples: number[] = [];
    for (const command of commands) {
      world.applyActuators({ motors: { motorLeft: command, motorRight: command } });
      const t0 = now();
      world.step(DT);
      samples.push(now() - t0);
    }
    world.dispose();
    return samples;
  };
  await one();
  return stats(await one());
}

// ---------------------------------------------------------------------------------------------------------------------------
// Entry points

/** Determinism: scenario 1 (3000 ticks), each config, twice in this runtime. */
export function runHashes() {
  const out: Record<string, unknown> = {};
  for (const config of CONFIGS) {
    const a = scenarioCarry(config, 15, false).hash;
    const b = scenarioCarry(config, 15, false).hash;
    out[config.name] = { run1: a, run2: b, equal: a.trajBits === b.trajBits && a.finalQ6 === b.finalQ6 };
  }
  return out;
}

export function runAll(now: () => number) {
  const scenarios: Record<string, unknown> = {};
  for (const config of CONFIGS) {
    scenarios[config.name] = {
      s1Carry15g: scenarioCarry(config, 15),
      s2Carry50g: scenarioCarry(config, 50),
      s3TooHeavy60g: scenarioTooHeavy(config),
      s4Brake90: scenarioBrake(config, 90, 'brake'),
      s4Brake45: scenarioBrake(config, 45, 'brake'),
      s4Coast90: scenarioBrake(config, 90, 'coast'),
      s5Wall45Push: scenarioWall(config, 45, 'push'),
      s5Wall90Push: scenarioWall(config, 90, 'push'),
      s5Wall45CoastOnContact: scenarioWall(config, 45, 'coast-on-contact'),
      s5Wall90CoastOnContact: scenarioWall(config, 90, 'coast-on-contact'),
      s5Wall45FingersFirstPush: scenarioWall(config, 45, 'push', 3),
      s6Press: scenarioPress(config),
      s7Drop: scenarioDrop(config),
      s8Stack45: scenarioStack(config, 45),
      s8Stack55: scenarioStack(config, 55),
      levelSweep: levelSweep(config),
      robustness: robustness(config),
    };
  }
  // Scenario 3 with friction on the solid fingers: does a too-heavy cube get carried by friction alone?
  scenarios['tuned-collider-friction0.6'] = { s3TooHeavy60g: scenarioTooHeavy({ ...TUNED_COLLIDER, name: 'tuned-collider-f0.6', fingerFriction: GRIPPER_SPEC.jawFriction }) };
  const cost: Record<string, unknown> = {};
  let commands: MotorCommand[] = [];
  for (const config of CONFIGS) {
    const timed = timeCarry(config, now);
    cost[config.name] = timed.stats;
    commands = timed.commands;
  }
  cost.roverPhysics = timeRover(commands, now);
  return { constants: { squeezeN: r(SQUEEZE_N), breakForceN: r(BREAK_FORCE_N) }, hashes: runHashes(), scenarios, cost, commands };
}
