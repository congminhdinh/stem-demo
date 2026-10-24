// R0.1 measurement scenarios. Every scenario is open-loop or closed-loop on trig-free
// quantities; trig is used only to report angles.
import {
  createSim, DT, FNV_OFFSET, hashBits, hashQ6, hex, ROBOT, rotate, tiltDegOf, yawMinus45, yawOf,
  type DriveModel, type Rapier, type Sim, type SimOptions, type Tuning,
} from './sim.ts';

const DEG = 180 / Math.PI;
const round = (v: number, d = 3) => Number(v.toFixed(d));
const DRIVE_W = 10; // rad/s wheel target: 0.33 m/s ground speed
const SPIN_W = 6; // rad/s wheel target for spins
/** Open-loop ticks for a 90 deg in-place spin from kinematics: (pi/2)*(track/2)/(r*w). */
export const SPIN_TICKS = Math.round(((Math.PI / 2) * (ROBOT.track / 2)) / (ROBOT.wheelRadius * SPIN_W) / DT);

type Common = { model: DriveModel; tuning?: Tuning } & Partial<Pick<SimOptions, "motorFactor" | "wheelShape" | "motorModel" | "raycast">>;

/** 0.5 s with zero targets so the robot rests on its supports before a test starts. */
function settle(sim: Sim): Sim {
  for (let i = 0; i < 60; i++) sim.step();
  return sim;
}

