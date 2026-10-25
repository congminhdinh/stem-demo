import { chromium, expect, test as base, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument, type RobotTemplateKey } from '../src/samples/robot-templates';

// N18 R4.6 (Review Focus 5): a school PC that cannot draw WebGL, or a browser that takes the WebGL context away, still has the robot lab:
// the 2D top view (TopView2D) stands in for the 3D scene, reads the very snapshot the 3D scene would, and the run, the HUD and the
// controls work as before. The first describe launches Chromium with WebGL off; the second one has WebGL (SwiftShader, as the scene
// spec) and plays what a browser does to a context: takes it away (WEBGL_lose_context) and gives it back. Screenshots go to
// R46_SHOTS_DIR (the report's), or under test-results.

const lessonOrigin = 'http://lesson.localhost:5190';

/**
 * The tests of a computer without WebGL get their own Chromium, launched with WebGL and the 3D APIs off: `use({ launchOptions })` is for
 * a whole file, and the rest of this file needs WebGL (SwiftShader, as the scene spec: the context is lost and restored on it).
 */
const test = base.extend<{ noWebglPage: Page }>({
  noWebglPage: async ({ baseURL }, use) => {
    const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    const context = await browser.newContext({ baseURL: baseURL ?? '', viewport: { width: 1280, height: 720 } });
    await use(await context.newPage());
    await browser.close();
  },
});
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

const shots = process.env.R46_SHOTS_DIR ?? join('test-results', 'robot-webgl-fallback');

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };
type Point = { xCm: number; yCm: number };
type TopView = {
  reason: string | null;
  stage: { width: number; height: number };
  scale: number;
  draws: number;
  robot: (Point & { yawDeg: number }) | null;
  lineDots: (Point & { role: string; dark: boolean })[];
  rays: { role: string; visible: boolean; lengthCm: number | null; echo: boolean; from: Point; to: Point; hit: boolean }[];
  scaleBar: { cm: number; lengthPx: number } | null;
};
type World = {
  t: number;
  robot: Point & { yawDeg: number };
  sensors: ({ kind: 'ultrasonic'; role: string; cm: number } | { kind: 'line-sensor'; role: string; dark: boolean })[];
};

