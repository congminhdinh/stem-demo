import { describe, expect, it } from 'vitest';
import { compileBlocks } from './__fixtures__/compile-case';
import { hardwareCases } from './__fixtures__/hardware-cases';
import { generateYbcMicroPython } from './generate';

// Exact-source goldens of the YB-3 hardware (plan §13.8, §18.4, R1): one file per case in `hardware/__golden__/`,
// next to, and apart from, the language goldens of YB-5A. A golden changes only by an explicit `vitest -u`, and
// every diff is reviewed.

describe('golden MicroPython of the YB-3 hardware', () => {
  it.each(hardwareCases)('$name', async ({ name, blocks }) => {
    const generated = generateYbcMicroPython(compileBlocks(blocks));
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    await expect(generated.source).toMatchFileSnapshot(`./hardware/__golden__/${name}.py`);
  });

  it('has a golden for every case, and nothing else', async () => {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(new URL('./hardware/__golden__/', import.meta.url)).filter((file) => file.endsWith('.py')).sort();
    expect(files).toEqual(hardwareCases.map((c) => `${c.name}.py`).sort());
  });
});