function unwrap(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Straight 2 m along the arena diagonal (start heading -45 deg via sqrt-only quaternion). */
export function straight2m(R: Rapier, c: Common) {
  const q = yawMinus45();
  const sim = settle(createSim(R, { ...c, start: { x: -0.85, z: -0.85, q } }));
  const p0 = sim.chassis.translation();
  const dir = { x: Math.sqrt(0.5), z: Math.sqrt(0.5) };
  let ticks = 0, maxCross = 0, yMin = Infinity, yMax = -Infinity, maxTilt = 0;
  sim.setWheelTargets(DRIVE_W, DRIVE_W);
  let along = 0;
  while (along < 2 && ticks < 2000) {
    sim.step();
    ticks++;
    const p = sim.chassis.translation();
    along = (p.x - p0.x) * dir.x + (p.z - p0.z) * dir.z;
    const cross = (p.x - p0.x) * dir.z - (p.z - p0.z) * dir.x;
    maxCross = Math.max(maxCross, Math.abs(cross));
    if (ticks > 60) {
      // steady state: after the first 0.5 s
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
      maxTilt = Math.max(maxTilt, tiltDegOf(sim.chassis.rotation()));
    }
  }
  const tReach = ticks * DT;
  sim.setWheelTargets(0, 0);
  for (let i = 0; i < 60; i++) sim.step();
  const p = sim.chassis.translation();
  const res = {
    reached: along >= 2,
    timeTo2mS: round(tReach, 3),
    avgSpeedMs: round(2 / tReach, 4),
    idealSpeedMs: round(DRIVE_W * ROBOT.wheelRadius, 4),
    crossTrackMaxMm: round(maxCross * 1000, 3),
    headingErrDeg: round(unwrap(yawOf(sim.chassis.rotation()) - yawOf(q)) * DEG, 4),
    coastAfterStopMm: round(((p.x - p0.x) * dir.x + (p.z - p0.z) * dir.z - along) * 1000, 2),
    bounceYRangeMm: round((yMax - yMin) * 1000, 4),
    maxTiltDeg: round(maxTilt, 3),
  };
  sim.dispose();
  return res;
}

/** 10 open-loop in-place spins of SPIN_TICKS at +-SPIN_W, 0.25 s pause after each. */
export function spin90x10(R: Rapier, c: Common) {
  const sim = settle(createSim(R, { ...c, start: { x: 0, z: 0 } }));
  const c0 = sim.axleCenter();
  let prev = yawOf(sim.chassis.rotation());
  const angles: number[] = [];
  let maxDrift = 0;
  for (let k = 0; k < 10; k++) {
    sim.setWheelTargets(-SPIN_W, SPIN_W);
    for (let i = 0; i < SPIN_TICKS; i++) sim.step();
    sim.setWheelTargets(0, 0);
    for (let i = 0; i < 30; i++) sim.step();
    const yaw = yawOf(sim.chassis.rotation());
    angles.push(unwrap(yaw - prev) * DEG);
    prev = yaw;
    const a = sim.axleCenter();
    maxDrift = Math.max(maxDrift, Math.sqrt((a.x - c0.x) ** 2 + (a.z - c0.z) ** 2));
  }
  const mean = angles.reduce((s, v) => s + v, 0) / angles.length;
  const res = {
    spinTicks: SPIN_TICKS,
    anglesDeg: angles.map((a) => round(a, 4)),
    meanDeg: round(mean, 4),
    repeatErrMaxDeg: round(Math.max(...angles.map((a) => Math.abs(a - mean))), 4),
    absErrMaxDeg: round(Math.max(...angles.map((a) => Math.abs(a - 90))), 4),
    totalDeg: round(angles.reduce((s, v) => s + v, 0), 3),
    centerDriftMm: round(maxDrift * 1000, 3),
  };
  sim.dispose();
  return res;
}

/** Push a 100 g, 10 cm box: 3 s at DRIVE_W, then 1 s stop. */
export function pushBox(R: Rapier, c: Common) {
  const sim = settle(createSim(R, { ...c, start: { x: -0.6, z: 0 }, box: { x: -0.3, z: 0 } }));
  const box = sim.box!;
  const b0 = box.translation();
  let maxBoxTilt = 0, maxBoxLift = 0, maxBoxSpeed = 0, robotSpeedSum = 0, n = 0;
  sim.setWheelTargets(DRIVE_W, DRIVE_W);
  for (let i = 0; i < 360; i++) {
    sim.step();
    const bv = box.linvel();
    maxBoxSpeed = Math.max(maxBoxSpeed, Math.sqrt(bv.x * bv.x + bv.z * bv.z));
    maxBoxTilt = Math.max(maxBoxTilt, tiltDegOf(box.rotation()));
    maxBoxLift = Math.max(maxBoxLift, box.translation().y - b0.y);
    if (i >= 240) {
      const v = sim.chassis.linvel();
      robotSpeedSum += Math.sqrt(v.x * v.x + v.z * v.z);
      n++;
    }
  }
  sim.setWheelTargets(0, 0);
  for (let i = 0; i < 120; i++) sim.step();
  const b = box.translation();
  const p = sim.chassis.translation();
  const res = {
    boxDxMm: round((b.x - b0.x) * 1000, 2),
    boxDzMm: round((b.z - b0.z) * 1000, 2),
    boxMaxTiltDeg: round(maxBoxTilt, 3),
    boxMaxLiftMm: round(maxBoxLift * 1000, 3),
    boxMaxSpeedMs: round(maxBoxSpeed, 4),
    robotPushSpeedMs: round(robotSpeedSum / n, 4),
    gapAfterMm: round((b.x - 0.05 - (p.x + ROBOT.bodyHalf.x)) * 1000, 2),
    robotHeadingDeg: round(yawOf(sim.chassis.rotation()) * DEG, 4),
  };
  sim.dispose();
  return res;
}

/** Robot idle for 3 s: settle 1 s, then measure 2 s. Also the wheel-speed step response. */
export function idleJitter(R: Rapier, c: Common) {
  const sim = createSim(R, { ...c, start: { x: 0, z: 0 } });
  for (let i = 0; i < 120; i++) sim.step();
  const p0 = sim.chassis.translation();
  // Speeds by finite differences of the pose: the raycast chassis' linvel() is not the
  // velocity its position actually moves with (see ADR), so linvel() is not comparable.
  let prevP = p0, prevQ = sim.chassis.rotation();
  let maxV = 0, maxW = 0, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < 240; i++) {
    sim.step();
    const p = sim.chassis.translation(), q = sim.chassis.rotation();
    const dx = p.x - prevP.x, dy = p.y - prevP.y, dz = p.z - prevP.z;
    maxV = Math.max(maxV, Math.sqrt(dx * dx + dy * dy + dz * dz) / DT);
    // small-angle rotation between ticks: 2 * |vector part of conj(prevQ) * q|
    const a = prevQ;
    const rx = a.w * q.x - a.x * q.w - a.y * q.z + a.z * q.y;
    const ry = a.w * q.y + a.x * q.z - a.y * q.w - a.z * q.x;
    const rz = a.w * q.z - a.x * q.y + a.y * q.x - a.z * q.w;
    maxW = Math.max(maxW, (2 * Math.sqrt(rx * rx + ry * ry + rz * rz)) / DT);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
    prevP = p;
    prevQ = q;
  }
  const p1 = sim.chassis.translation();
  // step response: ticks until the mean wheel speed reaches 90 % of a 10 rad/s target
  sim.setWheelTargets(DRIVE_W, DRIVE_W);
  let t90 = -1;
  for (let i = 1; i <= 240 && t90 < 0; i++) {
    sim.step();
    const [l, r] = sim.wheelSpeeds();
    if ((l + r) / 2 >= 0.9 * DRIVE_W) t90 = i;
  }
  const res = {
    restHeightMm: round(p1.y * 1000, 3),
    maxSpeedMmS: round(maxV * 1000, 5),
    maxAngSpeedDegS: round(maxW * DEG, 5),
    driftUm: round(Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2) * 1e6, 3),
    yRangeUm: round((yMax - yMin) * 1e6, 3),
    stepResponse90Ms: t90 < 0 ? null : round(t90 * DT * 1000, 1),
  };
  sim.dispose();
  return res;
}

