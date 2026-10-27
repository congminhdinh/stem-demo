// N19 E8: the gallery of the gripper car on its four real lessons, for the independent visual review. Evidence, not product code.
//
//   node spikes/n19-e8/gallery.mjs --out=<dir> [--port=5542] [--only=<substring of a shot's name>] [--skip-cvd]
//
// It starts this tree's dev server on --port and the lesson page (e2e/lesson-host.mjs) on --port + 1, and stops both when done. Each lesson
// opens as the LMS frames it (?embed=1&lab=robot&template=rb-grip-*, 1100 × 640, Vietnamese) in Chromium new headless on the machine's GPU,
// at 1200 × 760, reduced motion (no camera glide, no damping), the low tier's frame-rate chain pinned off; its reference solution
// (src/samples/robot-solutions.ts) is loaded and stepped with Bước to the moments of e2e/gripper-moments.ts (0.1 s of simulated time a
// click, the run paused: the same world on every run, no wall-clock wait). Lesson 10's red and blue rounds are Kiểm tra's rounds 2 and 3
// shown by Xem lại (with the reference held to the end, gripper-moments.ts `holdAtEnd`, so that each round fails and offers it), paused,
// put back to their start and stepped like the rest. Every shot is checked against the moment's world before it is taken.
//
// What it writes in --out:
//   3d/<lesson>-<tier>-<moment>[-<colour>]-<view>.png   the 3D view's canvas (the HUD and the tags over it, as the learner sees them):
//     free        "Tự do" as it starts;                   free-close   "Tự do" panned to the car, turned to the claw and zoomed in;
//     follow      "Theo xe" as it starts;                 follow-close "Theo xe" zoomed in and turned to the claw;
//   2d/<lesson>-2d-<moment>[-<colour>]-map.png            "Xem 2D", the whole map at DPR 1 (a school PC's);
//   2d/<lesson>-2d-<moment>[-<colour>]-crop.png           the map round the car at DPR 3;
//   cvd/<name>-deuteranopia.png, -protanopia.png         lesson 10's start and red and blue carries, as Machado et al. 2009 (severity
//                                                          1.0) see them (e2e/color-vision.ts), every 3D view, the map and its crop;
//   index.md                                              every shot with its moment's world (time, pose, arm, claw, what is held);
//   cvd-marks.txt                                         the cube's mark mask on the DPR 3 map in each of the three, under each
//                                                          vision (the spec recognises them on chromium-robot).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')).map(([key, value]) => [key, value ?? 'true']));
if (!args.out) throw new Error('Usage: node spikes/n19-e8/gallery.mjs --out=<dir> [--port=5542] [--only=<substring>] [--skip-cvd]');
const out = resolve(args.out);
const port = Number(args.port ?? 5542);
for (const dir of ['3d', '2d', 'cvd']) mkdirSync(join(out, dir), { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const want = (name) => !args.only || name.includes(args.only);

const { gripperLessonRuns, holdAtEnd, shotName } = await import(join(root, 'e2e/gripper-moments.ts'));
const { simulateImage, markMask } = await import(join(root, 'e2e/color-vision.ts'));
const { decodePng, writePng } = await import(join(root, 'scripts/lib/png.ts'));
const { robotSolutions } = await import(join(root, 'src/samples/robot-solutions.ts'));
const scenarios = Object.fromEntries(['pick', 'deliver', 'sort', 'stack'].map((name) => [`rb-grip-${name}`, JSON.parse(readFileSync(join(root, `src/samples/robot-scenarios/rb-grip-${name}.json`), 'utf8'))]));

const project = (key, blocks) => ({
  schemaVersion: 1,
  id: `e8-${key}`,
  name: 'Robot',
  profile: 'uno-basic',
  kit: { id: 'ref-uno-gripper', version: '0' },
  circuit: { components: [{ id: 'uno', deviceType: 'uno-r3', position: { x: 300, y: 200 } }], wires: [] },
  program: { blocks },
});

// The servers -----------------------------------------------------------------------------------------------------------------------
const kids = [
  spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.execPath, [join(root, 'e2e/lesson-host.mjs'), String(port + 1)], { cwd: root, stdio: 'ignore' }),
];
const labOrigin = `http://localhost:${port}`;
const hostOrigin = `http://localhost:${port + 1}`;
for (const url of [labOrigin, `${hostOrigin}/lesson`]) {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 100) throw new Error(`${url} did not come up`);
    await sleep(200);
  }
}