const labUrl = (baseURL: string | undefined, template: RobotTemplateKey) =>
  new URL(`/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

/**
 * Loads the module that reads what the 2D map drew (src/ui/robot3d/top-view-state.ts) from the dev server, which serves the instance the
 * lab runs on, and keeps its reader on the page: `topView` then reads in one turn of the page (`both`: with the world, no frame between).
 */
async function installTopViewReader(target: Page | Frame) {
  await target.evaluate(async () => {
    const path = '/src/ui/robot3d/top-view-state.ts';
    const module = (await import(/* @vite-ignore */ path)) as { readTopViewState(): unknown };
    (window as unknown as { __readTopView(): unknown }).__readTopView = module.readTopViewState;
  });
}

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.getByTestId('robot-lab').waitFor();
  await installTopViewReader(frame);
  return frame;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

const messageTypes = (page: Page) => page.evaluate(() => (window as unknown as { __labMessages: Recorded[] }).__labMessages.map((message) => message.data.type));
const world = (frame: Frame) => frame.evaluate(() => window.__stem?.robot.getSnapshot() as World | null);
const topView = (frame: Frame) => frame.evaluate(() => (window as unknown as { __readTopView(): TopView | null }).__readTopView());
/** The world and the map in one turn of the page, so that no frame comes between them. */
const both = (frame: Frame) =>
  frame.evaluate(() => ({ world: window.__stem?.robot.getSnapshot() as World | null, top: (window as unknown as { __readTopView(): TopView | null }).__readTopView() }));
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/** A scenario's project with its reference solution as the program. */
const solved = (template: Exclude<RobotTemplateKey, 'rb-sandbox'>) => ({ ...robotStarterDocument(template), program: { blocks: robotSolutions[template].reference } });

const noWebglNote = 'Máy này không hiển thị được 3D, đang dùng bản đồ 2D.';

test.describe('the robot lab on a computer without WebGL (N18 R4.6)', () => {
  test('shows the 2D top view with the reason, and Chạy moves the map’s robot as it moves the snapshot’s', async ({ noWebglPage: page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    // The launch flags took: this browser really has no WebGL.
    expect(await frame.evaluate(() => document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl'))).toBeNull();

    await expect(frame.getByTestId('robot-topview').locator('canvas').first()).toBeVisible();
    await expect(frame.getByTestId('robot-canvas')).toHaveCount(0);
    await expect(frame.getByTestId('robot-fallback-note')).toContainText(noWebglNote);
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Thử lại 3D');
    await expect(frame.getByTestId('robot-camera')).toHaveCount(0);
    await expect(frame.getByTestId('robot-status')).toHaveText('Chưa chạy');
    // The map is the size of its place, the arena fits in it, and a 10 cm scale bar is drawn at the arena's scale.
    const idle = (await topView(frame))!;
    expect(idle.reason).toBe('no-webgl');
    expect(idle.robot).toEqual({ xCm: 25, yCm: 40, yawDeg: 0 });
    expect(idle.scaleBar?.cm).toBe(10);
    expect(idle.scaleBar?.lengthPx).toBeCloseTo(10 * idle.scale, 6);
    expect(idle.scale * 160).toBeLessThanOrEqual(idle.stage.width);
    expect(idle.scale * 80).toBeLessThanOrEqual(idle.stage.height);
    await screenshot(page, '01-no-webgl-idle-1100x640.png');

    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-drive-to-zone'));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    // The robot leaves its start (x = 25 cm) along +x, and the map's robot with it: the same place as the snapshot's.
    await expect.poll(async () => (await topView(frame))?.robot?.xCm ?? 0, { timeout: 10_000 }).toBeGreaterThan(32);
    await screenshot(page, '02-no-webgl-running-1100x640.png');
    const mid = await both(frame);
    expect(mid.top?.robot?.xCm).toBeCloseTo(mid.world!.robot.xCm, 1);
    expect(mid.top?.robot?.yCm).toBeCloseTo(mid.world!.robot.yCm, 1);
    expect(mid.top?.robot?.yawDeg).toBeCloseTo(mid.world!.robot.yawDeg, 1);

    // The run to its end at 4×: the goals are scored from the very world the map draws.
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc', { timeout: 20_000 });
    await expect(frame.getByTestId('robot-score')).toHaveText('Điểm 100/100');
    const end = await both(frame);
    expect(end.top?.robot?.xCm).toBeCloseTo(end.world!.robot.xCm, 1);
    expect(end.top!.robot!.xCm).toBeGreaterThan(76);
    await screenshot(page, '03-no-webgl-scored-1100x640.png');
    expect(errors).toEqual([]);
  });

  test('draws the ultrasonic ray to the wall it hears, and nothing once the robot rests', async ({ noWebglPage: page, baseURL }) => {
    test.setTimeout(60_000);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-stop-at-wall'));
    await frame.evaluate(() => window.__stem?.robot.setSpeed(2));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await topView(frame))?.rays[0]?.visible ?? false, { timeout: 10_000 }).toBe(true);
    // Once the ray hears the wall it is drawn to the point where it hits, from the sensor 7.5 cm ahead of the robot's middle.
    await expect.poll(async () => (await topView(frame))?.rays[0]?.echo ?? false, { timeout: 15_000 }).toBe(true);
    const { world: heard, top } = await both(frame);
    const ray = top!.rays[0]!;
    const reading = heard!.sensors.find((sensor) => sensor.kind === 'ultrasonic') as { cm: number };
    expect(ray.hit).toBe(true);
    expect(ray.lengthCm).toBeCloseTo(reading.cm, 1);
    // Along the robot's heading, which is the arena's +x within a degree or two while it drives to the wall.
    const yaw = (heard!.robot.yawDeg * Math.PI) / 180;
    expect(ray.from.xCm).toBeCloseTo(heard!.robot.xCm + 7.5 * Math.cos(yaw), 1);
    expect(ray.to.xCm).toBeCloseTo(heard!.robot.xCm + (7.5 + reading.cm) * Math.cos(yaw), 1);
    expect(ray.to.yCm).toBeCloseTo(heard!.robot.yCm + (7.5 + reading.cm) * Math.sin(yaw), 1);
    await screenshot(page, '04-ultrasonic-ray-1100x640.png');

    // The robot stops at the wall and the run goes on to its time limit; the map draws no more for a robot that does not move.
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc', { timeout: 40_000 });
    await page.waitForTimeout(500);
    const rested = (await topView(frame))!.draws;
    await page.waitForTimeout(1200);
    expect((await topView(frame))!.draws).toBe(rested);
  });

  test('lights the line sensors’ dots with what the snapshot says they see', async ({ noWebglPage: page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-line-follow'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-line-follow'));
    await frame.evaluate(() => window.__stem?.robot.setSpeed(2));
    await frame.getByTestId('robot-run').click();
    // Over some seconds of the follower's run, in a single turn of the page at each sample: the map's three dots are the world's three.
    const seen = new Set<string>();
    for (let sample = 0; sample < 24; sample++) {
      const { world: now, top } = await both(frame);
      if (now && top) {
        const dark = now.sensors.filter((sensor) => sensor.kind === 'line-sensor').map((sensor) => (sensor as { dark: boolean }).dark);
        expect(top.lineDots.map((dot) => dot.dark)).toEqual(dark);
        seen.add(dark.join());
      }
      await page.waitForTimeout(250);
    }
    // The follower crossed the line at least once, so it was not all the same reading.
    expect(seen.size).toBeGreaterThan(1);
    // The dots sit in front of the robot, at its line sensors' mounts: 7 cm ahead, 1.5 cm apart.
    const { world: last, top } = await both(frame);
    const yaw = (last!.robot.yawDeg * Math.PI) / 180;
    const centre = top!.lineDots.find((dot) => dot.role === 'lineCenter')!;
    expect(centre.xCm).toBeCloseTo(last!.robot.xCm + 7 * Math.cos(yaw), 1);
    expect(centre.yCm).toBeCloseTo(last!.robot.yCm + 7 * Math.sin(yaw), 1);
    await screenshot(page, '05-line-dots-1100x640.png');
  });

  /** Whether the point at the middle of `testId`'s box shows that element (or what is in it), not something drawn over it. */
  const shownAtItsMiddle = (frame: Frame, testId: string) =>
    frame.evaluate((id) => {
      const element = document.querySelector(`[data-testid=${id}]`);
      if (element === null) return false;
      const { x, y, width, height } = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(x + width / 2, y + height / 2));
    }, testId);

  const checkResultsOf = (page: Page) => page.evaluate(() => (window as unknown as { __labMessages: Recorded[] }).__labMessages.filter((message) => message.data.type === 'check-result'));

  test('Kiểm tra at 4× shows the check’s run on the map, then its check-result is sent and its results card stands over the map', async ({ noWebglPage: page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-drive-to-zone'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    // The check holds the lab and its run is the map's: the robot of the map drives, the round says so.
    await expect(frame.getByTestId('robot-round')).toHaveText('Lượt 1/1');
    await expect(frame.getByTestId('robot-run')).toBeDisabled();
    await expect.poll(async () => (await topView(frame))?.robot?.xCm ?? 0, { timeout: 20_000 }).toBeGreaterThan(30);
    await screenshot(page, '06-no-webgl-checking-1100x640.png');
    await expect.poll(async () => (await checkResultsOf(page)).length, { timeout: 60_000 }).toBe(1);
    expect((await checkResultsOf(page))[0]?.data).toMatchObject({ lab: 'robot', passed: true, score: 100, maxScore: 100 });
    expect(await messageTypes(page)).toEqual(['ready', 'project-changed', 'run-started', 'run-stopped', 'check-result']);

    // The card: over the map, inside the view, clear of the view button, its own verdict and score.
    await expect(frame.getByTestId('robot-check-verdict')).toHaveText('Đạt');
    await expect(frame.getByTestId('robot-check-score')).toHaveText('100/100 điểm');
    expect(await shownAtItsMiddle(frame, 'robot-check-results')).toBe(true);
    const [card, stage, button] = await Promise.all([
      frame.getByTestId('robot-check-results').boundingBox(),
      frame.locator('.robot-stage').boundingBox(),
      frame.getByTestId('robot-viewmode').boundingBox(),
    ]);
    expect(card!.x).toBeGreaterThanOrEqual(stage!.x);
    expect(card!.x + card!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
    expect(card!.y + card!.height).toBeLessThanOrEqual(button!.y);
    expect((await topView(frame))?.reason).toBe('no-webgl');
    await screenshot(page, '07-no-webgl-checked-1100x640.png');
    expect(errors).toEqual([]);
  });

  test('a fast Kiểm tra shows its progress over the map and ends in the same card and check-result, with the map back as the check left it', async ({ noWebglPage: page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-stop-at-wall'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-fast')).toBeVisible();
    await expect.poll(async () => (await checkResultsOf(page)).length, { timeout: 60_000 }).toBe(1);
    await expect(frame.getByTestId('robot-check-results')).toBeVisible();
    await expect(frame.getByTestId('robot-check-fast')).toHaveCount(0);
    expect((await checkResultsOf(page))[0]?.data).toMatchObject({ lab: 'robot', passed: true });
    expect(await shownAtItsMiddle(frame, 'robot-check-results')).toBe(true);
    // The map shows where the check's last round left the robot: past its start, and the same place as the snapshot's.
    const { world: left, top } = await both(frame);
    expect(top?.reason).toBe('no-webgl');
    expect(top?.robot?.xCm).toBeCloseTo(left!.robot.xCm, 1);
    expect(top!.robot!.xCm).toBeGreaterThan(50);
    await screenshot(page, '08-no-webgl-fast-checked-1100x640.png');
  });
});

test.describe('the robot lab’s 3D view and its 2D map (N18 R4.6)', () => {
  async function openWith3d(page: Page, baseURL: string | undefined, template: RobotTemplateKey = 'rb-drive-to-zone'): Promise<Frame> {
    const frame = await openInLesson(page, labUrl(baseURL, template));
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 15_000 });
    await expect(frame.getByTestId('robot-3d-loading')).toHaveCount(0);
    // WEBGL_lose_context is asked for now: a context that is lost answers `getExtension` with null, so it could not be asked for later
    // to restore it (the scene spec's restore did nothing for that reason, and the lost message went away when the view gave up instead).
    await frame.evaluate(() => {
      const canvas = document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement;
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGL2RenderingContext;
      const hooks = window as unknown as { __loseContext: WEBGL_lose_context | null; __draws: number; __isContextLost(): boolean };
      hooks.__loseContext = gl.getExtension('WEBGL_lose_context');
      hooks.__isContextLost = () => gl.isContextLost();
      // The scene's draws to the screen: three clears WebGL's default framebuffer once per render (as the scene spec counts them).
      hooks.__draws = 0;
      const clear = gl.clear.bind(gl);
      gl.clear = (mask: number) => {
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) hooks.__draws += 1;
        clear(mask);
      };
    });
    return frame;
  }

  const draws = (frame: Frame) => frame.evaluate(() => (window as unknown as { __draws: number }).__draws);
  const contextLost = (frame: Frame) => frame.evaluate(() => (window as unknown as { __isContextLost(): boolean }).__isContextLost());

  const lose = (frame: Frame, action: 'loseContext' | 'restoreContext') =>
    frame.evaluate((which) => {
      const extension = (window as unknown as { __loseContext: WEBGL_lose_context | null }).__loseContext;
      if (extension === null) {
        throw new Error('This browser has no WEBGL_lose_context');
      }
      extension[which]();
    }, action);

  test('a lost WebGL context that does not come back within 2 s falls back to the map, the run goes on, and 3D returns when the context does', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openWith3d(page, baseURL);
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-drive-to-zone'));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Xem 2D');
    expect(await topView(frame)).toBeNull();

    const lostAt = Date.now();
    await lose(frame, 'loseContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveText('Khung nhìn 3D bị mất đồ hoạ. Đang khôi phục…');
    // For the first 2 s the scene waits for its context: no map yet.
    await page.waitForTimeout(1200);
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await expect(frame.getByTestId('robot-topview')).toBeVisible({ timeout: 4000 });
    const fellAfterMs = Date.now() - lostAt;
    expect(fellAfterMs).toBeGreaterThanOrEqual(1900);
    expect(fellAfterMs).toBeLessThan(5000);
    await expect(frame.getByTestId('robot-fallback-note')).toContainText('Khung nhìn 3D bị mất đồ hoạ, đang dùng bản đồ 2D.');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveCount(0);
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Thử lại 3D');
    expect((await topView(frame))?.reason).toBe('context-lost');
    await screenshot(page, '09-context-lost-map-1100x640.png');

    // The run did not notice: the simulation goes on, and the map follows it.
    const at = (await world(frame))!;
    await expect.poll(async () => (await world(frame))?.t ?? 0, { timeout: 10_000 }).toBeGreaterThan(at.t + 0.3);
    await expect.poll(async () => (await topView(frame))?.robot?.xCm ?? 0, { timeout: 10_000 }).toBeGreaterThan(at.robot.xCm);
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');

    // While the context is lost the scene draws nothing (it stays mounted, and the run keeps asking it for frames).
    expect(await contextLost(frame)).toBe(true);
    const drawnWhileLost = await draws(frame);
    await page.waitForTimeout(400);
    expect(await draws(frame)).toBe(drawnWhileLost);

    await lose(frame, 'restoreContext');
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    // And once it is restored the 3D scene draws again: new frames come to the screen, the run still moving the robot in them.
    expect(await contextLost(frame)).toBe(false);
    await expect.poll(() => draws(frame), { timeout: 5000 }).toBeGreaterThan(drawnWhileLost);
    await expect(frame.getByTestId('robot-fallback-note')).toHaveCount(0);
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Xem 2D');
    await expect(frame.getByTestId('robot-camera')).toBeVisible();
    await expect(frame.getByTestId('robot-canvas').locator('canvas')).toBeVisible();
    // The very run, never restarted: the host heard one run start and no run stop, and the clock did not go back.
    expect((await world(frame))!.t).toBeGreaterThan(at.t);
    const types = await messageTypes(page);
    expect(types.filter((type) => type === 'run-started')).toHaveLength(1);
    expect(types).not.toContain('run-stopped');
    expect(errors).toEqual([]);
  });

  test('a context that comes back within 2 s keeps the 3D scene', async ({ page, baseURL }) => {
    const frame = await openWith3d(page, baseURL);
    await lose(frame, 'loseContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toBeVisible();
    await page.waitForTimeout(500);
    await lose(frame, 'restoreContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveCount(0);
    await page.waitForTimeout(2500);
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await expect(frame.getByTestId('robot-scene')).toBeVisible();
  });

  test('"Xem 2D" and "Xem 3D" change the view in the middle of a run without resetting it', async ({ page, baseURL }) => {
    const frame = await openWith3d(page, baseURL);
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved('rb-drive-to-zone'));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    await expect.poll(async () => (await world(frame))?.robot.xCm ?? 0).toBeGreaterThan(30);
    const before = (await world(frame))!;

    await frame.getByTestId('robot-viewmode').click();
    await expect(frame.getByTestId('robot-topview')).toBeVisible();
    await expect(frame.getByTestId('robot-scene')).toHaveCount(0);
    // The map is the learner's own choice: no note, and the way back is "Xem 3D".
    await expect(frame.getByTestId('robot-fallback-note')).toHaveCount(0);
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Xem 3D');
    expect((await topView(frame))?.reason).toBe('chosen');
    await expect.poll(async () => (await topView(frame))?.robot?.xCm ?? 0).toBeGreaterThan(before.robot.xCm);
    await screenshot(page, '10-chosen-map-1100x640.png');

    await frame.getByTestId('robot-viewmode').click();
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 15_000 });
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Xem 2D');
    const after = (await world(frame))!;
    expect(after.t).toBeGreaterThan(before.t);
    expect(after.robot.xCm).toBeGreaterThanOrEqual(before.robot.xCm);
    const types = await messageTypes(page);
    expect(types.filter((type) => type === 'run-started')).toHaveLength(1);
    expect(types).not.toContain('run-stopped');
  });
});
