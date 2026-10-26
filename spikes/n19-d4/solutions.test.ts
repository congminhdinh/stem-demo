// N19 D4 spike: every program of the four gripper lessons in src/samples/robot-solutions.ts through the real check, headless: the score,
// each variant's score, end and goals, and where the objects end in each variant (the references' margins). results/solutions.json.
//   SPIKE=solutions [ONLY=rb-grip-pick] pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts solutions
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { unoR3Board } from '../../src/core/hardware/catalog';
import { registry } from '../../src/core/program/__fixtures__/uno-blocks';
import { checkRobot } from '../../src/core/scenario/check-robot';
import { initPhysics } from '../../src/core/world/rapier';
import { hashSnapshot } from '../../src/core/world/snapshot';
import { scenarioCatalog } from '../../src/samples/robot-scenarios';
import { robotSolutions, type BlocklyJson, type RobotScoredKey } from '../../src/samples/robot-solutions';
import { gripperKit, projectOf } from './lib';

const keys = (['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack'] as RobotScoredKey[]).filter((key) => !process.env.ONLY || process.env.ONLY === key);

it.runIf(process.env.SPIKE === 'solutions')('checks every gripper program', async () => {
  await initPhysics();
  const out: Record<string, unknown[]> = {};
  for (const key of keys) {
    const solution = robotSolutions[key];
    const programs: [string, BlocklyJson, number | undefined][] = [
      ['reference', solution.reference, undefined],
      ...(solution.blind ? [['blind', solution.blind, undefined] as [string, BlocklyJson, undefined]] : []),
      ...(solution.exploits ?? []).map((e) => [`exploit ${e.name}`, e.program, e.maxScore] as [string, BlocklyJson, number]),
    ];
    const rows: unknown[] = [];
    for (const [name, blocks, maxScore] of programs) {
      const variants: unknown[] = [];
      const run = checkRobot(projectOf(key, blocks), scenarioCatalog.get(key)!, {
        mode: 'headless',
        kit: gripperKit,
        board: unoR3Board,
        registry,
        onProgress: (p) => {
          if (p.kind !== 'variant-ended') return;
          const w = p.snapshot.world!;
          variants.push({
            index: p.index,
            score: p.variant.score,
            end: p.end,
            bonus: p.timeBonus,
            goals: p.goals.map((g) => (g.passed ? `${g.id} ok` : `${g.id} ${g.reasonKey?.replace('robot.goal.reason.', '')}`)),
            objects: Object.fromEntries(w.objects.map((o) => [o.id, [o.pose.xCm, o.pose.yCm, o.pose.zCm].map((n) => Math.round(n * 100) / 100)])),
            world: hashSnapshot(w),
          });
        },
      });
      const result = (await run.result)!;
      rows.push({ name, score: result.score, passed: result.passed, maxScore, programHash: result.programHash, variants });
    }
    out[key] = rows;
  }
  writeFileSync(join(import.meta.dirname, 'results', `solutions${process.env.ONLY ? `-${process.env.ONLY}` : ''}.json`), JSON.stringify(out, null, 1));
});
