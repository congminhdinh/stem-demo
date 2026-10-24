// Procedural line path + replay poses. Units: metres, y up, the robot's forward axis is local +x.
export interface Pt {
  x: number;
  z: number;
}

export const ARENA = 2; // the arena is ARENA x ARENA metres, centred on the origin
export const TICKS = 1000;
export const TICK_HZ = 100; // 1 000 ticks = 10 s of virtual time
export const WHEEL_RADIUS = 0.033;
export const TRACK = 0.14; // distance between the wheels

/** A closed rounded-rectangle loop, resampled to `samples` equally spaced points. */
export function linePath(samples = 400): Pt[] {
  const a = 0.68; // half extent in x
  const b = 0.5; // half extent in z
  const r = 0.28; // corner radius
  const dense: Pt[] = [];
  const corner = (cx: number, cz: number, from: number) => {
    for (let i = 0; i <= 16; i += 1) {
      const t = from + (i / 16) * (Math.PI / 2);
      dense.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t) });
    }
  };
  // Clockwise when seen from above (+y), starting at the +x side.
  corner(a - r, b - r, 0); // bottom-right corner
  corner(-(a - r), b - r, Math.PI / 2);
  corner(-(a - r), -(b - r), Math.PI);
  corner(a - r, -(b - r), (3 * Math.PI) / 2);
  dense.push({ ...dense[0]! });
  const cumulative = [0];
  for (let i = 1; i < dense.length; i += 1) {
    const p = dense[i - 1]!;
    const q = dense[i]!;
    cumulative.push(cumulative[i - 1]! + Math.hypot(q.x - p.x, q.z - p.z));
  }
  const total = cumulative[cumulative.length - 1]!;
  const out: Pt[] = [];
  let seg = 1;
  for (let i = 0; i < samples; i += 1) {
    const s = (i / samples) * total;
    while (cumulative[seg]! < s) seg += 1;
    const p = dense[seg - 1]!;
    const q = dense[seg]!;
    const k = (s - cumulative[seg - 1]!) / (cumulative[seg]! - cumulative[seg - 1]!);
    out.push({ x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k });
  }
  return out;
}

export const POSE_STRIDE = 5; // x, z, heading (rotation about y), left wheel angle, right wheel angle

/**
 * 1 000 recorded poses of a differential-drive robot following the line once around. Tick TICKS - 1 is one step
 * before tick 0, so the replay loops without a jump. No physics: pure kinematics.
 */
export function generatePoses(): Float32Array {
  const path = linePath(TICKS);
  const poses = new Float32Array(TICKS * POSE_STRIDE);
  const dt = 1 / TICK_HZ;
  let left = 0;
  let right = 0;
  let prevPhi = 0;
  for (let i = 0; i < TICKS; i += 1) {
    const p = path[i]!;
    const q = path[(i + 1) % TICKS]!;
    const phi = Math.atan2(-(q.z - p.z), q.x - p.x); // local +x -> (cos phi, 0, -sin phi)
    const step = Math.hypot(q.x - p.x, q.z - p.z);
    const dPhi = Math.atan2(Math.sin(phi - prevPhi), Math.cos(phi - prevPhi));
    const v = step / dt;
    const omega = i === 0 ? 0 : dPhi / dt;
    // Left wheel is at local -z, right at +z. A positive omega (turning left) slows the left wheel.
    left += ((v - (omega * TRACK) / 2) * dt) / WHEEL_RADIUS;
    right += ((v + (omega * TRACK) / 2) * dt) / WHEEL_RADIUS;
    prevPhi = phi;
    poses.set([p.x, p.z, phi, left, right], i * POSE_STRIDE);
  }
  return poses;
}
