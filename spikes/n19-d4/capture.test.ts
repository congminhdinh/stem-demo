// N19 D4 spike: how far off the robot's axis a 4 cm cube may lie and still be caught by the IR and gripped (approach at 50 %, arm down,
// claw open), with the robot turned or not; and the spin rate.
//   SPIKE=capture pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts capture
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { claw, drive, hat, irDetect, lift, not, stop, wait, whileBlock, workspace } from '../../src/samples/robot-solutions';
import { load, trace } from './lib';

const scen = (cubeY: number, yawDeg: number, cubeX = 100) =>
  load({
    key: 'rb-grip-pick',
    version: 1,
    title: { vi: 'Đo', en: 'Measure' },
    profile: 'uno-basic',
    kit: 'ref-uno-gripper',
    arena: { ground: { sizeCm: [400, 200], color: '#f2f2f2' }, objects: [{ shape: 'box', id: 'cube', centerCm: [cubeX, cubeY], sizeCm: [4, 4, 4], massG: 15, noun: 'cube', color: '#fbc02d' }] },
    start: { xCm: 40, yCm: 100, yawDeg },
    variants: { count: 1, seed: 0, startJitterCm: 0, yawJitterDeg: 0 },
    timeLimitS: 20,
    goals: [{ id: 'g', kind: 'object-held', label: { vi: 'g', en: 'g' }, points: 100, object: 'cube', minLiftCm: 2 }],
    starter: {},
  });

const grab = (speed: number) =>
  workspace(
    hat('stem_on_start', [lift('l', 'DOWN'), claw('o', 'OPEN'), wait('w0', 300), drive('d', 'forward', speed), whileBlock('wh', not('n', irDetect('ir')), []), stop('s'), claw('c', 'CLOSE'), wait('w1', 300), lift('u', 'UP'), wait('w2', 1500)]),
  );

it.runIf(process.env.SPIKE === 'capture')('captures', async () => {
  await initPhysics();
  const out: unknown[] = [];
  for (const yaw of [0, 2, -2, 3, -3]) {
    for (const dy of [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]) {
      // The cube where the robot's axis passes + dy across it, 60 cm ahead.
      const along = 60;
      const rad = (yaw * Math.PI) / 180;
      const cx = 40 + along * Math.cos(rad) - dy * Math.sin(rad);
      const cy = 100 + along * Math.sin(rad) + dy * Math.cos(rad);
      const { rows } = await trace(scen(cy, yaw, cx), grab(50), 0, 0.05, 9);
      const irAt = rows.find((r) => r.ir);
      const last = rows.at(-1)!;
      out.push({ yaw, dy, irAtT: irAt?.t ?? null, held: last.held, cube: last.objects.cube, robot: [last.x, last.y, last.yaw] });
    }
  }
  // Spin rate at 50 % for 830 ms, empty and holding, arm up.
  const spins: unknown[] = [];
  for (const holding of [false, true]) {
    const prog = workspace(
      hat('stem_on_start', [
        lift('l', 'DOWN'), claw('o', 'OPEN'), wait('w0', 300), drive('d', 'forward', 50), whileBlock('wh', not('n', irDetect('ir')), []), stop('s'),
        ...(holding ? [claw('c', 'CLOSE'), wait('w1', 300)] : []), lift('u', 'UP'), wait('w2', 500),
        drive('t', 'spinLeft', 50), wait('tw', 830), stop('s2'), wait('w3', 1000),
      ]),
    );
    const { rows } = await trace(scen(100, 0), prog, 0, 0.05, 12);
    spins.push({ holding, rows: rows.filter((_, i) => i % 4 === 0).map((r) => [r.t, r.x, r.y, r.yaw, r.held, r.objects.cube]) });
  }
  writeFileSync(join(import.meta.dirname, 'results', 'capture.json'), JSON.stringify({ capture: out, spins }, null, 1));
});
