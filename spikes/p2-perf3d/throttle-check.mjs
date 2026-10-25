// N18 P2 spike (evidence for p2-audit.md §1.3): does CDP's CPU throttle reach the lab frame? 14 contexts in one SwiftShader browser at
// 6×: the first frame, a fixed loop timed in the lab frame and in the lesson page, whether the frame is out of process (OOPIF), and the
// renderer processes. Run from the repository root after pnpm bench:robot3d has built its dist: node spikes/p2-perf3d/throttle-check.mjs
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const root = process.cwd();
const { chromium } = await import(join(root, 'node_modules/@playwright/test/index.mjs'));
const dist = join(root, 'node_modules/.cache/bench-robot3d/dist');
const port = 5308;
const kids = [spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }), spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' })];
await new Promise((d) => setTimeout(d, 1500));
const origin = `http://localhost:${port + 1}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const bcdp = await browser.newBrowserCDPSession();
for (let i = 0; i < 14; i++) {
  const template = ['rb-line-follow', 'rb-sandbox', 'rb-mini-mission'][i % 3];
  const lab = `http://localhost:${port}/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(origin)}`;
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const t0 = Date.now();
  await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
  const frame = page.frames().find((f) => f.url().includes('lab=robot'));
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60000 });
  const first = Date.now() - t0;
  let oopif = false;
  try { await context.newCDPSession(frame); oopif = true; } catch { oopif = false; }
  const bench = await frame.evaluate('(() => { const s = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x += i % 7; return Math.round(performance.now() - s + x * 0); })()');
  const pageBench = await page.evaluate('(() => { const s = performance.now(); let x = 0; for (let i = 0; i < 3e7; i++) x += i % 7; return Math.round(performance.now() - s + x * 0); })()');
  const renderers = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo.filter((p) => p.type === 'renderer').length;
  console.log(`${i} ${template}: first frame ${first} ms, frame loop ${bench} ms, page loop ${pageBench} ms, OOPIF ${oopif}, renderers ${renderers}`);
  await context.close();
}
await browser.close();
kids.forEach((k) => k.kill());
