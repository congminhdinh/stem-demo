import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../scripts/lib/png';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import type { TopViewGripperState } from '../src/ui/robot3d/top-view-gripper-state';
import type { TopViewState } from '../src/ui/robot3d/top-view-state';
import type { BodyMark } from '../src/ui/robot3d/body-marks';
import { markPattern, OBJECT_PATTERN_MARGIN_CM, patternDots, patternSegments } from '../src/ui/robot3d/zone-pattern';
import { markMask, maskAgreement, simulateColor, simulateImage, type ColorVision, type MarkMask, type Pixels } from './color-vision';
import { gripperLessonRuns, holdAtEnd, shotName, type GripperLessonRun, type GripperMoment } from './gripper-moments';
import { pinLowTierChainOff } from './robot-chain';

// N19 E8: the gripper car on its four real lessons, in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts,
// project chromium-robot). Each lesson's reference solution is stepped with Bước to the moments of gripper-moments.ts (0.1 s of simulated
// time a click, the run paused: no wall-clock wait), lesson 10's red and blue rounds shown as the lab shows a check's round (Kiểm tra, Xem
// lại, paused and put back to its start): at each moment the world is the reference's (its trace, spikes/n19-e8), the 3D view is the
// modelled scene and a real 3D draw (shading and many colours, as robot-lab-look.spec.ts measures) on the high and the low tier, and the
// 2D map's tag of the gripper's sensors covers neither the car, the held ring nor the distance tag. Lesson 10's three cubes (green, red,
// blue) are told apart by their marks on the map for a deuteranope and a protanope (Machado et al. 2009, severity 1.0: color-vision.ts),
// where their fills are not. The shots go to E8_SHOTS_DIR, or under test-results; the GPU gallery for the review is spikes/n19-e8/gallery.mjs.

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.E8_SHOTS_DIR ?? join('test-results', 'robot-lab-gripper-look');

type World = {
  t: number;
  robot: { xCm: number; yCm: number; yawDeg: number; gripper: { clawDeg: number; liftDeg: number; heldId: string | null } };
  objects: { id: string; pose: { xCm: number; yCm: number; zCm: number; yawDeg: number } }[];
};

