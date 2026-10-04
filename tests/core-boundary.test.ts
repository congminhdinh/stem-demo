import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Guards boundary B1 (plan §5.1): the lint rule in eslint.config.js must keep
// src/core free of UI frameworks and of the ui/storage layers.
const eslint = new ESLint();

async function boundaryViolations(code: string, filePath: string) {
  const results = await eslint.lintText(code, { filePath });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId === 'no-restricted-imports');
}

describe('core boundary (B1)', () => {
  it.each([
    "import { useState } from 'react';",
    "import { jsx } from 'react/jsx-runtime';",
    "import Konva from 'konva';",
    "import * as Blockly from 'blockly';",
    "import { createStore } from 'zustand/vanilla';",
    "import Dexie from 'dexie';",
    "import { App } from '../ui/app/App';",
    "import { db } from '../../storage/db';",
  ])('rejects `%s` inside src/core', async (code) => {
    expect(await boundaryViolations(code, 'src/core/circuit/example.ts')).toHaveLength(1);
  });

  it('allows plain dependencies inside src/core', async () => {
    expect(await boundaryViolations("import { z } from 'zod';", 'src/core/circuit/example.ts')).toEqual([]);
  });

  it('allows framework imports outside src/core', async () => {
    expect(await boundaryViolations("import { useState } from 'react';", 'src/ui/app/example.ts')).toEqual([]);
  });
});

describe('persistence boundary (B8)', () => {
  it.each([
    "import Dexie from 'dexie';",
    "import { createDexieProjectRepository } from '../../storage/dexie-project-repository';",
  ])('rejects `%s` inside src/ui', async (code) => {
    expect(await boundaryViolations(code, 'src/ui/state/example.ts')).toHaveLength(1);
  });

  it('allows the storage implementation in the composition root and in src/storage', async () => {
    const code = "import { createDexieProjectRepository } from './storage/dexie-project-repository';";
    expect(await boundaryViolations(code, 'src/main.tsx')).toEqual([]);
    expect(await boundaryViolations("import Dexie from 'dexie';", 'src/storage/example.ts')).toEqual([]);
  });
});
