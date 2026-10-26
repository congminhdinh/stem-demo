// N19 D4 spike: the gripper car's motion and sensors that the four lessons are authored on (placeholder kit ref-uno-gripper@0).
//   SPIKE=measure pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts measure
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { claw, drive, hat, irDetect, lift, liftAngle, not, stop, wait, whileBlock, workspace } from '../../src/samples/robot-solutions';
import { load, trace } from './lib';

const base = (objects: unknown[], extra: Record<string, unknown> = {}) =>
  load({
    key: 'rb-grip-pick',
    version: 1,
    title: { vi: 'Đo', en: 'Measure' },
    profile: 'uno-basic',
    kit: 'ref-uno-gripper',
    arena: { ground: { sizeCm: [400, 200], color: '#f2f2f2' }, objects, ...(extra.arena as object) },
    start: { xCm: 40, yCm: 100, yawDeg: 0 },
    variants: { count: 1, seed: 0, startJitterCm: 0, yawJitterDeg: 0 },
    timeLimitS: 20,
    goals: [{ id: 'g', kind: 'object-held', label: { vi: 'g', en: 'g' }, points: 100, object: 'cube', minLiftCm: 2 }],
    starter: {},
  });
const cube = (x: number, y = 100) => ({ shape: 'box', id: 'cube', centerCm: [x, y], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#fbc02d' });

it.runIf(process.env.SPIKE === 'measure')('measures', async () => {
  await initPhysics();
  const out: Record<string, unknown> = {};
  // M1: straight at 50 % (lift down, then arm up) for 3 s, then stop: speed and coast.
  for (const [name, arm, speed] of [['drive50-down', 'DOWN', 50], ['drive50-up', 'UP', 50], ['drive60-down', 'DOWN', 60], ['drive70-down', 'DOWN', 70], ['drive100-down', 'DOWN', 100]] as const) {
    const s = base([cube(380, 180)]);
    const { rows } = await trace(s, workspace(hat('stem_on_start', [lift('l', arm), wait('w0', 500), drive('d', 'forward', speed), wait('w', 3000), stop('s')])), 0, 0.1, 6);
    out[name] = rows.filter((r) => [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 6].some((t) => Math.abs(r.t - t) < 1e-6)).map((r) => [r.t, r.x, r.y, r.yaw]);
  }
  // M2: spins at 50 % for 830 ms, lift down and up, from rest and after a forward run.
  for (const [name, arm] of [['spin50-down', 'DOWN'], ['spin50-up', 'UP']] as const) {
    const s = base([cube(380, 180)]);
    const { rows } = await trace(s, workspace(hat('stem_on_start', [lift('l', arm), wait('w0', 500), drive('d', 'spinLeft', 50), wait('w', 830), stop('s')])), 0, 0.1, 3);
    out[name] = rows.filter((r) => [0.5, 1.33, 2, 3].some((t) => Math.abs(r.t - t) < 0.05)).map((r) => [r.t, r.x, r.y, r.yaw]);
  }
  // M3: drive in at 50 % with the arm down and the claw open until the IR sees the cube; stop, close, lift.
  {
    const s = base([cube(120)]);
    const prog = workspace(
      hat('stem_on_start', [lift('l', 'DOWN'), claw('o', 'OPEN'), wait('w0', 500), drive('d', 'forward', 50), whileBlock('wh', not('n', irDetect('ir')), []), stop('s'), claw('c', 'CLOSE'), wait('w1', 500), lift('u', 'UP'), wait('w2', 1000)]),
    );
    const { rows } = await trace(s, prog, 0, 1 / 120, 8);
    out['approach-50'] = rows.filter((r, i) => i % 6 === 0 || r.ir !== rows[i - 1]?.ir || r.held !== rows[i - 1]?.held).map((r) => [r.t, r.x, r.lift, r.claw, r.held, r.us, r.usHit, r.ir, r.irHit, r.colorHit, r.colorCm, r.objects.cube]);
  }
  writeFileSync(join(import.meta.dirname, 'results', 'measure.json'), JSON.stringify(out, null, 0).replace(/\],\[/g, '],\n['));
});