const labUrl = (baseURL: string | undefined, key: string) => new URL(`/?embed=1&lab=robot&template=${key}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;
const projectOf = (key: GripperLessonRun['key'], hold = false) => ({ ...robotStarterDocument(key), program: { blocks: hold ? holdAtEnd(robotSolutions[key].reference) : robotSolutions[key].reference } });

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('The lab iframe has no frame');
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await pinLowTierChainOff(frame);
  return frame;
}

/** Reads a 24 × 16 grid of the drawing buffer's pixels at every draw to the screen (robot-lab-look.spec.ts). */
function sampleDraws() {
  const probe = window as unknown as { __look: number[][] };
  probe.__look = [];
  const clear = WebGL2RenderingContext.prototype.clear;
  WebGL2RenderingContext.prototype.clear = function (this: WebGL2RenderingContext, mask: number) {
    if (this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
      queueMicrotask(() => {
        const pixels: number[][] = [];
        for (let i = 0; i < 24; i += 1) {
          for (let j = 0; j < 16; j += 1) {
            const pixel = new Uint8Array(4);
            this.readPixels(Math.floor((this.drawingBufferWidth * (i + 0.5)) / 24), Math.floor((this.drawingBufferHeight * (j + 0.5)) / 16), 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
            pixels.push([pixel[0]!, pixel[1]!, pixel[2]!]);
          }
        }
        probe.__look = pixels;
      });
    }
    clear.call(this, mask);
  };
}
function look(pixels: number[][]) {
  const luma = pixels.map(([r, g, b]) => (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255);
  const mean = luma.reduce((sum, value) => sum + value, 0) / luma.length;
  const deviation = Math.sqrt(luma.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luma.length);
  return { deviation, colours: new Set(pixels.map((pixel) => pixel.map((c) => c >> 4).join(','))).size };
}

type NdcBox = { left: number; right: number; bottom: number; top: number };
type GripperTag = { shown: boolean; box: NdcBox; keepOut: NdcBox[]; keepOutCount: number };
/** The gripper's tag as the 3D view last laid it out (sensor-label-boxes.ts `gripperTagLayout`, the dev server's module), NDC. */
const gripperTag = (frame: Frame) =>
  frame.evaluate(async () => {
    const path = '/src/ui/robot3d/sensor-label-boxes.ts';
    // Two frames: the layout of the view as it is now.
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
    return structuredClone(((await import(/* @vite-ignore */ path)) as { gripperTagLayout: GripperTag }).gripperTagLayout);
  });
const ndcMeets = (a: NdcBox, b: NdcBox) => a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;

const snapshot = (frame: Frame) => frame.evaluate(() => window.__stem!.robot.getSnapshot()) as Promise<World | null>;

/** Bước until the run's time is `steps` tenths of a second. */
async function stepTo(frame: Frame, steps: number) {
  await frame.evaluate(async (target) => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid=robot-step]')!;
    const tenths = () => Math.round(((window.__stem!.robot.getSnapshot() as { t: number } | null)?.t ?? 0) * 10);
    const tick = () => new Promise((done) => setTimeout(done, 0));
    while (tenths() < target) {
      const before = tenths();
      button.click();
      const since = performance.now();
      while (tenths() === before && performance.now() - since < 5000) await tick();
    }
  }, steps);
}

/** Kiểm tra (Nhanh) of the reference held to the end, then Xem lại lượt `round`, paused and put back to its start; its card closed. */
async function showRound(frame: Frame, key: GripperLessonRun['key'], round: number) {
  await frame.evaluate((document) => window.__stem!.loadProject(document), projectOf(key, true));
  await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
  await frame.getByTestId('robot-check-start').click();
  await frame.getByTestId(`robot-check-replay-${round}`).click({ timeout: 90_000 });
  await expect.poll(async () => (await snapshot(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  await frame.getByTestId('robot-pause').click();
  await frame.getByTestId('robot-reset').click();
  await expect.poll(async () => (await snapshot(frame))?.t, { timeout: 30_000 }).toBe(0);
  await frame.getByTestId('robot-check-close').click();
  await expect(frame.getByTestId('robot-round')).toHaveText(`Lượt ${round}/3`);
}

/** Opens `run`'s round: a plain run of the reference, or a check's round shown by Xem lại. */
async function openRound(frame: Frame, run: GripperLessonRun) {
  if (run.round === 1) await frame.evaluate((document) => window.__stem!.loadProject(document), projectOf(run.key));
  else await showRound(frame, run.key, run.round);
}

/** The world at `moment` is the reference's there (gripper-moments.ts, from its trace). */
function expectMoment(world: World | null, moment: GripperMoment) {
  const { expect: wanted } = moment;
  if (moment.steps === 0 && world === null) return; // Nothing run: the lesson as it opens.
  expect(world).not.toBeNull();
  const { robot, objects } = world!;
  expect(robot.gripper.heldId).toBe(wanted.heldId);
  expect(robot.gripper.liftDeg).toBeGreaterThanOrEqual(wanted.liftDeg[0]);
  expect(robot.gripper.liftDeg).toBeLessThanOrEqual(wanted.liftDeg[1]);
  expect(robot.gripper.clawDeg).toBeGreaterThanOrEqual(wanted.clawDeg[0]);
  expect(robot.gripper.clawDeg).toBeLessThanOrEqual(wanted.clawDeg[1]);
  const object = objects.find((candidate) => candidate.id === wanted.object.id)!;
  expect(object.pose.zCm).toBeGreaterThanOrEqual(wanted.object.zCm[0]);
  expect(object.pose.zCm).toBeLessThanOrEqual(wanted.object.zCm[1]);
  if (wanted.object.at) expect(Math.hypot(object.pose.xCm - wanted.object.at[0], object.pose.yCm - wanted.object.at[1])).toBeLessThan(0.05);
  expect(Math.abs(((robot.yawDeg - wanted.yawDeg + 540) % 360) - 180)).toBeLessThan(1);
}

const shot = async (frame: Frame, name: string) => {
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, `${name}.png`), await frame.getByTestId('robot-canvas').locator('canvas').screenshot());
};
const lessons = [...new Set(gripperLessonRuns.map((run) => run.key))];

// A busy machine draws SwiftShader's high tier slowly: the limits are for a hang.
test.describe.configure({ timeout: 240_000 });

test.describe('the gripper car on its lessons, in 3D (N19 E8)', () => {
  for (const key of lessons) {
    for (const tier of ['high', 'low'] as const) {
      test(`${key} (${tier}): the reference at each moment is the reference's world, the modelled scene, a real 3D draw`, async ({ page, baseURL }) => {
        const errors: string[] = [];
        const looks: Record<string, { deviation: number; colours: number }> = {};
        const tags: Record<string, GripperTag> = {};
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.addInitScript(sampleDraws);
        const frame = await openInLesson(page, labUrl(baseURL, key));
        if ((await frame.getByTestId('robot-quality').getAttribute('data-tier')) !== tier) {
          await frame.getByTestId('robot-quality').click();
          await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
        }
        await expect(frame.getByTestId('robot-quality')).toHaveAttribute('data-tier', tier);
        for (const run of gripperLessonRuns.filter((candidate) => candidate.key === key)) {
          await openRound(frame, run);
          for (const moment of run.moments) {
            await stepTo(frame, moment.steps);
            expectMoment(await snapshot(frame), moment);
            // "Tự do" at the start, "Theo xe" after it (where the grasp and the carry are seen close).
            await frame.locator(`[data-testid=robot-camera] [data-mode=${moment.name === 'start' ? 'orbit' : 'follow'}]`).click();
            await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))));
            await expect(frame.getByTestId('robot-canvas').locator('canvas')).toHaveAttribute('data-models', 'modelled');
            // Review F1: in the lab's own cameras the sensors' tag covers neither the claw (the jaws' room with the claw servo) nor the
            // object held or ahead; a tag with no clear spot is not shown.
            const tag = await gripperTag(frame);
            tags[`${shotName(run, tier, moment.name, moment.name === 'start' ? 'free' : 'follow')}`] = tag;
            if (tag.shown) for (const keep of tag.keepOut.slice(0, tag.keepOutCount)) expect(ndcMeets(tag.box, keep), `${moment.name}: ${JSON.stringify(tag)}`).toBe(false);
            const { deviation, colours } = look(await frame.evaluate(() => (window as unknown as { __look: number[][] }).__look));
            const name = shotName(run, tier, moment.name, moment.name === 'start' ? 'free' : 'follow');
            looks[name] = { deviation: Math.round(deviation * 1000) / 1000, colours };
            // R4.7's bar for a 3D look (robot-lab-look.spec.ts).
            expect(deviation, name).toBeGreaterThan(0.08);
            expect(colours, name).toBeGreaterThanOrEqual(30);
            await shot(frame, name);
          }
        }
        mkdirSync(shots, { recursive: true });
        writeFileSync(join(shots, `looks-${key}-${tier}.json`), `${JSON.stringify(looks, null, 1)}\n`);
        writeFileSync(join(shots, `tags-${key}-${tier}.json`), `${JSON.stringify(tags, null, 1)}\n`);
        expect(errors).toEqual([]);
      });
    }
  }
});

