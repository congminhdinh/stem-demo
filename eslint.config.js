import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Boundary B1 (docs/stem-demo-implementation-plan.md §5.1): src/core is plain
// TypeScript. It must not depend on UI frameworks, browser-only libraries or
// on the ui/storage layers.
const frameworkPackages = [
  'react',
  'react-dom',
  'react-konva',
  'konva',
  'blockly',
  'zustand',
  'dexie',
  'monaco-editor',
  '@monaco-editor/react',
  'pyodide',
];

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: frameworkPackages.flatMap((name) => [name, `${name}/*`]),
              message: 'src/core must stay framework-free (plan §5.1, B1).',
            },
            {
              group: ['**/ui', '**/ui/**', '**/storage', '**/storage/**'],
              message: 'src/core must not import the ui or storage layers (plan §5.1, B1).',
            },
          ],
        },
      ],
    },
  },
]);
