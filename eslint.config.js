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
  // N18 (robot plan §5): the 3D view renders RobotSnapshot in src/ui; the world never draws.
  'three',
  '@react-three/*',
];

const frameworkPattern = {
  group: frameworkPackages.flatMap((name) => [name, `${name}/*`]),
  message: 'src/core must stay framework-free (plan §5.1, B1).',
};

const layerPattern = {
  group: ['**/ui', '**/ui/**', '**/storage', '**/storage/**'],
  message: 'src/core must not import the ui or storage layers (plan §5.1, B1).',
};

// N18 (robot plan §5, ADR 0001 §7): Rapier is loaded only by src/core/world, lazily. The UI reads
// RobotSnapshot and never touches the engine. no-restricted-imports does not see `import()`, so the
// lazy form has its own selector.
const rapierMessage = 'Only src/core/world may load Rapier (robot plan §5, B1; ADR 0001 §7). Read RobotSnapshot instead.';
const rapierPattern = {
  group: ['@dimforge/rapier3d-deterministic*', '@dimforge/rapier3d-deterministic*/**'],
  message: rapierMessage,
};
const rapierLazyImport = {
  selector: 'ImportExpression[source.value=/^@dimforge\\/rapier3d-deterministic/]',
  message: rapierMessage,
};

// D-R12, made stricter by ADR 0001 §4.6: ECMAScript lets engines approximate Math.sin/cos/tan/atan2/exp/
// log/pow/hypot (and the other transcendental functions, and `**`), and Node, Chromium, Firefox and WebKit
// really return different bits. The world must hash the same everywhere, so it only uses + − × ÷, the
// correctly rounded or exact Math functions below, Math's constants, and dmath.ts for trigonometry.
const exactMath = ['sqrt', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'imul'];
const mathConstant = '[A-Z][A-Z0-9_]*';
const worldMathMessage =
  'src/core/world must be bit-deterministic on every JS engine (D-R12, ADR 0001 §4.6): use dmath.ts (sin, cos, atan2) ' +
  `or + − × ÷ and Math.${exactMath.join('/')}; no other Math function, no Math.random, no **.`;
const worldDeterminism = [
  {
    selector: `MemberExpression[object.name='Math'][computed=false]:not([property.name=/^(${exactMath.join('|')}|${mathConstant})$/])`,
    message: worldMathMessage,
  },
  { selector: "MemberExpression[object.name='Math'][computed=true]", message: worldMathMessage },
  { selector: "VariableDeclarator[init.name='Math']", message: worldMathMessage },
  { selector: "BinaryExpression[operator='**']", message: worldMathMessage },
  { selector: "AssignmentExpression[operator='**=']", message: worldMathMessage },
];

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'playwright-report', 'test-results', 'spikes']),
  js.configs.recommended,
  tseslint.configs.recommended,
  // Later blocks replace the options of earlier ones for the same rule, so each block lists every
  // pattern that applies to its files.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [rapierPattern] }],
      'no-restricted-syntax': ['error', rapierLazyImport],
    },
  },
  // Boundary B8 (§5.1): the UI and its stores reach persistence only through
  // the ProjectRepository interface; the composition root (src/main.tsx)
  // picks the implementation.
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['dexie', 'dexie/*', '**/storage', '**/storage/**'],
              message: 'src/ui must use the ProjectRepository interface, not the storage implementation (plan §5.1, B8).',
            },
            rapierPattern,
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [frameworkPattern, layerPattern, rapierPattern] }],
    },
  },
  // The robot world: the one place that may load Rapier, and the one held to bit-exact Math.
  {
    files: ['src/core/world/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [frameworkPattern, layerPattern] }],
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['src/core/world/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...worldDeterminism],
    },
  },
]);