const meets = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
type Map2D = { gripper: TopViewGripperState; view: TopViewState };
/** What the map drew, read by the very instances the lab runs on (the dev server's modules). */
const map2d = (frame: Frame) =>
  frame.evaluate(async () => {
    const [gripperPath, viewPath] = ['/src/ui/robot3d/top-view-gripper-state.ts', '/src/ui/robot3d/top-view-state.ts'];
    const gripper = (await import(/* @vite-ignore */ gripperPath)) as { readTopViewGripper(): TopViewGripperState };
    const view = (await import(/* @vite-ignore */ viewPath)) as { readTopViewState(): TopViewState };
    return { gripper: gripper.readTopViewGripper(), view: view.readTopViewState() };
  }) as Promise<Map2D>;

async function openMap(page: Page, baseURL: string | undefined, key: string) {
  const frame = await openInLesson(page, labUrl(baseURL, key));
  await frame.getByTestId('robot-viewmode').click();
  await frame.locator('[data-testid=robot-topview] canvas').first().waitFor({ timeout: 60_000 });
  return frame;
}

/**
 * The map's mat and bodies (its first two layers: the objects with their marks and the car; no sensor overlay over them), RGB, once the
 * map has drawn `world` (its nodes move at a publish, its canvas is drawn in the next animation frame).
 */