// The lab ---------------------------------------------------------------------------------------------------------------------------
async function openLesson(browser, key, { dpr = 1, tier = null, view2d = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const lab = `${labOrigin}/?embed=1&lab=robot&template=${key}&origin=${encodeURIComponent(hostOrigin)}`;
  await page.goto(`${hostOrigin}/lesson?lab=${encodeURIComponent(lab)}&sandbox=${encodeURIComponent('allow-scripts allow-same-origin allow-downloads')}`);
  const frame = page.frames().find((candidate) => candidate.url().includes('lab=robot'));
  const drawn = () => frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 90_000 });
  await drawn();
  await frame.waitForFunction(() => window.__stem?.robot !== undefined);
  await frame.evaluate(() => window.__stem.robot.setLowTierChain('off'));
  if (tier !== null && (await frame.getByTestId('robot-quality').getAttribute('data-tier')) !== tier) {
    await frame.getByTestId('robot-quality').click();
    await sleep(300);
    await drawn();
  }
  if (view2d) {
    await frame.getByTestId('robot-viewmode').click();
    await frame.locator('[data-testid=robot-topview] canvas').first().waitFor({ timeout: 60_000 });
  }
  return { context, page, frame, errors };
}

const snapshot = (frame) => frame.evaluate(() => window.__stem.robot.getSnapshot());

/** Bước until the run's time is `steps` tenths of a second (from where it is). */
async function stepTo(frame, steps) {
  await frame.evaluate(async (target) => {
    const button = document.querySelector('[data-testid=robot-step]');
    const tenths = () => Math.round((window.__stem.robot.getSnapshot()?.t ?? 0) * 10);
    const tick = () => new Promise((done) => setTimeout(done, 0));
    while (tenths() < target) {
      const before = tenths();
      button.click();
      const since = performance.now();
      while (tenths() === before && performance.now() - since < 3000) await tick();
    }
  }, steps);
  const world = await snapshot(frame);
  if (steps > 0 && Math.round(world.t * 10) !== steps) throw new Error(`Stepped to ${world.t} s, not ${steps / 10}`);
}

/** Kiểm tra (Nhanh) of the reference held to the end, then Xem lại lượt `round`, paused and put back to its start. */
async function showRound(frame, key, round) {
  await frame.evaluate((document) => window.__stem.loadProject(document), project(key, holdAtEnd(robotSolutions[key].reference)));
  await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
  await frame.getByTestId('robot-check-start').click();
  await frame.getByTestId(`robot-check-replay-${round}`).waitFor({ timeout: 90_000 });
  await frame.getByTestId(`robot-check-replay-${round}`).click();
  await frame.waitForFunction(() => (window.__stem.robot.getSnapshot()?.t ?? 0) > 0);
  await frame.getByTestId('robot-pause').click();
  await frame.getByTestId('robot-reset').click();
  await frame.waitForFunction(() => window.__stem.robot.getSnapshot()?.t === 0);
  // The folded results card would stand over the view in every shot.
  await frame.getByTestId('robot-check-close').click();
  const label = await frame.getByTestId('robot-round').textContent();
  if (label !== `Lượt ${round}/3`) throw new Error(`The view shows "${label}", not round ${round}`);
}

