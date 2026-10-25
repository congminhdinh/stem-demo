// N18 P2 spike (evidence for .superpowers/sdd/robot-3d-implementation-plan/p2-audit.md). Run from the repository root:
//   node spikes/p2-perf3d/free-view-cost.mjs
// Microbench: one freeViewPose call per pilot, as Scene.tsx/CameraRig.tsx build its inputs (aspect of the 660 x 497 view, the HUD
// corner as measured, MIN_ROBOT_PX). Node 24 on this machine: the mean time of 40 calls after 5 to warm the JIT.
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
const root = process.argv[2] ?? process.cwd();
const { createServer } = await import(join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, cacheDir: join(root, 'node_modules/.cache/p2-micro-vite'), optimizeDeps: { noDiscovery: true, include: [] } });
const studio = await server.ssrLoadModule('/src/ui/robot3d/camera-studio.ts');
const { scenarioCatalog } = await server.ssrLoadModule('/src/samples/robot-scenarios/index.ts');
const boxTopCorners = (box) => { const [c, s] = [Math.cos((box.yawDeg * Math.PI) / 180), Math.sin((box.yawDeg * Math.PI) / 180)]; return [-1, 1].flatMap((dx) => [-1, 1].map((dy) => { const [x, y] = [(dx * box.sizeCm[0]) / 2, (dy * box.sizeCm[1]) / 2]; return [box.centerCm[0] + x * c - y * s, box.centerCm[1] + x * s + y * c, box.sizeCm[2]]; })); };
const aspect = 660 / 497;
const hud = { right: -0.08, bottom: 0.35 };
const safe = { ...studio.VIEW_SAFE_RECT, hud, tools: { right: -0.7, top: -0.6 } };
const minRobot = (2 * studio.MIN_ROBOT_PX) / 660;
for (const key of ['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission', 'rb-sandbox']) {
  const scenario = scenarioCatalog.get(key);
  const zones = scenario.arena.paint.zones;
  const free = {
    start: scenario.start,
    goals: zones.filter((z) => z.kind === 'target' || z.kind === 'checkpoint').map((z) => z.polygonCm),
    startZone: zones.find((z) => z.kind === 'start')?.polygonCm,
    route: scenario.arena.paint.lines.flatMap((l) => l.pointsCm),
    bodies: [...scenario.arena.boxes.filter((b) => b.body === 'fixed').flatMap(boxTopCorners), ...scenario.arena.cylinders.filter((c) => c.body === 'fixed').map((c) => [c.centerCm[0], c.centerCm[1], c.heightCm])],
  };
  const span = { widthM: scenario.arena.ground.sizeCm[0] / 100, depthM: scenario.arena.ground.sizeCm[1] / 100 };
  for (let i = 0; i < 5; i++) studio.freeViewPose(span, free, 40, aspect, safe, minRobot); // warm the JIT
  const n = 40;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) studio.freeViewPose(span, free, 40, aspect, safe, minRobot);
  const ms = (performance.now() - t0) / n;
  console.log(`${key}: ${ms.toFixed(2)} ms per call (mean of ${n}), route points ${free.route.length}, goals ${free.goals.length}`);
}
await server.close();
