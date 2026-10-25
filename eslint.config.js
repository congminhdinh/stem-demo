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

// N18 (robot plan §5, ADR 0001 §5.2, §7): Rapier is loaded only by src/core/world, lazily, and only as the
// deterministic build (the -compat one is for plain Node scripts). no-restricted-imports does not see
// `import()`, so the lazy forms (string or template literal) have their own selectors.
const rapierMessage = 'Only src/core/world may load Rapier (robot plan §5, B1; ADR 0001 §7). Read RobotSnapshot instead.';
const anyRapier = { regex: '^@dimforge/', message: rapierMessage };
const nondeterministicMessage =
  'Only @dimforge/rapier3d-deterministic (or its -compat build, for Node scripts) gives the same bits on every engine (ADR 0001 §5.2).';
const nondeterministicSource = '^@dimforge\\/(?!rapier3d-deterministic(-compat)?(\\/|$))';
const nondeterministicRapier = { regex: '^@dimforge/(?!rapier3d-deterministic(-compat)?(/|$))', message: nondeterministicMessage };
/** `import('…')` and `import(\`…\`)` of a module whose name matches `source` (an esquery regex body). */
const lazyImportsOf = (source, message) => [
  { selector: `ImportExpression[source.value=/${source}/]`, message },
  { selector: `ImportExpression[source.type='TemplateLiteral'][source.quasis.0.value.cooked=/${source}/]`, message },
];
// The UI shows the world through RobotSnapshot; it never loads the engine or builds an arena in it (N18 R3.5): not createWorld
// (world.ts), Rapier, the arena builder, the robot or the sensors, not even their types (whatever the UI needs is a type of
// snapshot.ts), and not lazily. It may import the snapshot, the goal frame adapter and the world's data and arithmetic
// (arena-schema, ground-paint, units, dmath, rng). The run session (src/core/run, R3.6) is the one place that builds a world.
const worldEngineMessage = 'src/ui reads RobotSnapshot; it never loads Rapier or builds the physics world, the robot or its sensors (robot plan §5).';
const worldEngineSource = '(^|\\/)core\\/world\\/(rapier|world|arena\\/build-arena|robot\\/[^\\/]+|sensors\\/[^\\/]+)(\\.ts)?$';
const worldEngine = {
  regex: '(^|/)core/world/(rapier|world|arena/build-arena|robot/[^/]+|sensors/[^/]+)(\\.ts)?$',
  message: worldEngineMessage,
};

// D-R12, made stricter by ADR 0001 §4.6: ECMAScript lets engines approximate Math.sin/cos/tan/atan2/exp/
// log/pow/hypot (and the other transcendental functions, and `**`), and Node, Chromium, Firefox and WebKit
// really return different bits. The world must hash the same everywhere, so `Math` may only appear as
// `Math.<f>` for the functions ECMAScript defines exactly (correctly rounded or exact) and `Math.PI`; dmath.ts
// does the trigonometry. Every other way to reach Math (an alias, destructuring, a default, a cast, an
// argument, `globalThis.Math`) is refused, since lint cannot follow it. `Math.PI` is one fixed double ("the
// Number value for π") on every engine, as deterministic as a literal, so it is allowed anywhere, not only
// in constants; Math's other constants are not needed (`Math.sqrt(0.5)` is `Math.SQRT1_2` exactly).
// The world also never reads the wall clock (`Date`, `performance`): it runs on `world.t` alone.
const exactMath = ['sqrt', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'imul', 'trunc', 'sign', 'fround'];
const allowedMath = [...exactMath, 'PI'];
const worldMathMessage =
  'src/core/world must be bit-deterministic on every JS engine (D-R12, ADR 0001 §4.6): use dmath.ts (sin, cos, atan2) ' +
  `or + − × ÷ and Math.${allowedMath.join('/')}, written as Math.<name>; no other Math, no Math.random, no **.`;
const worldClockMessage = 'src/core/world runs on world.t alone: no Date, no performance (D-R2, plan §3).';
const worldGlobalMessage = 'src/core/world never reaches the global object (globalThis, window, self, global): lint cannot follow it.';
/** An identifier that reads a variable: not a member name (`o.x`) nor the written-out key of an object, class or type field. */
const read = [
  'MemberExpression[computed=false] > Identifier.property',
  'Property[shorthand=false][computed=false] > Identifier.key',
  'PropertyDefinition[computed=false] > Identifier.key',
  'MethodDefinition[computed=false] > Identifier.key',
  'TSPropertySignature[computed=false] > Identifier.key',
  'TSMethodSignature[computed=false] > Identifier.key',
]
  .map((position) => `:not(${position})`)
  .join('');
const worldDeterminism = [
  {
    selector: `Identifier[name='Math']:not(MemberExpression[computed=false][property.name=/^(${allowedMath.join('|')})$/] > Identifier.object):not(MemberExpression[computed=false] > Identifier.property)`,
    message: worldMathMessage,
  },
  { selector: "MemberExpression[computed=false][property.name='Math']", message: worldMathMessage },
  { selector: "MemberExpression[computed=true][property.value='Math']", message: worldMathMessage },
  { selector: `Identifier[name=/^(globalThis|window|self|global)$/]${read}`, message: worldGlobalMessage },
  { selector: `Identifier[name=/^(Date|performance)$/]${read}`, message: worldClockMessage },
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
      'no-restricted-imports': ['error', { patterns: [anyRapier] }],
      'no-restricted-syntax': ['error', ...lazyImportsOf('^@dimforge\\/', rapierMessage)],
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
            anyRapier,
            worldEngine,
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...lazyImportsOf('^@dimforge\\/', rapierMessage), ...lazyImportsOf(worldEngineSource, worldEngineMessage)],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [frameworkPattern, layerPattern, anyRapier] }],
    },
  },
  // The robot world: the one place that may load Rapier (the deterministic build only), and the one held
  // to bit-exact Math and no wall clock (its tests compare against Math and may time things).
  {
    files: ['src/core/world/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [frameworkPattern, layerPattern, nondeterministicRapier] }],
      'no-restricted-syntax': ['error', ...lazyImportsOf(nondeterministicSource, nondeterministicMessage)],
    },
  },
  {
    files: ['src/core/world/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...lazyImportsOf(nondeterministicSource, nondeterministicMessage), ...worldDeterminism],
    },
  },
]);
