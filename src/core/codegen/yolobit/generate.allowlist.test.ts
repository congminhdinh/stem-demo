import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileBlocks } from './__fixtures__/compile-case';
import { langCases } from './__fixtures__/lang-cases';
import { generateYbcMicroPython } from './generate';

// The API allowlist (plan §13.9, K2): everything a generated program imports, calls or reads
// from a module must be in the list the contract allows. YB-5A knows `time.sleep_ms`, the
// builtins of IM-9, the learner's variables and the generator's own `_r…` / `_cu_…` names.

const keywords = new Set(['if', 'elif', 'else', 'while', 'for', 'in', 'and', 'or', 'not', 'True', 'False', 'pass', 'import']);
const allowedBuiltins = new Set(['print', 'range', 'str', 'int', 'len']);
const allowedModuleAttributes = new Set(['time.sleep_ms']);
const allowedImports = new Set(['import time']);
const generatorName = /^(_r\d+|_cu_start_\d+|_cu_end_\d+)$/;

/** The source without comments and string literals, so only code is looked at. */
function code(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/#.*$/, ''))
    .join('\n');
}

function audit(source: string, learnerNames: Set<string>) {
  const stripped = code(source);
  const imports = stripped.split('\n').filter((line) => /^(import|from)\s/.test(line));
  const attributes = [...stripped.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)].map((match) => `${match[1]}.${match[2]}`);
  const calls = [...stripped.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1] as string).filter((name) => !keywords.has(name));
  const names = [...stripped.matchAll(/(?<![.\w])([A-Za-z_]\w*)\b/g)].map((match) => match[1] as string).filter((name) => !keywords.has(name));
  return { imports, attributes, calls, names: names.filter((name) => !allowedBuiltins.has(name) && name !== 'time' && !learnerNames.has(name) && !generatorName.test(name)) };
}

describe('API allowlist', () => {
  it.each(langCases)('$name imports, calls and reads only what the contract allows', ({ blocks }) => {
    const generated = generateYbcMicroPython(compileBlocks(blocks));
    if (!generated.ok) {
      throw new Error(JSON.stringify(generated.diagnostics));
    }
    const found = audit(generated.source, new Set(Object.values(generated.names)));
    expect(found.imports.every((line) => allowedImports.has(line))).toBe(true);
    expect(found.attributes.every((attribute) => allowedModuleAttributes.has(attribute))).toBe(true);
    expect(found.calls.every((name) => allowedBuiltins.has(name) || name === 'sleep_ms')).toBe(true);
    expect(found.names).toEqual([]);
  });

  it('would notice a call outside the list (the audit is not vacuous)', () => {
    const found = audit("import time\nimport random\nx = random.randint(1, 6)\ndisplay.clear()\nprint('random.randint(')\n", new Set(['x']));
    expect(found.imports).toContain('import random');
    expect(found.attributes).toEqual(['random.randint', 'display.clear']);
    expect(found.calls).toEqual(['randint', 'clear', 'print']);
    expect(found.names).toEqual(['random', 'random', 'display']);
  });

  it('audits every golden file on disk, not only the cases in memory', () => {
    const files = readdirSync(new URL('./__golden__/', import.meta.url)).filter((file) => file.endsWith('.py'));
    expect(files.length).toBe(langCases.length);
    for (const file of files) {
      const source = readFileSync(new URL(`./__golden__/${file}`, import.meta.url), 'utf8');
      expect(audit(source, new Set(source.match(/^[A-Za-z]\w* = 0$/gm)?.map((line) => line.split(' ')[0] as string))).imports).toEqual(['import time']);
    }
  });
});
