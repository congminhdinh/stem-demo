// N18 P2 spike (evidence for p2-audit.md): which event listeners a 2D ↔ 3D switch leaves behind. The lab in its lesson frame (the bench's
// production build, the GPU), `--switches` × Xem 2D and back; before and after, CDP's DOMDebugger.getEventListeners on the frame's
// window and document, counted by type and capture. Run from the repository root after pnpm bench:robot3d has built its dist:
//   node spikes/p2-perf3d/listener-leak.mjs [--switches=6]
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const switches = Number((process.argv.find((arg) => arg.startsWith('--switches=')) ?? '--switches=6').split('=')[1]);
const { chromium } = await import(join(root, 'node_modules/@playwright/test/index.mjs'));
const dist = join(root, 'node_modules/.cache/bench-robot3d/dist');
const port = 5308;
const kids = [spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }), spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' })];
await new Promise((done) => setTimeout(done, 1500));
const origin = `http://localhost:${port + 1}`;
const lab = `http://localhost:${port}/?embed=1&lab=robot&template=rb-line-follow&origin=${encodeURIComponent(origin)}`;
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const cdp = await page.context().newCDPSession(page);
await page.goto(`${origin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60000 });
// The lab frame's execution context, for objects of its window and document.
const contexts = [];
cdp.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
await cdp.send('Runtime.enable');
await new Promise((done) => setTimeout(done, 300));
const labContext = contexts.find((context) => context.origin === `http://localhost:${port}` && context.auxData?.isDefault);
const listeners = async () => {
  const out = {};
  for (const expression of ['window', 'document']) {
    const { result } = await cdp.send('Runtime.evaluate', { expression, contextId: labContext.id });
    const { listeners: found } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    for (const listener of found) {
      const key = `${expression} ${listener.type}${listener.useCapture ? ' (capture)' : ''}`;
      out[key] = (out[key] ?? 0) + 1;
    }
  }
  return out;
};
const before = await listeners();
for (let i = 0; i < switches; i += 1) {
  await frame.getByTestId('robot-viewmode').click();
  await frame.getByTestId('robot-topview').waitFor();
  await frame.getByTestId('robot-viewmode').click();
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60000 });
}
await cdp.send('HeapProfiler.collectGarbage');
const after = await listeners();
for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
  if ((after[key] ?? 0) !== (before[key] ?? 0)) console.log(`${key}: ${before[key] ?? 0} → ${after[key] ?? 0} after ${switches} switches`);
}
await browser.close();
kids.forEach((kid) => kid.kill());
