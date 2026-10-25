// N18 R3.6 spike: runs index.html in Chromium, Firefox and WebKit (Playwright) against a running dev server and prints what it measured.
//   pnpm dev --port 5236 --strictPort        (in the repo root, in another shell)
//   node spikes/robot-run-until/measure.mjs [http://localhost:5236]
import { chromium, firefox, webkit } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5236';
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await type.launch();
  const page = await browser.newPage();
  await page.goto(`${base}/spikes/robot-run-until/index.html`);
  const result = await page.waitForFunction(() => window.__robotRunUntil, null, { timeout: 300_000, polling: 500 }).then((handle) => handle.jsonValue());
  const round = (value) => Math.round(value * 100) / 100;
  if (result.error) {
    console.log(name, result.error);
  } else {
    console.log(`${name} ${browser.version()}`);
    console.log(`  one fresh MessageChannel turn: ${round(result.freshMessageChannelTurnUs)} µs; one setTimeout(0) turn: ${round(result.setTimeout0TurnUs)} µs`);
    for (const [label, runs] of [['runUntil(60), yields every 8 ms', result.withYields], ['runUntil(60), never yields', result.withoutYields]]) {
      console.log(`  ${label}: ${runs.map((run) => `${round(run.wallMs)} ms wall, ${run.beats} heartbeats, longest block ${round(run.longestGapMs)} ms, t ${run.t}, hash ${run.hash}`).join(' | ')}`);
    }
  }
  await browser.close();
}
