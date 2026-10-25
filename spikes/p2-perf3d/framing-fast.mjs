// N18 P2 spike (evidence for p2-audit.md): how much cheaper the free view's framing gets when framePoints' fit test makes the camera's
// axes once per pose instead of once per point, makes no array per point and stops at the first point outside the free area, with the
// same arithmetic in the same order (so the same poses, to the last bit, and camera-studio.test.ts unchanged). It writes that variant
// of src/ui/robot3d/camera-studio.ts to node_modules/.cache/p2-spike/, loads both through Vite's SSR loader and compares their poses
// (JSON, every digit) for four HUD heights and their time (mean of 40 calls). Run from the repository root:
//   node spikes/p2-perf3d/framing-fast.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const source = readFileSync(join(root, 'src/ui/robot3d/camera-studio.ts'), 'utf8');
const slow = `  const room = (pose: CameraPose) => {
    let [left, rightRoom, bottom, top] = [Infinity, Infinity, Infinity, Infinity];
    for (const point of points) {
      const relative: Vec3Tuple = [point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]];
      if (dot(relative, [-toCamera[0], -toCamera[1], -toCamera[2]]) <= 1e-6) return null;
      const [x, y] = projectToScreen(point, pose, fovDeg, aspect);
      left = Math.min(left, x - rect.left);
      rightRoom = Math.min(rightRoom, rect.right - x);
      bottom = Math.min(bottom, y - safeBottom(x, rect));
      top = Math.min(top, safeTop(x, rect) - y);
    }
    return { left, right: rightRoom, bottom, top };
  };
  const fits = (distance: number, at: Vec3Tuple) => {
    const r = room(poseAt(distance, at));
    return r !== null && r.left >= 0 && r.right >= 0 && r.bottom >= 0 && r.top >= 0;
  };`;
const fast = `  const fits = (distance: number, at: Vec3Tuple) => {
    const px = at[0] + toCamera[0] * distance;
    const py = at[1] + toCamera[1] * distance;
    const pz = at[2] + toCamera[2] * distance;
    const cx = px - at[0];
    const cy = py - at[1];
    const cz = pz - at[2];
    const length = Math.hypot(cx, cy, cz);
    const { forward, right: r, up: u } = axesOf([cx / length, cy / length, cz / length]);
    const tanP = Math.tan((fovDeg * Math.PI) / 360);
    for (const point of points) {
      const rx = point[0] - px;
      const ry = point[1] - py;
      const rz = point[2] - pz;
      if (rx * -toCamera[0] + ry * -toCamera[1] + rz * -toCamera[2] <= 1e-6) return false;
      const depth = rx * forward[0] + ry * forward[1] + rz * forward[2];
      const x = (rx * r[0] + ry * r[1] + rz * r[2]) / depth / (tanP * aspect);
      const y = (rx * u[0] + ry * u[1] + rz * u[2]) / depth / tanP;
      if (x - rect.left < 0 || rect.right - x < 0 || y - safeBottom(x, rect) < 0 || safeTop(x, rect) - y < 0) return false;
    }
    return true;
  };`;
if (!source.includes(slow)) throw new Error('camera-studio.ts no longer has the fit test this spike replaces.');
const out = join(root, 'node_modules/.cache/p2-spike');
mkdirSync(out, { recursive: true });
const fastFile = join(out, 'camera-studio-fast.ts');
writeFileSync(fastFile, source.replace(slow, fast).replace("from './camera'", `from '${join(root, 'src/ui/robot3d/camera')}'`).replace("from './scene-math'", `from '${join(root, 'src/ui/robot3d/scene-math')}'`));

const { createServer } = await import(join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, cacheDir: join(root, 'node_modules/.cache/p2-micro-vite'), optimizeDeps: { noDiscovery: true, include: [] } });
const base = await server.ssrLoadModule('/src/ui/robot3d/camera-studio.ts');
const quick = await server.ssrLoadModule(fastFile);
const { scenarioCatalog } = await server.ssrLoadModule('/src/samples/robot-scenarios/index.ts');
const boxTopCorners = (box) => {
  const [c, s] = [Math.cos((box.yawDeg * Math.PI) / 180), Math.sin((box.yawDeg * Math.PI) / 180)];
  return [-1, 1].flatMap((dx) => [-1, 1].map((dy) => [box.centerCm[0] + ((dx * box.sizeCm[0]) / 2) * c - ((dy * box.sizeCm[1]) / 2) * s, box.centerCm[1] + ((dx * box.sizeCm[0]) / 2) * s + ((dy * box.sizeCm[1]) / 2) * c, box.sizeCm[2]]));
};
const aspect = 660 / 497;
const minRobot = (2 * base.MIN_ROBOT_PX) / 660;
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
  let same = true;
  for (const hudBottom of [0.5, 0.35, 0.2, 0.05]) {
    const safe = { ...base.VIEW_SAFE_RECT, hud: { right: -0.08, bottom: hudBottom }, tools: { right: -0.7, top: -0.6 } };
    same &&= JSON.stringify(base.freeViewPose(span, free, 40, aspect, safe, minRobot)) === JSON.stringify(quick.freeViewPose(span, free, 40, aspect, safe, minRobot));
  }
  const safe = { ...base.VIEW_SAFE_RECT, hud: { right: -0.08, bottom: 0.35 }, tools: { right: -0.7, top: -0.6 } };
  const time = (lib) => {
    for (let i = 0; i < 5; i++) lib.freeViewPose(span, free, 40, aspect, safe, minRobot);
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) lib.freeViewPose(span, free, 40, aspect, safe, minRobot);
    return (performance.now() - t0) / 40;
  };
  const [a, b] = [time(base), time(quick)];
  console.log(`${key}: ${a.toFixed(2)} → ${b.toFixed(2)} ms per call (${(a / b).toFixed(1)}×), the same poses: ${same}`);
}
await server.close();