/** The moment's world is the trace's (gripper-moments.ts), or this throws. */
function checkMoment(world, moment, name) {
  const { expect } = moment;
  const g = world.robot.gripper;
  const object = world.objects.find((candidate) => candidate.id === expect.object.id);
  const within = (value, [low, high]) => value >= low && value <= high;
  const turn = Math.abs(((world.robot.yawDeg - expect.yawDeg + 540) % 360) - 180);
  const problems = [
    g.heldId !== expect.heldId && `held ${g.heldId}`,
    !within(g.liftDeg, expect.liftDeg) && `lift ${g.liftDeg}`,
    !within(g.clawDeg, expect.clawDeg) && `claw ${g.clawDeg}`,
    !within(object.pose.zCm, expect.object.zCm) && `z ${object.pose.zCm}`,
    expect.object.at && Math.hypot(object.pose.xCm - expect.object.at[0], object.pose.yCm - expect.object.at[1]) > 0.05 && `at ${object.pose.xCm}, ${object.pose.yCm}`,
    turn > 1 && `yaw ${world.robot.yawDeg}`,
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`${name}: ${problems.join(', ')}`);
  return `t ${world.t.toFixed(1)} s; car (${world.robot.xCm.toFixed(1)}, ${world.robot.yCm.toFixed(1)}) ${world.robot.yawDeg.toFixed(1)}°; arm ${g.liftDeg.toFixed(1)}°, claw ${g.clawDeg.toFixed(1)}°; held ${g.heldId ?? '—'}; ${object.id} (${object.pose.xCm.toFixed(1)}, ${object.pose.yCm.toFixed(1)}, z ${object.pose.zCm.toFixed(2)})`;
}

