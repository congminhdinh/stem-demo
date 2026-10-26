// N19 D4 spike (eslint-ignored): run a program on the gripper car in a scenario, and trace what it does, for authoring the four lessons.
import type { ProjectDocument } from '../../src/core/circuit/document';
import { productionKits, unoR3Board } from '../../src/core/hardware/catalog';
import type { Kit } from '../../src/core/hardware/kit';
import { registry } from '../../src/core/program/__fixtures__/uno-blocks';
import { createRobotRunSession } from '../../src/core/run/robot-run-session';
import { checkRobot } from '../../src/core/scenario/check-robot';
import { loadScenario, type Scenario } from '../../src/core/scenario/scenario';
import { createScenarioScorer } from '../../src/core/scenario/scoring';
import { robotStarterDocument } from '../../src/samples/robot-templates';
import type { RobotTemplateKey } from '../../src/samples/robot-keys';
import type { BlocklyJson } from '../../src/samples/robot-solutions';

export const gripperKit = productionKits.get({ id: 'ref-uno-gripper', version: '0' }) as Kit;
export const roverKit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const kitOf = (scenario: Scenario) => (scenario.kit === 'ref-uno-gripper' ? gripperKit : roverKit);

export const projectOf = (key: string, blocks: BlocklyJson): ProjectDocument => ({ ...robotStarterDocument(key as RobotTemplateKey), program: { blocks: structuredClone(blocks) } });

export type Row = {
  t: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  lift?: number;
  claw?: number;
  held?: string | null;
  us?: number;
  usHit?: string | null;
  ir?: boolean;
  irHit?: string | null;
  colorHit?: string | null;
  colorCm?: number | null;
  objects: Record<string, [number, number, number]>;
  block: string | null;
  points: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Runs `blocks` in variant `variant` of `scenario` for `seconds` (or the time limit), a row every `everyS`. */
export async function trace(scenario: Scenario, blocks: BlocklyJson, variant = 0, everyS = 0.1, seconds?: number): Promise<{ rows: Row[]; goals: unknown; end: unknown }> {
  const kit = kitOf(scenario);
  let scorer: ReturnType<typeof createScenarioScorer> | null = null;
  const session = createRobotRunSession({
    scenario,
    kit,
    board: unoR3Board,
    registry,
    scorer: (run) => {
      scorer = createScenarioScorer(run);
      return { update: (f, dt) => scorer!.update(f, dt), score: () => scorer!.score(), end: (e) => scorer!.end(e) };
    },
  });
  const started = await session.start(projectOf(scenario.key, blocks), variant, { check: true });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const rows: Row[] = [];
  const limit = seconds ?? scenario.timeLimitS;
  const perS = Math.round(1 / everyS);
  for (let k = 0; k / perS <= limit + 1e-9; k++) {
    await session.runUntil(k / perS);
    const snap = session.getSnapshot();
    const w = snap.world;
    if (w === null) break;
    const g = w.robot.gripper;
    const us = w.sensors.find((s) => s.kind === 'ultrasonic') as { cm: number; hitId: string | null } | undefined;
    const ir = w.sensors.find((s) => s.kind === 'ir-obstacle') as { detected: boolean; hitId: string | null } | undefined;
    const col = w.sensors.find((s) => s.kind === 'color-sensor') as { hitId: string | null; distanceCm: number | null } | undefined;
    const q = w.robot.rotation;
    // pitch: angle of the body's forward axis above the floor
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const fy = 2 * (q.x * q.y + q.w * q.z);
    const fz = 2 * (q.x * q.z - q.w * q.y);
    const pitch = (Math.atan2(fz, Math.hypot(fx, fy)) * 180) / Math.PI;
    rows.push({
      t: r2(w.t),
      x: r2(w.robot.xCm),
      y: r2(w.robot.yCm),
      yaw: r2(w.robot.yawDeg),
      pitch: r2(pitch),
      ...(g ? { lift: r2(g.liftDeg), claw: r2(g.clawDeg), held: g.heldId } : {}),
      ...(us ? { us: r2(us.cm), usHit: us.hitId } : {}),
      ...(ir ? { ir: ir.detected, irHit: ir.hitId } : {}),
      ...(col ? { colorHit: col.hitId, colorCm: col.distanceCm === null ? null : r2(col.distanceCm) } : {}),
      objects: Object.fromEntries(w.objects.map((o) => [o.id, [r2(o.pose.xCm), r2(o.pose.yCm), r2(o.pose.zCm)]])),
      block: w.activeBlockId,
      points: w.score.points,
    });
    if (snap.status !== 'running' && snap.status !== 'idle') {
      if (w.status !== 'running') break;
    }
    if (w.status === 'finished' || w.status === 'error') break;
  }
  const final = session.getSnapshot();
  const result = { rows, goals: (scorer as unknown as { result(): unknown } | null)?.result(), end: final.end ?? null };
  session.stop();
  return result;
}

/** checkRobot headless, with each variant's goals. */
export async function check(scenario: Scenario, blocks: BlocklyJson) {
  const kit = kitOf(scenario);
  const ended: unknown[] = [];
  const run = checkRobot(projectOf(scenario.key, blocks), scenario, {
    mode: 'headless',
    kit,
    board: unoR3Board,
    registry,
    onProgress: (p) => {
      if (p.kind === 'variant-ended') ended.push({ index: p.index, end: p.end, error: p.error, goals: p.goals.map((g) => `${g.id}:${g.passed ? 'ok' : `${g.reasonKey}@${g.atS ?? ''}`}`) });
    },
  });
  const result = await run.result;
  return { score: result!.score, passed: result!.passed, variants: result!.variants.map((v) => ({ score: v.score, passed: v.passed, simTimeMs: v.simTimeMs })), ended };
}

export const load = (json: unknown): Scenario => loadScenario(json as never);
