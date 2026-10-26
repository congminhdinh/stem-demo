// N19 G0.1 exploration (`node spikes/n19-grasp/node-run.ts trace` -> results/trace.json): how the lift moves, stops and sags and how
// level the carriage stays, for the control laws, link modes, extra iterations and rotor inertias tried, empty (moves 90→0, 0→90,
// 90→40, 40→45, 45→0) and holding 50 g (levelSweep). The configuration chosen from it is scenarios.ts TUNED_COLLIDER.
import type { GripperOptions, LinkMode, ServoLaw } from './gripper';
import { levelSweep, TUNED_COLLIDER, type Config } from './scenarios';
import { createSim } from './sim';

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
type Variant = { name: string; law: ServoLaw; link: LinkMode; tuning: NonNullable<GripperOptions['tuning']> };
const VARIANTS: Variant[] = [
  { name: 'plan §4.4 (servo, hold-motor, +4 PGS)', law: 'servo', link: 'hold-motor', tuning: { extraPgs: 4 } },
  { name: 'servo, chassis-lock, +4 PGS', law: 'servo', link: 'chassis-lock', tuning: { extraPgs: 4 } },
  { name: 'brake, chassis-lock, +4 PGS', law: 'servo-brake', link: 'chassis-lock', tuning: { extraPgs: 4, decelFactor: 0.5 } },
  { name: 'brake, chassis-lock, +16 PGS', law: 'servo-brake', link: 'chassis-lock', tuning: { extraPgs: 16, decelFactor: 0.5 } },
  { name: 'brake, chassis-lock, +8 PGS +4 solver', law: 'servo-brake', link: 'chassis-lock', tuning: { extraPgs: 8, extraSolver: 4, decelFactor: 0.5 } },
  { name: 'brake, hold-motor, J 1e-4, +4 PGS', law: 'servo-brake', link: 'hold-motor', tuning: { extraPgs: 4, boomRotorInertia: 1e-4, decelFactor: 0.5 } },
  { name: 'brake, chassis-lock, J 1e-4, +4 PGS', law: 'servo-brake', link: 'chassis-lock', tuning: { extraPgs: 4, boomRotorInertia: 1e-4, decelFactor: 0.5 } },
  { name: 'brake, chassis-lock, J 5e-5, +4 PGS', law: 'servo-brake', link: 'chassis-lock', tuning: { extraPgs: 4, boomRotorInertia: 5e-5, decelFactor: 0.5 } },
  { name: 'brake, chassis-lock, J 5e-5, +8 PGS', law: 'servo-brake', link: 'chassis-lock', tuning: { extraPgs: 8, boomRotorInertia: 5e-5, decelFactor: 0.5 } },
  { name: 'chosen: brake, chassis-lock, J 5e-5, +8 PGS +4 solver', law: TUNED_COLLIDER.law, link: TUNED_COLLIDER.link, tuning: TUNED_COLLIDER.tuning },
];

function emptyMoves(v: Variant) {
  const sim = createSim({ law: v.law, link: v.link, tuning: v.tuning, arena: { ground: { sizeCm: [200, 100], color: '#ffffff' } }, start: { xCm: 50, yCm: 50, yawDeg: 0 }, fingers: 'collider', fingerFriction: 0 });
  for (let i = 0; i < 60; i++) sim.step();
  const out: Record<string, unknown> = { sagAt90Deg: r(sim.gripper.liftDeg() - 90), restLevelAt90Deg: r(sim.gripper.carriageLevelErrorDeg(), 4) };
  for (const [from, to] of [[90, 0], [0, 90], [90, 40], [40, 45], [45, 0]] as const) {
    sim.gripper.setLift(to);
    let over = 0;
    let level = 0;
    let reach = -1;
    for (let i = 0; i < 60; i++) {
      sim.step();
      const lift = sim.gripper.liftDeg();
      over = Math.max(over, to > from ? lift - to : to - lift);
      level = Math.max(level, Math.abs(sim.gripper.carriageLevelErrorDeg()));
      if (reach < 0 && Math.abs(lift - to) < 0.5) reach = i + 1;
    }
    out[`${from}->${to}`] = { reachTicks: reach, overshootDeg: r(over), endErrorDeg: r(sim.gripper.liftDeg() - to), maxLevelDeg: r(level), endLevelDeg: r(sim.gripper.carriageLevelErrorDeg(), 4) };
  }
  sim.dispose();
  return out;
}

export function trace() {
  return VARIANTS.map((v) => {
    const config: Config = { name: v.name, law: v.law, link: v.link, fingers: 'collider', fingerFriction: 0, tuning: v.tuning };
    const held = (levelSweep(config) as { held50g: { rows: { restLevelDeg: number; maxLevelMovingDeg: number; liftErrorDeg: number; overshootDeg: number; reachTicks: number }[] } }).held50g.rows;
    const lifted = held.filter((_row, i) => i > 0 && i < held.length - 1); // at lift 0 the cube rests on the floor
    return {
      variant: v.name,
      empty: emptyMoves(v),
      held50g: {
        maxRestLevelDeg: r(Math.max(...lifted.map((x) => Math.abs(x.restLevelDeg)))),
        maxMovingLevelDeg: r(Math.max(...held.map((x) => x.maxLevelMovingDeg))),
        maxLiftErrorDeg: r(Math.max(...held.map((x) => Math.abs(x.liftErrorDeg)))),
        maxOvershootDeg: r(Math.max(...held.map((x) => x.overshootDeg))),
        slowestReachTicks: Math.max(...held.map((x) => x.reachTicks)),
      },
    };
  });
}