// The camera ------------------------------------------------------------------------------------------------------------------------
const canvasOf = (frame) => frame.locator('[data-testid=robot-canvas] canvas');
/** The camera's distance (m), azimuth and polar angle (degrees) as the rig writes them on the canvas. */
async function cameraPose(frame) {
  const [distance, azimuth, polar] = (await canvasOf(frame).getAttribute('data-camera')).split(' ').map(Number);
  return { distance, azimuth, polar };
}
const settle = async (frame) => {
  await sleep(150);
  await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await sleep(450);
};
/** Presses a camera key on the view, then waits for two of its frames (the rig applies the step, "Theo xe" follows it in its frame). */
async function key(frame, name, times = 1) {
  await frame.locator('.robot-stage').focus();
  for (let i = 0; i < times; i++) {
    await frame.locator('.robot-stage').press(name);
    await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  }
}
/** Orbit (Shift + arrows, 7.5° a step) to `azimuth` and `polar`, within half a step (Shift + ArrowRight turns the azimuth up). */
async function orbitTo(frame, azimuth, polar) {
  for (let i = 0; i < 60; i++) {
    const off = ((azimuth - (await cameraPose(frame)).azimuth + 540) % 360) - 180;
    if (Math.abs(off) <= 3.75) break;
    await key(frame, off > 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft');
  }
  for (let i = 0; i < 20; i++) {
    const off = polar - (await cameraPose(frame)).polar;
    if (Math.abs(off) <= 3.75) break;
    const before = (await cameraPose(frame)).polar;
    await key(frame, off > 0 ? 'Shift+ArrowDown' : 'Shift+ArrowUp');
    if ((await cameraPose(frame)).polar === before) break;
  }
}
/** Zoom (+, × 0.85 a step) until the camera is at most `metres` from what it looks at. */
async function zoomTo(frame, metres) {
  for (let i = 0; i < 40 && (await cameraPose(frame)).distance > metres; i++) await key(frame, '+');
}
/**
 * The pan of "Tự do" onto `point` (arena cm): the camera and what it looks at moved together until that is `point`, what a right-drag
 * pan of the learner's does (OrbitControls' pan translates both). Done on the rig's own controls, read in its frame: under the dev
 * server's StrictMode the rig's useMemo makes its RigControls twice, and the one it drops stays connected to the canvas, so a mouse drag
 * is applied by both, about two targets, and turns the camera (measured: 1.85° of azimuth for 25 px across at 2.1 m; one controls' own
 * `_pan`, called alone, keeps the angles exactly). Production has one. The rig's controls are the ones its camera keys update.
 */
async function panTo(frame, point) {
  await frame.evaluate(async () => {
    const { RigControls } = await import('/src/ui/robot3d/rig-controls.ts');
    if (RigControls.prototype.e8Seen) return;
    const update = Object.getPrototypeOf(RigControls.prototype).update;
    RigControls.prototype.update = function (...rest) {
      window.__e8Rig = this;
      return update.apply(this, rest);
    };
    RigControls.prototype.e8Seen = true;
  });
  // A step out and back in: the rig's key handler updates its own controls (the dropped one sees no key).
  await key(frame, '-');
  await key(frame, '+');
  await frame.evaluate(async ([x, y, z]) => {
    const { arenaToThree } = await import('/src/ui/robot3d/scene-math.ts');
    const controls = window.__e8Rig;
    const [tx, ty, tz] = arenaToThree(x, y, z);
    controls.object.position.add({ x: tx - controls.target.x, y: ty - controls.target.y, z: tz - controls.target.z });
    controls.target.set(tx, ty, tz);
    controls.update();
  }, point);
  await settle(frame);
}
/** A point `ahead` cm in front of the car's middle, `up` cm over the floor (arena cm). */
const aheadOf = (world, ahead, up) => {
  const yaw = (world.robot.yawDeg * Math.PI) / 180;
  return [world.robot.xCm + ahead * Math.cos(yaw), world.robot.yCm + ahead * Math.sin(yaw), up];
};
async function cameraMode(frame, mode) {
  await frame.locator(`[data-testid=robot-camera] [data-mode=${mode}]`).click();
  await frame.getByTestId('robot-camera-reset').click();
  await settle(frame);
}

/**
 * The 3D views of a moment. `close`: the azimuth of the close-ups relative to the car's heading (45: from its front right, −45 its
 * front left, 135 its back right...), the polar angle and the distance.
 */
const views = {
  free: async (frame) => cameraMode(frame, 'orbit'),
  follow: async (frame) => cameraMode(frame, 'follow'),
  'free-close': async (frame, page, world, close) => {
    await cameraMode(frame, 'orbit');
    await panTo(frame, aheadOf(world, close.ahead, close.up));
    await orbitTo(frame, 90 + world.robot.yawDeg + close.side, close.polar);
    await zoomTo(frame, close.distance);
    await settle(frame);
  },
  // The deck from high over the rover's buzzer spot (−5, 3), where the low tier left a faint mark (E6/E7 re-review N3): lesson 8's start.
  'deck-close': async (frame, page, world) => {
    await cameraMode(frame, 'orbit');
    const yaw = (world.robot.yawDeg * Math.PI) / 180;
    const [u, v] = [-3, 1.5];
    await panTo(frame, [world.robot.xCm + u * Math.cos(yaw) - v * Math.sin(yaw), world.robot.yCm + u * Math.sin(yaw) + v * Math.cos(yaw), 6.5]);
    await orbitTo(frame, 90 + world.robot.yawDeg + 180, 22);
    await zoomTo(frame, 0.2);
    await settle(frame);
  },
  // The jaws from high over them (the IR beam and the colour ray between them, under the claw servo: E4/E5 re-review).
  'above-close': async (frame, page, world, close) => {
    await cameraMode(frame, 'orbit');
    await panTo(frame, aheadOf(world, close.ahead + 2, close.up));
    await orbitTo(frame, 90 + world.robot.yawDeg + 180, 12);
    await zoomTo(frame, 0.22);
    await settle(frame);
  },
  'follow-close': async (frame, page, world, close) => {
    await cameraMode(frame, 'follow');
    await orbitTo(frame, 90 + world.robot.yawDeg + close.side, close.polar);
    await zoomTo(frame, close.distance);
    await settle(frame);
  },
};
/** Which views each moment is shot in, and where the close-ups look from (relative to the car's heading, degrees; polar; metres). */
const plan = {
  start: { views: ['free', 'follow', 'deck-close'], close: null },
  approach: { views: ['free-close', 'above-close'], close: { side: -40, polar: 55, distance: 0.3, ahead: 9, up: 2 } },
  grasp: { views: ['follow-close', 'free-close', 'above-close'], close: { side: -50, polar: 58, distance: 0.34, ahead: 7, up: 3 } },
  carry: { views: ['follow', 'free-close'], close: { side: -60, polar: 62, distance: 0.42, ahead: 5, up: 6 } },
  release: { views: ['follow-close', 'free-close'], close: { side: -55, polar: 55, distance: 0.38, ahead: 9, up: 5 } },
};


/**
 * The 2D map's own picture: its layers' canvases drawn in order over the map's background (a PNG data URL, at the page's DPR); `layers` 2
 * for the mat and the bodies alone (the objects with their marks and the car, none of the sensors' overlays or the tools over them).
 */
const mapPicture = (frame, count = Infinity) =>
  frame.evaluate((count) => {
    const host = document.querySelector('[data-testid=robot-topview]');
    const layers = [...host.querySelectorAll('canvas')].slice(0, count);
    const out = document.createElement('canvas');
    [out.width, out.height] = [layers[0].width, layers[0].height];
    const ctx = out.getContext('2d');
    ctx.fillStyle = getComputedStyle(host).backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
    for (const layer of layers) ctx.drawImage(layer, 0, 0);
    return out.toDataURL('image/png');
  }, count);
const rgbOf = (image) => {
  if (image.channels === 3) return image;
  const data = new Uint8Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) data.set(image.data.subarray(i * image.channels, i * image.channels + 3), i * 3);
  return { width: image.width, height: image.height, channels: 3, data };
};
const crop = (image, left, top, width, height) => {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) data.set(image.data.subarray(((top + y) * image.width + left) * 3, ((top + y) * image.width + left + width) * 3), y * width * 3);
  return { width, height, channels: 3, data };
};
const save = (path, image) =>
  writePng(path, { width: image.width, height: image.height, pixelsPerMetre: 3780 }, (function* () {
    for (let y = 0; y < image.height; y += 64) yield image.data.subarray(y * image.width * 3, Math.min(image.height, y + 64) * image.width * 3);
  })());

