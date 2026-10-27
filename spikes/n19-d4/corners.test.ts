// N19 D4 fix round 1 (review I1): lesson 8's reference at the corners of its variant range (start ±1 cm in x and y, ±2°, cube dx ±10), each as
// its own one-round scenario, at the approach speed FAST (50, the reference's since the fix, or 70, before it) and the drop distance DROP
// from the far wall (45 before the fix). results/corners-<FAST>-<DROP>.json.
//   SPIKE=corners FAST=50 DROP=35 pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts corners
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { initPhysics } from '../../src/core/world/rapier';
import { check, load } from './lib';
import { pickRef } from './programs';

const base = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'src', 'samples', 'robot-scenarios', 'rb-grip-pick.json'), 'utf8'));
/** The cube's lateral offset from the start's line of travel, cm (left of the heading positive). */
const offsetOf = (sx: number, sy: number, yawDeg: number, cx: number, cy: number) => {
  const r = (yawDeg * Math.PI) / 180;
  return -(cx - sx) * Math.sin(r) + (cy - sy) * Math.cos(r);
};

it.runIf(process.env.SPIKE === 'corners')('checks the corners', async () => {
  await initPhysics();
  const fast = Number(process.env.FAST ?? 50);
  const out: unknown[] = [];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dyaw of [-2, 2]) for (const cube of [-10, 10]) {
    const start = { xCm: 30 + dx, yCm: 45 + dy, yawDeg: dyaw };
    const json = structuredClone(base);
    json.start = start;
    json.arena.objects[0].centerCm = [85 + cube, 45];
    json.variants = { count: 1, seed: 0, startJitterCm: 0, yawJitterDeg: 0 };
    const result = await check(load(json), pickRef(fast, Number(process.env.DROP ?? 45)));
    out.push({ dx, dy, dyaw, cube, offset: Math.round(offsetOf(start.xCm, start.yCm, dyaw, 85 + cube, 45) * 100) / 100, score: result.score, goals: (result.ended[0] as { goals: string[] }).goals });
  }
  writeFileSync(join(import.meta.dirname, 'results', `corners-${fast}-${process.env.DROP ?? 45}.json`), JSON.stringify(out, null, 1));
});
