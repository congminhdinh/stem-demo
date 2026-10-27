// N19 E9 phase B: which long tasks a gripper lesson's Kiểm tra 4x has, against when its rounds start (review 1, M1: the cause was "probably the world each round
// builds", not shown). Not product code. The production build (`vite build`) served by `vite preview`, the lab opened directly (?embed=1&lab=robot&template=<key>, the
// lesson's starter program: a world is built for each round whatever the program does), Chromium with SwiftShader and CDP CPU throttling `--rate` (6 = the bench's school
// profile, 4 = ss-low-4x). A PerformanceObserver records every long task (50 ms or more) of the page with its start; a MutationObserver the moments the check's round label
// ("Lượt n/3") changes. Prints both on the page's clock, and for each task the round label that was up when it started and how long after that label's change.
//
//   node spikes/n19-e9/check-long-tasks.mjs --origin=http://localhost:5556 [--template=rb-grip-sort] [--rate=6] [--runs=3]
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const origin = args.origin;
const template = args.template ?? 'rb-grip-sort';
const rate = Number(args.rate ?? 6);
const runs = Number(args.runs ?? 3);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (let run = 1; run <= runs; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(() => {
      const record = { tasks: [], rounds: [] };
      window.__long = record;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) record.tasks.push({ start: Math.round(entry.startTime), ms: Math.round(entry.duration) });
      }).observe({ type: 'longtask', buffered: true });
      let last = null;
      const look = () => {
        const text = document.querySelector('[data-testid=robot-check-round]')?.textContent ?? null;
        if (text !== last) {
          last = text;
          record.rounds.push({ at: Math.round(performance.now()), text });
        }
      };
      new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await page.goto(`${origin}/?embed=1&lab=robot&template=${template}`);
    await page.getByTestId('robot-lab').waitFor();
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 120_000 });
    await page.waitForTimeout(1500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    const clicked = await page.evaluate(() => Math.round(performance.now()));
    await page.getByTestId('robot-check-start').click();
    await page.getByTestId('robot-check-results').waitFor({ timeout: 180_000 });
    const { tasks, rounds } = await page.evaluate(() => window.__long);
    const after = tasks.filter((task) => task.start >= clicked - 50);
    console.log(`\nrun ${run}: template ${template}, CPU ${rate}x; clicked Kiểm tra at ${clicked} ms`);
    console.log('  round label changes (page ms): ' + rounds.filter((r) => r.at >= clicked - 50).map((r) => `${r.at} ${r.text ?? '(none)'}`).join(' | '));
    for (const task of after) {
      const up = [...rounds].filter((r) => r.at <= task.start + 1 && r.text !== null).at(-1);
      console.log(`  long task at ${task.start} ms, ${task.ms} ms; label up: ${up?.text ?? '-'} since ${up ? task.start - up.at : '-'} ms before`);
    }
    if (after.length === 0) console.log('  no long task');
    await context.close();
  }
} finally {
  await browser.close();
}
