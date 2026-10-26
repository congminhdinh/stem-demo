// N19 D4 evidence (spike, eslint-ignored; a copy of spikes/n19-b34/make-attempts.mjs that keeps the rover lessons, or with ATTEMPT_KEYS=gripper the gripper lessons only): honest attempts of every scored N18 lesson, as STEMLearning stores them (the camelCase
// LabAttemptDto plus the project), made by the check of the source tree at <root> (BASE: an export of master 6884822; or this worktree).
// HEAD's `pnpm verify:attempt <out.json> --json` must then call each one a match: the rover's checks are unchanged by B3/B4.
//
//   node spikes/n19-b34/make-attempts.mjs <root> <out.json>
//
// Loads the TypeScript through Vite's SSR loader with no config file, as scripts/verify-attempt.mjs does; Rapier's -compat build.

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { createServer } from 'vite';

const [rootArg, outArg] = process.argv.slice(2);
const root = resolve(rootArg);
const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  cacheDir: join(root, 'node_modules', '.vite-d4-attempts'),
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const load = (path) => server.ssrLoadModule(path);
  const { initPhysics } = await load('/src/core/world/rapier.ts');
  await initPhysics(async () => import(join(root, 'node_modules', '@dimforge', 'rapier3d-deterministic-compat', 'dist', 'rapier.cjs')));
  const { checkRobot } = await load('/src/core/scenario/check-robot.ts');
  const { createVerifyEnvironment } = await load('/src/core/scenario/verify-attempt.ts');
  const { localDeviceDefinitions } = await load('/src/core/devices/local-catalog.ts');
  const { createDeviceRegistry } = await load('/src/core/devices/registry.ts');
  const { productionKits } = await load('/src/core/hardware/index.ts');
  const { scenarioCatalog } = await load('/src/samples/robot-scenarios/index.ts');
  const { robotSolutions } = await load('/src/samples/robot-solutions.ts');
  const { robotStarterDocument } = await load('/src/samples/robot-templates.ts');
  const registry = createDeviceRegistry(localDeviceDefinitions);
  const env = createVerifyEnvironment({ scenarios: scenarioCatalog, kits: productionKits, registry });
  const attempts = [];
  let id = 1;
  for (const [key, solution] of Object.entries(robotSolutions).filter(([key]) => (process.env.ATTEMPT_KEYS === 'gripper') === key.startsWith('rb-grip-'))) {
    const programs = [['reference', solution.reference], ...(solution.blind ? [['blind', solution.blind]] : []), ...(solution.exploits ?? []).map((exploit, i) => [`exploit-${i}`, exploit.program])];
    for (const [which, blocks] of programs) {
      const scenario = scenarioCatalog.get(key);
      const { kit, board } = env.kitOf(scenario);
      const project = { ...robotStarterDocument(key), program: { blocks: structuredClone(blocks) } };
      const checked = (await checkRobot(project, scenario, { mode: 'headless', kit, board, registry }).result);
      if (!checked) continue;
      attempts.push({
        id: id++,
        lessonId: 7,
        activityId: 12,
        labKind: 2,
        templateKey: key,
        templateVersion: checked.scenarioVersion,
        engine: checked.engine,
        passed: checked.passed,
        passing: checked.passed,
        score: checked.score,
        maxScore: checked.maxScore,
        simTimeMs: checked.simTimeMs,
        goals: checked.goals.map((goal) => ({ ...goal })),
        variants: checked.variants.map((variant) => ({ ...variant })),
        programHash: checked.programHash,
        hasProject: true,
        createdAt: '2026-10-27T08:00:00Z',
        projectJson: JSON.stringify(project),
      });
      console.log(`${key} ${which}: passed ${checked.passed} score ${checked.score} ${checked.programHash.slice(0, 12)}`);
    }
  }
  writeFileSync(resolve(outArg), JSON.stringify(attempts));
} finally {
  await server.close();
}
