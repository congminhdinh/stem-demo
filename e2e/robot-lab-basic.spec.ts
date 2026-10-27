import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument, type RobotTemplateKey } from '../src/samples/robot-templates';
import { fullSkip } from '../tests/basic-skip';
import { pinLowTierChainOff } from './robot-chain';

// demo-basic (src/ui/edition.ts): the Basic demo's robot lab, in the 1100 × 640 frame of a lesson page, drawn by SwiftShader (project
// chromium-robot). It shows its badge, has one camera, no quality button and none of the view's tools, draws the simple shapes and never
// fetches a model file; the reference of rb-stop-at-wall runs and is checked to the score master gives it; a scenario it does not open is an
// error screen that says so. Screenshots go to BASIC_SHOTS_DIR, or under test-results.

fullSkip(test.skip, 'robot lab');

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.BASIC_SHOTS_DIR ?? join('test-results', 'robot-lab-basic');

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };

const labUrl = (baseURL: string | undefined, template: string) => new URL(`/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('The lab iframe has no frame');
  await frame.getByTestId('robot-lab').waitFor();
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await expect(frame.getByTestId('robot-3d-loading')).toHaveCount(0);
  await pinLowTierChainOff(frame);
  return frame;
}

/** Every request of the page and its frames whose URL names a glTF file. */
function modelRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (/\.(glb|gltf)(\?|$)/i.test(new URL(request.url()).pathname + new URL(request.url()).search)) urls.push(request.url());
  });
  return urls;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

const messages = (page: Page) => page.evaluate(() => (window as unknown as { __labMessages: Recorded[] }).__labMessages.map((message) => message.data));
const checkResults = async (page: Page) => (await messages(page)).filter((message) => message.type === 'check-result');
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(400);
  await page.locator('iframe').screenshot({ path: join(shots, name) });
};
const reference = (template: Exclude<RobotTemplateKey, 'rb-sandbox'>) => ({ ...robotStarterDocument(template), program: { blocks: robotSolutions[template].reference } });
/** Where the camera is (dev builds): its distance, its turn about the vertical and its angle from it. */
const cameraOf = (frame: Frame) => frame.locator('[data-testid=robot-canvas] canvas').getAttribute('data-camera');

test.describe.configure({ timeout: 120_000 });

test.describe('the Basic demo’s robot lab', () => {
  test('shows its badge, one camera, no quality button and none of the view’s tools, draws the simple shapes and fetches no model file', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const models = modelRequests(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    await expect(frame.getByTestId('robot-edition-badge')).toHaveText('Bản demo cơ bản');
    await expect(frame.getByTestId('robot-edition-badge')).toBeVisible();
    expect(await frame.evaluate(() => document.title)).toBe('STEM Studio · Bản demo cơ bản');
    // The low tier, on the procedural shapes; the quality button is there, hidden, saying it.
    const canvas = frame.locator('[data-testid=robot-canvas] canvas');
    await expect(frame.getByTestId('robot-canvas')).toHaveAttribute('data-tier', 'low');
    await expect(canvas).toHaveAttribute('data-models', 'simple');
    await expect(frame.getByTestId('robot-quality')).toBeHidden();
    await expect(frame.getByTestId('robot-quality')).toHaveAttribute('data-tier', 'low');
    // One camera: the reset and no mode button; the keys 1 2 3 change nothing, 0 puts it back at once.
    await expect(frame.getByTestId('robot-camera').locator('[data-mode]')).toHaveCount(0);
    await expect(frame.getByTestId('robot-camera-reset')).toBeVisible();
    await page.waitForTimeout(500);
    await screenshot(page, '01-drive-to-zone-idle-1100x640.png');
    const start = await cameraOf(frame);
    await frame.getByTestId('robot-scene').focus();
    for (const key of ['2', '3']) await page.keyboard.press(key);
    await page.waitForTimeout(300);
    expect(await cameraOf(frame)).toBe(start);
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => cameraOf(frame)).not.toBe(start);
    await page.keyboard.press('0');
    await expect.poll(() => cameraOf(frame)).toBe(start);
    // A drag keeps the full lab's damping: the view goes on turning for a moment after the pointer lets go. Then 0 puts it back at once,
    // with no glide (a glide takes 0.45 s).
    const canvasBox = (await canvas.boundingBox())!;
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(canvasBox.x + canvasBox.width / 2 + i * 15, canvasBox.y + canvasBox.height / 2);
    await page.mouse.up();
    const released = await cameraOf(frame);
    await expect.poll(() => cameraOf(frame), { timeout: 5_000 }).not.toBe(released);
    await frame.getByTestId('robot-scene').focus();
    await page.keyboard.press('0');
    await page.waitForTimeout(150);
    expect(await cameraOf(frame)).toBe(start);
    // No view tool, no sensor switch; the program has the blocks' tab only.
    await expect(frame.getByTestId('robot-tools')).toHaveCount(0);
    await expect(frame.getByTestId('robot-sensors')).toHaveCount(0);
    await expect(frame.locator('.robot-program-tabs [role=tab]')).toHaveText(['Khối lệnh']);
    await expect(frame.getByTestId('robot-view-hint')).toHaveText('Phím: 0 hoặc Home đặt lại góc nhìn; + và − phóng to, thu nhỏ; Shift cùng các phím mũi tên để xoay.');
    // A run draws the same simple shapes: still no model file.
    await frame.evaluate((document) => window.__stem?.loadProject(document), reference('rb-drive-to-zone'));
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc', { timeout: 60_000 });
    await expect(frame.getByTestId('robot-score')).toHaveText('Điểm 100/100');
    await screenshot(page, '02-drive-to-zone-scored-1100x640.png');
    expect(models).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('runs and checks the reference of rb-stop-at-wall to the score master gives it', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const models = modelRequests(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    // The project comes from the host, as the LMS sends it (stem-lab/v1 load-project), after the lab said ready.
    await expect.poll(async () => (await messages(page)).filter((message) => message.type === 'ready')).toHaveLength(1);
    const project = { ...reference('rb-stop-at-wall'), id: 'saved-by-the-host' };
    await page.evaluate(([document, origin]) => (window as unknown as { __sendToLab(message: unknown, origin: string): void }).__sendToLab({ protocol: 'stem-lab/v1', type: 'load-project', document }, origin), [project, new URL(frame.url()).origin] as const);
    await expect.poll(() => frame.evaluate(() => (window.__stem?.getProject() as { id?: string } | undefined)?.id)).toBe('saved-by-the-host');
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc', { timeout: 60_000 });
    await expect(frame.getByTestId('robot-status')).toHaveAttribute('data-tone', 'success');
    await expect(frame.getByTestId('robot-score')).toHaveText('Điểm 100/100');
    await expect(frame.locator('[data-goal=stop-near-wall]')).toHaveAttribute('data-passed', 'true');
    await expect(frame.locator('[data-goal=no-crash]')).toHaveAttribute('data-passed', 'true');
    await screenshot(page, '03-stop-at-wall-run-1100x640.png');
    // The 2D map has no sensor overlay either: no overlay layer, no ray to the wall the robot faces; the robot is on it where the run left it.
    await frame.getByTestId('robot-viewmode').click();
    await expect(frame.getByTestId('robot-topview')).toBeVisible();
    const map = await frame.evaluate(async () => {
      const paths = ['/src/ui/robot3d/top-view-sensors-state.ts', '/src/ui/robot3d/top-view-state.ts'];
      const [sensors, view] = await Promise.all(paths.map((path) => import(/* @vite-ignore */ path)));
      const state = (view as { readTopViewState(): { robot: unknown; rays: { visible: boolean }[] } | null }).readTopViewState();
      return { overlay: (sensors as { readTopViewSensors(): unknown }).readTopViewSensors(), rays: state?.rays.map((ray) => ray.visible), robot: state?.robot !== null };
    });
    expect(map).toEqual({ overlay: null, rays: [false], robot: true });
    await screenshot(page, '08-stop-at-wall-2d-1100x640.png');
    await frame.getByTestId('robot-viewmode').click();
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect.poll(async () => (await checkResults(page)).length, { timeout: 60_000 }).toBe(1);
    const [result] = await checkResults(page);
    // What master's check gives this reference (node spikes/n19-d4/make-attempts.mjs on master d37464a: its attempt 3), field by field.
    expect(result).toMatchObject({
      protocol: 'stem-lab/v1',
      type: 'check-result',
      lab: 'robot',
      passed: true,
      goals: [
        { id: 'stop-near-wall', label: 'Xe dừng hẳn trong vùng trước tường', passed: true },
        { id: 'no-crash', label: 'Xe không chạm tường', passed: true },
      ],
      score: 100,
      maxScore: 100,
      simTimeMs: 20000,
      variants: [
        { seed: 3004, passed: true, score: 100, simTimeMs: 20000 },
        { seed: 3005, passed: true, score: 100, simTimeMs: 20000 },
        { seed: 3006, passed: true, score: 100, simTimeMs: 20000 },
      ],
      engine: 'robot-engine@1',
      scenarioVersion: 1,
    });
    expect(result!.programHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(frame.getByTestId('robot-check-verdict')).toHaveText('Đạt');
    await expect(frame.getByTestId('robot-check-score')).toHaveText('100/100 điểm');
    await screenshot(page, '04-stop-at-wall-checked-1100x640.png');
    expect(models).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('follows the line on the simple shapes, and the sandbox opens', async ({ page, baseURL }) => {
    const models = modelRequests(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-line-follow'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), reference('rb-line-follow'));
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { t: number } | null)?.t ?? 0, { timeout: 60_000 }).toBeGreaterThan(6);
    await frame.getByTestId('robot-pause').click();
    await screenshot(page, '05-line-follow-running-1100x640.png');
    const sandbox = await openInLesson(page, labUrl(baseURL, 'rb-sandbox'));
    await expect(sandbox.getByTestId('robot-edition-badge')).toBeVisible();
    await expect(sandbox.getByTestId('robot-check-start')).toHaveCount(0);
    await screenshot(page, '06-sandbox-1100x640.png');
    expect(models).toEqual([]);
  });

  test('keeps its header on one row in the lesson’s frame with the badge, Kiểm tra beside the run’s controls, in each of its scenarios; nothing scrolls sideways', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1100, height: 640 });
    for (const template of ['rb-drive-to-zone', 'rb-stop-at-wall', 'rb-line-follow', 'rb-sandbox']) {
      await page.goto(new URL(`/?embed=1&lab=robot&template=${template}`, baseURL).href);
      await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
      const [header, badge, run, viewport, program] = await Promise.all(['.robot-header', '[data-testid=robot-edition-badge]', '[data-testid=robot-run]', '[data-testid=robot-viewport]', '[data-testid=program-region]'].map((selector) => page.locator(selector).boundingBox()));
      // One row, as the full lab's rover header (51 px, spikes/n19-ff/header-shots.mjs); the badge inside it, on the line of the lab's name.
      expect(header!.height, template).toBeLessThan(64);
      expect(badge!.y).toBeGreaterThanOrEqual(header!.y);
      expect(badge!.y + badge!.height).toBeLessThanOrEqual(header!.y + header!.height);
      if (template !== 'rb-sandbox') {
        const check = await page.getByTestId('robot-check-start').boundingBox();
        expect(Math.abs(check!.y + check!.height / 2 - (run!.y + run!.height / 2)), template).toBeLessThan(4);
      }
      // The view about 60 % on the left, the program beside it.
      expect(viewport!.width / 1100).toBeGreaterThan(0.55);
      expect(viewport!.width / 1100).toBeLessThan(0.65);
      expect(program!.x).toBeGreaterThanOrEqual(viewport!.x + viewport!.width - 1);
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
    }
  });

  test('lists its four scenarios on the error screen of an unknown robot key', async ({ page }) => {
    await page.goto('/?embed=1&lab=robot&template=rb-unknown');
    await expect(page.getByTestId('launch-error')).toContainText('Không có mẫu bài "rb-unknown".');
    await expect(page.getByTestId('launch-error')).toContainText('Các mẫu được hỗ trợ: rb-drive-to-zone, rb-stop-at-wall, rb-line-follow, rb-sandbox.');
  });

  for (const template of ['rb-grip-pick', 'rb-mini-mission']) {
    test(`says ${template} is not in the Basic demo, framed or on its own, and opens no lab`, async ({ page, baseURL }) => {
      const lesson = new URL('/lesson', lessonOrigin);
      lesson.searchParams.set('lab', labUrl(baseURL, template));
      await page.goto(lesson.href);
      const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
      await expect(frame!.getByTestId('launch-error')).toContainText('Kịch bản này không có trong bản demo cơ bản.');
      await expect(frame!.getByTestId('launch-error')).toContainText('Các mẫu được hỗ trợ: rb-drive-to-zone, rb-stop-at-wall, rb-line-follow, rb-sandbox.');
      await expect(frame!.getByTestId('robot-lab')).toHaveCount(0);
      if (template === 'rb-grip-pick') await screenshot(page, '07-not-in-basic-1100x640.png');
      await page.goto(new URL(`/?embed=1&lab=robot&template=${template}`, baseURL).href);
      await expect(page.getByTestId('launch-error')).toContainText('Kịch bản này không có trong bản demo cơ bản.');
      await expect(page.getByTestId('robot-lab')).toHaveCount(0);
    });
  }
});