// The shots -------------------------------------------------------------------------------------------------------------------------
const index = [];
const cvdSources = [];
const cvdMarks = [];
const isCvd = (run, moment) => run.key === 'rb-grip-sort' && (moment.name === 'start' || (moment.name === 'carry' && run.round > 1));

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
try {
  const lessons = [...new Set(gripperLessonRuns.map((run) => run.key))];
  for (const key of lessons) {
    const runs = gripperLessonRuns.filter((run) => run.key === key);
    for (const tier of ['high', 'low']) {
      if (!runs.some((run) => run.moments.some((moment) => plan[moment.name].views.some((view) => want(`3d/${shotName(run, tier, moment.name, view)}`))))) continue;
      const lab = await openLesson(browser, key, { tier });
      for (const run of runs) {
        if (run.round === 1) await lab.frame.evaluate((document) => window.__stem.loadProject(document), project(key, robotSolutions[key].reference));
        else await showRound(lab.frame, key, run.round);
        for (const moment of run.moments) {
          await stepTo(lab.frame, moment.steps);
          const world = await snapshot(lab.frame);
          for (const view of plan[moment.name].views) {
            const name = `3d/${shotName(run, tier, moment.name, view)}`;
            if (!want(name) || (view === 'deck-close' && key !== 'rb-grip-pick')) continue;
            await views[view](lab.frame, lab.page, world ?? { robot: { ...scenarios[key].start } }, plan[moment.name].close);
            const state = moment.steps === 0 && world === null ? 'nothing run: the lesson as it opens' : checkMoment(await snapshot(lab.frame), moment, name);
            const file = join(out, `${name}.png`);
            writeFileSync(file, await canvasOf(lab.frame).screenshot());
            const pose = await cameraPose(lab.frame);
            index.push({ name, state, camera: `${pose.distance.toFixed(2)} m, azimuth ${pose.azimuth.toFixed(0)}°, polar ${pose.polar.toFixed(0)}°` });
            if (isCvd(run, moment)) cvdSources.push(name);
            process.stdout.write(`${name}\n`);
          }
        }
      }
      if (lab.errors.length > 0) throw new Error(`${key} ${tier}: ${lab.errors.join(' | ')}`);
      await lab.context.close();
    }
    // The map: the whole of it at DPR 1, and round the car at DPR 3 (where the colour-blind check reads the cube's mark).
    for (const dpr of [1, 3]) {
      const suffix = dpr === 1 ? 'map' : 'crop';
      if (!runs.some((run) => run.moments.some((moment) => want(`2d/${shotName(run, '2d', moment.name, suffix)}`)))) continue;
      const lab = await openLesson(browser, key, { dpr, view2d: true });
      const map = lab.frame.getByTestId('robot-topview');
      for (const run of runs) {
        if (run.round === 1) await lab.frame.evaluate((document) => window.__stem.loadProject(document), project(key, robotSolutions[key].reference));
        else await showRound(lab.frame, key, run.round);
        for (const moment of run.moments) {
          const name = `2d/${shotName(run, '2d', moment.name, suffix)}`;
          await stepTo(lab.frame, moment.steps);
          if (!want(name)) continue;
          await sleep(700);
          const world = await snapshot(lab.frame);
          const state = world === null ? 'nothing run: the lesson as it opens' : checkMoment(world, moment, name);
          if (dpr === 1) {
            writeFileSync(join(out, `${name}.png`), await map.screenshot({ animations: 'disabled' }));
          } else {
            // The map's own picture (its layers' canvases, the HUD that floats over its top left corner left out: in lesson 10's red round
            // the car is under it), round the car: 64 × 40 cm of the arena (clipped to the map), centred 6 cm ahead of the car's middle.
            const picture = rgbOf(decodePng(Buffer.from((await mapPicture(lab.frame)).split(',')[1], 'base64')));
            const view = await lab.frame.evaluate(async () => (await import('/src/ui/robot3d/top-view-state.ts')).readTopViewState());
            const [widthCm, depthCm] = scenarios[key].arena.ground.sizeCm;
            const fit = { scale: view.scale, originX: 14 + (view.stage.width - 28 - widthCm * view.scale) / 2, originY: 14 + (view.stage.height - 54 - depthCm * view.scale) / 2 + depthCm * view.scale };
            const robot = world?.robot ?? { ...scenarios[key].start };
            const yaw = (robot.yawDeg * Math.PI) / 180;
            const [cx, cy] = [fit.originX + (robot.xCm + 6 * Math.cos(yaw)) * fit.scale, fit.originY - (robot.yCm + 6 * Math.sin(yaw)) * fit.scale];
            const [w, h] = [Math.min(64 * fit.scale, view.stage.width), Math.min(40 * fit.scale, view.stage.height)];
            const [left, top] = [Math.max(0, Math.min(view.stage.width - w, cx - w / 2)), Math.max(0, Math.min(view.stage.height - h, cy - h / 2))];
            await save(join(out, `${name}.png`), crop(picture, Math.round(left * dpr), Math.round(top * dpr), Math.round(w * dpr), Math.round(h * dpr)));
            // The mark is read on the mat and the bodies alone: the sensors' overlays (the cone's lines, the colour spot) lie over the cube.
            const bodies = rgbOf(decodePng(Buffer.from((await mapPicture(lab.frame, 2)).split(',')[1], 'base64')));
            if (isCvd(run, moment)) cvdMarks.push({ name, picture: bodies, fit, cube: world === null ? { xCm: 49, yCm: 75, yawDeg: 0 } : world.objects.find((object) => object.id === 'cube').pose, dpr });
          }
          index.push({ name, state, camera: dpr === 1 ? 'map, DPR 1 (as the learner sees it, the HUD over it)' : "the map's own layers round the car, DPR 3 (the HUD over the map left out)" });
          if (isCvd(run, moment)) cvdSources.push(name);
          process.stdout.write(`${name}\n`);
        }
      }
      if (lab.errors.length > 0) throw new Error(`${key} 2D: ${lab.errors.join(' | ')}`);
      await lab.context.close();
    }
  }
} finally {
  await browser.close();
  kids.forEach((kid) => kid.kill());
}

