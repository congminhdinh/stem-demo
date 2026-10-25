// N18 P2 Phase B: the pixel diff of two sets of shots.mjs pictures (same names). For each picture: the share of pixels whose largest channel
// difference is over 8 (of 255), the largest difference, and the box round the changed pixels; with --diff=<dir>, a picture of where they
// changed (red over a dimmed copy of the first). Run from the repository root:
//
//   node spikes/p2-perf3d/shots-diff.mjs <before-dir> <after-dir> [--diff=<dir>]
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [beforeDir, afterDir] = process.argv.slice(2).filter((arg) => !arg.startsWith('--')).map((dir) => resolve(dir));
const diffDir = process.argv.find((arg) => arg.startsWith('--diff='))?.split('=')[1];
const { decodePng, writePng } = await import(join(process.cwd(), 'scripts/lib/png.ts'));
const THRESHOLD = 8;
if (diffDir) mkdirSync(diffDir, { recursive: true });
let changed = 0;
for (const file of readdirSync(beforeDir).filter((name) => name.endsWith('.png')).sort()) {
  let after;
  try {
    after = decodePng(readFileSync(join(afterDir, file)));
  } catch {
    process.stdout.write(`${file}: missing after\n`);
    continue;
  }
  const before = decodePng(readFileSync(join(beforeDir, file)));
  if (before.width !== after.width || before.height !== after.height) {
    process.stdout.write(`${file}: size ${before.width}×${before.height} → ${after.width}×${after.height}\n`);
    continue;
  }
  const { width, height, channels } = before;
  let over = 0;
  let largest = 0;
  const box = { left: width, right: -1, top: height, bottom: -1 };
  const marks = diffDir ? new Uint8Array(width * height * 3) : null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * channels;
      let d = 0;
      for (let c = 0; c < Math.min(3, channels); c += 1) d = Math.max(d, Math.abs(before.data[at + c] - after.data[at + c]));
      largest = Math.max(largest, d);
      const hit = d > THRESHOLD;
      if (hit) {
        over += 1;
        box.left = Math.min(box.left, x);
        box.right = Math.max(box.right, x);
        box.top = Math.min(box.top, y);
        box.bottom = Math.max(box.bottom, y);
      }
      if (marks) {
        const o = (y * width + x) * 3;
        const grey = Math.round((before.data[at] + before.data[at + 1] + before.data[at + 2]) / 6);
        [marks[o], marks[o + 1], marks[o + 2]] = hit ? [255, 0, 0] : [grey, grey, grey];
      }
    }
  }
  const share = (100 * over) / (width * height);
  if (over > 0) changed += 1;
  process.stdout.write(`${file}: ${share.toFixed(3)} % over ${THRESHOLD}, largest ${largest}${over > 0 ? `, box x ${box.left}–${box.right} y ${box.top}–${box.bottom}` : ''}\n`);
  if (marks && over > 0) {
    await writePng(join(diffDir, file), { width, height, pixelsPerMetre: 3780 }, async function* () {
      for (let y = 0; y < height; y += 64) yield marks.subarray(y * width * 3, Math.min(height, y + 64) * width * 3);
    }());
  }
}
process.stdout.write(`${changed} picture(s) changed\n`);