const bodiesOf = async (frame: Frame, world: World | null): Promise<Pixels> => {
  if (world !== null) await expect.poll(async () => Math.hypot((await map2d(frame)).view.robot!.xCm - world.robot.xCm, (await map2d(frame)).view.robot!.yCm - world.robot.yCm)).toBeLessThan(1e-6);
  const url = await frame.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
    const host = document.querySelector('[data-testid=robot-topview]')!;
    const layers = [...host.querySelectorAll('canvas')].slice(0, 2);
    const out = document.createElement('canvas');
    [out.width, out.height] = [layers[0]!.width, layers[0]!.height];
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(host).backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
    for (const layer of layers) ctx.drawImage(layer, 0, 0);
    return out.toDataURL('image/png');
  });
  const image = decodePng(Buffer.from(url.split(',')[1]!, 'base64'));
  return { width: image.width, height: image.height, channels: image.channels, data: image.data };
};


test.describe('the gripper car on its lessons, on the 2D map (N19 E8)', () => {
  for (const key of lessons) {
    test(`${key}: at each moment the sensors' tag covers neither the car, the held ring nor the distance tag; the held ring is round what is held`, async ({ page, baseURL }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      const frame = await openMap(page, baseURL, key);
      for (const run of gripperLessonRuns.filter((candidate) => candidate.key === key)) {
        await openRound(frame, run);
        for (const moment of run.moments.filter((candidate) => candidate.name !== 'start')) {
          await stepTo(frame, moment.steps);
          expectMoment(await snapshot(frame), moment);
          const { gripper } = await map2d(frame);
          expect(gripper.held!.visible, moment.name).toBe(moment.expect.heldId !== null);
          if (moment.expect.heldId !== null) expect(gripper.held!.id).toBe(moment.expect.heldId);
          const layout = gripper.tagLayout!;
          expect(layout, `${run.key} ${moment.name}`).not.toBeNull();
          expect(layout.clear, `${run.key} round ${run.round} ${moment.name}: ${JSON.stringify(layout)}`).toBe(true);
          expect(meets(layout.box, layout.car!)).toBe(false);
          if (layout.ring) expect(meets(layout.box, layout.ring)).toBe(false);
          for (const distance of layout.distances) expect(meets(layout.box, distance)).toBe(false);
          if (run.key === 'rb-grip-stack' && moment.name === 'release') {
            // Review F2: the red cube stacked on the yellow base is drawn over it: the map's middle of the cube is the cube's red (its fill or
            // its stripes' darker red), not the base's yellow.
            const world = (await snapshot(frame))!;
            const cube = world.objects.find((object) => object.id === 'cube')!.pose;
            const { view } = await map2d(frame);
            const picture = await bodiesOf(frame, world);
            const [x, y] = [14 + (view.stage.width - 28 - 200 * view.scale) / 2 + cube.xCm * view.scale, 14 + (view.stage.height - 54 - 80 * view.scale) / 2 + (80 - cube.yCm) * view.scale];
            const at = (Math.round(y) * picture.width + Math.round(x)) * picture.channels;
            const [r, g, b] = [picture.data[at]!, picture.data[at + 1]!, picture.data[at + 2]!];
            expect(r - g, `the cube's middle is ${[r, g, b]}`).toBeGreaterThan(60);
            expect(r - b, `the cube's middle is ${[r, g, b]}`).toBeGreaterThan(60);
          }
          mkdirSync(shots, { recursive: true });
          writeFileSync(join(shots, `${shotName(run, '2d', moment.name, 'map')}.png`), await frame.getByTestId('robot-topview').screenshot());
        }
      }
      expect(errors).toEqual([]);
    });
  }
});

