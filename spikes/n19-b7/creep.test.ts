// N19 B7 spike: the chassis' yaw rate and drift at rest after each lesson's program, with sets of suspects removed (lib.ts).
//   OUT=<name> CASES='<json list of RestCase>' pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts creep
// Writes spikes/n19-b7/results/<name>.json and prints one line per case.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { rest, type RestCase } from './lib';

it('measures the cases', async () => {
  const cases = JSON.parse(process.env.CASES ?? '[{"key":"rb-grip-stack"}]') as RestCase[];
  const out = [];
  for (const c of cases) {
    const r = await rest(c);
    out.push(r);
    console.log(
      `${r.key} v${r.variant} [${r.removals.join(',') || '-'}] finished ${r.finishedAtS.toFixed(3)} window ${r.windowFromS.toFixed(3)}+${r.windowS}: ` +
        `yaw ${r.yawRateDegS.toExponential(3)} deg/s, drift ${r.driftCmS.toExponential(3)} cm/s, max |wy| ${r.maxYawRateDegS.toExponential(3)} deg/s, ` +
        `max |v| ${r.maxSpeedCmS.toExponential(3)} cm/s, wheels ${r.wheelRadRate.map((w) => w.toExponential(2)).join('/')} rad/s, ` +
        `gripper ${JSON.stringify(r.gripper)}, sleeping ${r.sleeping}, touching ${r.touching.join('; ')}`,
    );
  }
  writeFileSync(join(import.meta.dirname, 'results', `${process.env.OUT ?? 'creep'}.json`), JSON.stringify(out, null, 1));
  expect(out.length).toBe(cases.length);
});
