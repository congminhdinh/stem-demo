import { describe, expect, it } from 'vitest';
import { compileBlocks } from './__fixtures__/compile-case';
import { langCases } from './__fixtures__/lang-cases';
import { generateYbcMicroPython } from './generate';

// Exact-source goldens (plan §13.8): one file per case in `__golden__/`. A golden
// changes only by an explicit `vitest -u`, and every diff is reviewed.

describe('golden MicroPython of the YB-2 language', () => {
  it.each(langCases)('$name', async ({ name, blocks }) => {
    const generated = generateYbcMicroPython(compileBlocks(blocks));
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    await expect(generated.source).toMatchFileSnapshot(`./__golden__/${name}.py`);
  });

  it('has a golden for every case, and nothing else', async () => {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(new URL('./__golden__/', import.meta.url)).filter((file) => file.endsWith('.py')).sort();
    expect(files).toEqual(langCases.map((c) => `${c.name}.py`).sort());
  });
});
