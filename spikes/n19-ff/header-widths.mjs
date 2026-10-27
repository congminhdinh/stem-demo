// N19 final fix (G1 c2): the lab header's items and their widths, in the lab opened at a frame's size. Run from the repository root:
//   node spikes/n19-ff/header-widths.mjs --base=http://localhost:5580 --size=1022x582 [--keys=a,b]
import { chromium } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const base = args.base ?? 'http://localhost:5580';
const [width, height] = (args.size ?? '1022x582').split('x').map(Number);
const keys = (args.keys ?? 'rb-drive-to-zone,rb-square-route,rb-stop-at-wall,rb-line-follow,rb-servo-gate,rb-mini-mission,rb-sandbox,rb-grip-pick,rb-grip-deliver,rb-grip-sort,rb-grip-stack').split(',');
const browser = await chromium.launch({ headless: true });
try {
  for (const key of keys) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(`${base}/?embed=1&lab=robot&template=${key}`);
    await page.getByTestId('robot-lab').waitFor();
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => {
      const header = document.querySelector('.robot-header');
      const box = header.getBoundingClientRect();
      const items = [...header.children].map((child) => {
        const r = child.getBoundingClientRect();
        return `${child.className.split(' ')[0] || child.tagName}@${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}w`;
      });
      const title = document.querySelector('[data-testid=robot-scenario]');
      return { height: Math.round(box.height), items, title: `${title.textContent} ${title.clientWidth}/${title.scrollWidth} title=${title.getAttribute('title')}` };
    });
    process.stdout.write(`${key} ${width}x${height}: header h ${info.height} | ${info.items.join(' | ')} | ${info.title}\n`);
    await context.close();
  }
} finally {
  await browser.close();
}
