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