// ---------- determinism scenario ----------
type Segment = [ticks: number, left: number, right: number];
/** Forward 2 s, 10 x 90 deg spins, then drive back into the box and push it to the wall, idle. */
export const HASH_SCRIPT: Segment[] = [
  [240, DRIVE_W, DRIVE_W],
  [30, 0, 0],
  ...Array.from({ length: 10 }, () => [
    [SPIN_TICKS, -SPIN_W, SPIN_W],
    [15, 0, 0],
  ] as Segment[]).flat(),
  [600, DRIVE_W, DRIVE_W],
];
export const HASH_TICKS = 3000;

export type HashRun = {
  model: DriveModel;
  ticks: number;
  finalQ6: string;
  trajQ6: string;
  trajBits: string;
  finalPoses: number[][];
  stallMaxSpeedMmS: number;
  msPerTick: { median: number; p95: number; mean: number; batch10Median: number; batch10P95: number };
  timerResolutionMs: number;
};

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** Runs HASH_SCRIPT then idles until HASH_TICKS; times every tick (drive update + world.step). */
export function hashRun(R: Rapier, c: Common, now: () => number): HashRun {
  const sim: Sim = createSim(R, { ...c, start: { x: -0.2, z: 0 }, box: { x: -0.55, z: 0 } });
  const plan: [number, number][] = [];
  for (const [n, l, r] of HASH_SCRIPT) for (let i = 0; i < n; i++) plan.push([l, r]);
  let traj = FNV_OFFSET, bits = FNV_OFFSET;
  const tick: number[] = [];
  const batch: number[] = [];
  let last: [number, number] | null = null;
  let stallMax = 0;
  let bStart = now();
  for (let t = 0; t < HASH_TICKS; t++) {
    const cmd = plan[t] ?? [0, 0];
    const t0 = now();
    if (!last || last[0] !== cmd[0] || last[1] !== cmd[1]) sim.setWheelTargets(cmd[0], cmd[1]);
    last = cmd;
    sim.step();
    const t1 = now();
    tick.push(t1 - t0);
    if (t % 10 === 9) {
      batch.push((t1 - bStart) / 10);
      bStart = now();
    }
    traj = hashQ6(traj, sim.dynamicBodies);
    bits = hashBits(bits, sim.dynamicBodies);
    if (t >= HASH_TICKS - 600) {
      // last 5 s: robot idle against the box against the wall
      for (const b of sim.dynamicBodies) {
        const v = b.linvel();
        stallMax = Math.max(stallMax, Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z));
      }
    }
  }
  const finalPoses = sim.dynamicBodies.map((b) => {
    const p = b.translation(), q = b.rotation();
    return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
  });
  const res: HashRun = {
    model: c.model,
    ticks: HASH_TICKS,
    finalQ6: hex(hashQ6(FNV_OFFSET, sim.dynamicBodies)),
    trajQ6: hex(traj),
    trajBits: hex(bits),
    finalPoses,
    stallMaxSpeedMmS: round(stallMax * 1000, 4),
    msPerTick: stats(tick, batch),
    timerResolutionMs: resolution(tick),
  };
  sim.dispose();
  return res;
}

function stats(tick: number[], batch: number[]) {
  const s = [...tick].sort((a, b) => a - b);
  const sb = [...batch].sort((a, b) => a - b);
  return {
    median: round(quantile(s, 0.5), 4),
    p95: round(quantile(s, 0.95), 4),
    mean: round(tick.reduce((a, b) => a + b, 0) / tick.length, 4),
    batch10Median: round(quantile(sb, 0.5), 4),
    batch10P95: round(quantile(sb, 0.95), 4),
  };
}

function resolution(samples: number[]): number {
  let min = Infinity;
  for (const v of samples) if (v > 0 && v < min) min = v;
  return round(min, 4);
}

/** Bit-level hash of Math.sin/cos/atan2/pow/exp/hypot/sqrt on 20 000 pseudo-random inputs. */
export function trigProbe() {
  const f64 = new Float64Array(1);
  const w = new Uint32Array(f64.buffer);
  const fns: Record<string, (x: number, y: number) => number> = {
    sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), atan2: (x, y) => Math.atan2(x, y),
    pow: (x, y) => Math.pow(Math.abs(x), y / 3), exp: (x) => Math.exp(x), hypot: (x, y) => Math.hypot(x, y),
    sqrt: (x) => Math.sqrt(Math.abs(x)),
  };
  const out: Record<string, string> = {};
  for (const [name, fn] of Object.entries(fns)) {
    let seed = 12345, h = FNV_OFFSET;
    for (let i = 0; i < 20000; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const x = (seed / 4294967296) * 20 - 10;
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const y = (seed / 4294967296) * 20 - 10;
      f64[0] = fn(x, y);
      for (const part of [w[0]!, w[1]!]) {
        for (let k = 0; k < 4; k++) {
          h ^= (part >>> (k * 8)) & 0xff;
          h = Math.imul(h, 0x01000193) >>> 0;
        }
      }
    }
    out[name] = hex(h);
  }
  return out;
}

export function allMetrics(R: Rapier, c: Common) {
  return { straight: straight2m(R, c), spin: spin90x10(R, c), push: pushBox(R, c), idle: idleJitter(R, c) };
}