/** A mark's line or dot is never thinner than this many pixels on the map (TopView2D.tsx `MARK_MIN_PX`). */
const MARK_MIN_PX = 1.5;
/** The cube's top face is sampled 33 × 33 times, a millimetre apart, inside its outline (−1.65..1.65 cm in its own frame). */
const FACE_CELLS = 33;
const faceCell = (k: number) => -1.6 + k * 0.1;

/**
 * A mark's own picture at the face's cells (1 where its ink is), from its geometry (zone-pattern.ts, as the map strokes an object's mark:
 * its lines `max(widthCm, MARK_MIN_PX / scale)` wide, its dots that wide across) on a 4 cm cube, at the map's `scale` (px a cm).
 */
function markTemplate(mark: BodyMark, scale: number): Uint8Array {
  const spec = markPattern(mark, 'object');
  const outline = [[-2, -2], [2, -2], [2, 2], [-2, 2]] as const;
  const near = (u: number, v: number, [x0, y0, x1, y1]: readonly number[]) => {
    const [dx, dy] = [x1! - x0!, y1! - y0!];
    const t = Math.max(0, Math.min(1, ((u - x0!) * dx + (v - y0!) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(u - (x0! + t * dx), v - (y0! + t * dy));
  };
  const cells = new Uint8Array(FACE_CELLS * FACE_CELLS);
  if (spec.kind === 'hatch') {
    const half = Math.max(spec.widthCm, MARK_MIN_PX / scale) / 2;
    const lines = patternSegments(outline, spec, OBJECT_PATTERN_MARGIN_CM);
    for (let j = 0; j < FACE_CELLS; j++) for (let i = 0; i < FACE_CELLS; i++) cells[j * FACE_CELLS + i] = lines.some((line) => near(faceCell(i), -faceCell(j), line) <= half) ? 1 : 0;
  } else {
    const radius = Math.max(2 * spec.radiusCm, MARK_MIN_PX / scale) / 2;
    const dots = patternDots(outline, spec, OBJECT_PATTERN_MARGIN_CM);
    for (let j = 0; j < FACE_CELLS; j++) for (let i = 0; i < FACE_CELLS; i++) cells[j * FACE_CELLS + i] = dots.some(([x, y]) => Math.hypot(faceCell(i) - x, -faceCell(j) - y) <= radius) ? 1 : 0;
  }
  return cells;
}

test.describe('lesson 10’s cubes for a learner who cannot tell red from green (N19 E8)', () => {
  test.use({ deviceScaleFactor: 3 });

  test('the green, the red and the blue cube on the map show three marks a deuteranope and a protanope still tell apart; their fills do not', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const frame = await openMap(page, baseURL, 'rb-grip-sort');
    // The start (the green cube on the floor), and the red and the blue carried (rounds 2 and 3).
    const wanted = [
      { run: gripperLessonRuns.find((run) => run.key === 'rb-grip-sort' && run.round === 1)!, moment: 'start' },
      { run: gripperLessonRuns.find((run) => run.key === 'rb-grip-sort' && run.round === 2)!, moment: 'carry' },
      { run: gripperLessonRuns.find((run) => run.key === 'rb-grip-sort' && run.round === 3)!, moment: 'carry' },
    ];
    const faces: { name: string; picture: Pixels; at: (i: number, j: number) => readonly [number, number] }[] = [];
    const drawn: (string | null)[] = [];
    let scale = 0;
    for (const { run, moment: name } of wanted) {
      await openRound(frame, run);
      const moment = run.moments.find((candidate) => candidate.name === name)!;
      await stepTo(frame, moment.steps);
      const world = await snapshot(frame);
      expectMoment(world, moment);
      const cube = world?.objects.find((object) => object.id === 'cube')?.pose ?? { xCm: 49, yCm: 75, yawDeg: 0 };
      const { gripper, view } = await map2d(frame);
      drawn.push(gripper.objects.find((object) => object.id === 'cube')?.mark ?? null);
      scale = view.scale;
      // The map's fit (TopView2D's margins: 14 a side, 40 under) and the page's 3 device pixels a CSS pixel.
      const [widthCm, depthCm] = [170, 150];
      const originX = 14 + (view.stage.width - 28 - widthCm * view.scale) / 2;
      const originY = 14 + (view.stage.height - 54 - depthCm * view.scale) / 2 + depthCm * view.scale;
      const yaw = (cube.yawDeg * Math.PI) / 180;
      // The cube's top face in its own frame (u along its x, v along its y; row j down the face, v from +1.6 to −1.6).
      const at = (i: number, j: number): readonly [number, number] => {
        const [u, v] = [faceCell(i), -faceCell(j)];
        const [x, y] = [cube.xCm + u * Math.cos(yaw) - v * Math.sin(yaw), cube.yCm + u * Math.sin(yaw) + v * Math.cos(yaw)];
        return [(originX + x * view.scale) * 3, (originY - y * view.scale) * 3];
      };
      faces.push({ name: run.colour!, picture: await bodiesOf(frame, world), at });
    }
    const templates = (['stripes', 'grid', 'dots'] as const).map((mark) => ({ mark, cells: markTemplate(mark, scale) }));
    const seen: Record<string, Record<string, Record<string, number>>> = {};
    for (const vision of ['normal', 'deuteranopia', 'protanopia'] as const) {
      seen[vision] = {};
      const read = faces.map((face) => {
        const mask: MarkMask = markMask(vision === 'normal' ? face.picture : simulateImage(face.picture, vision as ColorVision), FACE_CELLS, face.at);
        // A mark is there: two classes of light apart.
        expect(mask.contrast, `${vision} ${face.name}`).toBeGreaterThan(1.4);
        const scores = templates.map(({ mark, cells }) => ({ mark, agreement: maskAgreement(mask, cells) })).sort((p, q) => q.agreement - p.agreement);
        seen[vision]![face.name] = Object.fromEntries(scores.map(({ mark, agreement }) => [mark, Math.round(agreement * 1000) / 1000]));
        return scores;
      });
      mkdirSync(shots, { recursive: true });
      writeFileSync(join(shots, 'sort-cvd-marks.json'), `${JSON.stringify(seen, null, 1)}\n`);
      for (const [i, scores] of read.entries()) {
        // Each face is plainly one of the three marks: it matches that one's picture (measured 0.79-0.87, where an unrelated mask matches
        // about a half), and the next one clearly less (measured 0.26-0.28 less).
        expect(scores[0]!.agreement, `${vision} ${faces[i]!.name}: ${JSON.stringify(scores)}`).toBeGreaterThan(0.75);
        expect(scores[0]!.agreement - scores[1]!.agreement, `${vision} ${faces[i]!.name}: ${JSON.stringify(scores)}`).toBeGreaterThan(0.15);
      }
      // The three cubes read as three different marks (as their masks differ): the mark, not the hue, tells them apart.
      expect(new Set(read.map((scores) => scores[0]!.mark)).size, `${vision}: ${JSON.stringify(seen[vision])}`).toBe(3);
    }
    // Hue alone is not enough: a deuteranope sees the red and the green cube's fills all but alike (Machado's matrix on the palette's own).
    const fill = (hex: string, vision: ColorVision) => simulateColor([1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number], vision);
    const luminance = ([r, g, b]: readonly number[]) => [r!, g!, b!].map((c) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
    const [red, green] = [fill('#d32f2f', 'deuteranopia'), fill('#388e3c', 'deuteranopia')];
    expect((Math.max(luminance(red), luminance(green)) + 0.05) / (Math.min(luminance(red), luminance(green)) + 0.05)).toBeLessThan(1.05);
    // And the map says which mark it drew (after the pictures: a mark made like another's fails on the pictures first).
    expect(drawn).toEqual(['grid', 'stripes', 'dots']);
    expect(errors).toEqual([]);
  });
});
