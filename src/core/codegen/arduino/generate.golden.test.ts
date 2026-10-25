import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCase, sketchCases } from './__fixtures__/sketch-cases';
import { generateUnoSketch } from './generate';

// Exact-source goldens of the Arduino sketch (N18 C1, as codegen/yolobit/generate.golden.test.ts): one file per case in `__golden__/`.
// A golden changes only by an explicit `vitest -u`, and every diff is reviewed. `pnpm check:arduino --require` compiles every one of
// them with the pinned toolchain (L2).

describe('golden Arduino sketches of the robot lab', () => {
  it.each(sketchCases)('$name', async (sketchCase) => {
    const { ir, kit, board } = compileCase(sketchCase);
    const generated = generateUnoSketch(ir, { kit, board });
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    await expect(generated.source).toMatchFileSnapshot(`./__golden__/${sketchCase.name}.ino`);
  });

  it('has a golden for every case, and nothing else', () => {
    const files = readdirSync(new URL('./__golden__/', import.meta.url)).filter((file) => file.endsWith('.ino')).sort();
    expect(files).toEqual(sketchCases.map((c) => `${c.name}.ino`).sort());
  });
});