// The colour-blind versions ---------------------------------------------------------------------------------------------------------
const visions = ['deuteranopia', 'protanopia'];
if (args['skip-cvd'] !== 'true') {
  for (const name of cvdSources) {
    const image = rgbOf(decodePng(readFileSync(join(out, `${name}.png`))));
    for (const vision of visions) await save(join(out, 'cvd', `${name.split('/')[1]}-${vision}.png`), simulateImage(image, vision));
  }
}

// The cube's mark on the map in lesson 10's three shots, as each vision sees it: a 24 × 24 mask of the far 2.4 cm of its top face, sampled in
// the cube's own frame on the map's mat and bodies (no overlay over them), for the review to see. The test is the spec's
// (e2e/robot-lab-gripper-look.spec.ts: each mask recognised against the three marks' own pictures, three different marks).
const report = [];
if (cvdMarks.length > 0) {
  const SIZE = 24;
  const maskOf = (entry, image) =>
    markMask(image, SIZE, (i, j) => {
      const [u, v] = [-0.7 + (i + 0.5) * 0.1, 1.2 - (j + 0.5) * 0.1];
      const yaw = (entry.cube.yawDeg * Math.PI) / 180;
      const [x, y] = [entry.cube.xCm + u * Math.cos(yaw) - v * Math.sin(yaw), entry.cube.yCm + u * Math.sin(yaw) + v * Math.cos(yaw)];
      return [(entry.fit.originX + x * entry.fit.scale) * entry.dpr, (entry.fit.originY - y * entry.fit.scale) * entry.dpr];
    });
  for (const vision of ['normal', ...visions]) {
    const masks = cvdMarks.map((entry) => ({ name: entry.name, mask: maskOf(entry, vision === 'normal' ? entry.picture : simulateImage(entry.picture, vision)) }));
    report.push(`## ${vision}`);
    for (const { name, mask } of masks) {
      report.push(`${name}: ink ${(100 * mask.inkShare).toFixed(1)} % of the face, class contrast ${mask.contrast.toFixed(2)}:1`);
      for (let j = 0; j < SIZE; j++) report.push(`    ${Array.from({ length: SIZE }, (_, i) => (mask.cells[j * SIZE + i] ? '#' : '.')).join('')}`);
    }
    report.push('');
  }
  writeFileSync(join(out, 'cvd-marks.txt'), `${report.join('\n')}\n`);
}

// The index -------------------------------------------------------------------------------------------------------------------------
const lines = ['# N19 E8 gallery', '', `node spikes/n19-e8/gallery.mjs --out=${out} --port=${port}`, '', '| Shot | World at the moment | Camera |', '|---|---|---|'];
for (const shot of index) lines.push(`| ${shot.name}.png | ${shot.state} | ${shot.camera} |`);
if (cvdSources.length > 0) {
  lines.push('', '## Colour-blind (Machado et al. 2009, severity 1.0, linear RGB)', '');
  for (const name of cvdSources) lines.push(`- ${name}.png → ${visions.map((vision) => `cvd/${name.split('/')[1]}-${vision}.png`).join(', ')}`);
}
writeFileSync(join(out, 'index.md'), `${lines.join('\n')}\n`);
process.stdout.write(`${index.length} shots, ${cvdSources.length * 2} colour-blind versions in ${out}\n`);
