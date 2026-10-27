// N19 E9 (hand-over from B5/B6 M4): what the gripper car's footprint sweep (src/core/world/robot/footprint.ts `robotFootprint`: 7 189 samples) costs
// on the main thread of a browser tab, cold, as the lab's first call to it pays it. Not product code. The dev server of the tree to measure
// serves the module (`node node_modules/vite/bin/vite.js --port <port>`); a fresh tab with no app on it (the favicon's SVG document) imports it, so the app's own
// start does not share the CPU; the CPU is throttled by CDP (Emulation.setCPUThrottlingRate) as the bench's `school` profile does (6x).
// Each case is a fresh tab (cold JIT), `--runs` times; prints the ms of the first call and of a second call (cached) per case.
//
//   node spikes/n19-e9/footprint-cost.mjs --origin=http://localhost:5550 [--runs=5] [--rate=6] [--call=robotFootprint|robotOutlineCm]
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const origin = args.origin;
const runs = Number(args.runs ?? 5);
const rate = Number(args.rate ?? 6);
const call = args.call ?? 'robotOutlineCm';
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const rows = [];
  for (const kitId of ['ref-uno-gripper', 'ref-uno-rover']) {
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${origin}/favicon.svg`);
      const client = await context.newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', { rate });
      const result = await page.evaluate(
        async ({ origin, kitId, call }) => {
          const footprint = await import(`${origin}/src/core/world/robot/footprint.ts`);
          const placement = await import(`${origin}/src/core/scenario/placement.ts`);
          const catalog = await import(`${origin}/src/core/hardware/catalog.ts`);
          const kit = catalog.productionKits.get({ id: kitId, version: '0' });
          const fn = call === 'robotFootprint' ? footprint.robotFootprint : placement.robotOutlineCm;
          const t0 = performance.now();
          const first = fn(kit);
          const t1 = performance.now();
          fn(kit);
          const t2 = performance.now();
          return { firstMs: t1 - t0, againMs: t2 - t1, size: call === 'robotFootprint' ? first.parts.reduce((n, part) => n + part.shapes.length, 0) : first.length };
        },
        { origin, kitId, call },
      );
      rows.push({ kitId, run, ...result });
      await context.close();
    }
  }
  for (const kitId of ['ref-uno-gripper', 'ref-uno-rover']) {
    const mine = rows.filter((row) => row.kitId === kitId);
    const first = mine.map((row) => row.firstMs).sort((a, b) => a - b);
    console.log(`${kitId.padEnd(16)} ${call}  cpu x${rate}  first call ms: ${first.map((v) => v.toFixed(1)).join(' ')} (median ${first[Math.floor(first.length / 2)].toFixed(1)})  again ms: ${mine.map((row) => row.againMs.toFixed(3)).join(' ')}  size ${mine[0].size}`);
  }
} finally {
  await browser.close();
}
