import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';

// N18 R4.2/R4.4: the robot lab a learner uses, in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts,
// project chromium-robot): the blocks run the robot in the 3D arena, the running block lights up, the HUD follows the run, Dừng and Đặt lại
// do what they say, the page never scrolls sideways, and nothing is written to the console as an error. The screenshots go to
// R42_SHOTS_DIR (the report's), or under test-results.

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R42_SHOTS_DIR ?? join('test-results', 'robot-lab-scene');

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };
type RobotView = { t: number; robot: { xCm: number; yCm: number; yawDeg: number }; status: string };

const labUrl = (baseURL: string | undefined, query: string) => new URL(`/?embed=1&${query}`, baseURL).href;

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.getByTestId('robot-lab').waitFor();
  await frame.getByTestId('robot-canvas').locator('canvas').waitFor();
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
const view = (frame: Frame) => frame.evaluate(() => window.__stem?.robot.getSnapshot() as RobotView | null);
const status = (frame: Frame) => frame.getByTestId('robot-hud').getAttribute('data-status');
const litBlocks = (frame: Frame) => frame.locator('[data-testid=blockly-panel] g.blocklyHighlighted').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')));
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/** The robot project of rb-drive-to-zone with the scenario's reference solution as its program. */
const solved = () => ({ ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });

/** Whether the page scrolls sideways (it never may) or down (a lab never does). */
const scrolls = (target: Page | Frame) =>
  target.evaluate(() => {
    const page = document.scrollingElement;
    return page === null ? null : { sideways: page.scrollWidth > page.clientWidth, down: page.scrollHeight > page.clientHeight };
  });

test.describe('the robot lab in a lesson (N18 R4.2, R4.4)', () => {
  test('runs the reference solution: the robot drives, its running block lights up, Đặt lại starts the run again and Dừng ends it', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`));
    await expect(frame.getByTestId('robot-status')).toHaveText('Chưa chạy');
    expect(await view(frame)).toBeNull();
    // The scenario's starter is shown, and its blocks are only the toolbox's.
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'khi bắt đầu' })).toBeVisible();
    await screenshot(page, '01-idle-1100x640.png');

    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    // The robot leaves its start (x = 25 cm) along +x, and the wait it drives through is the block that lights up.
    await expect.poll(async () => (await view(frame))?.robot.xCm ?? 0, { timeout: 10_000 }).toBeGreaterThan(32);
    await expect.poll(() => litBlocks(frame)).toEqual(['drive-time']);
    expect((await view(frame))?.robot.yCm).toBeCloseTo(40, 0);
    await screenshot(page, '02-running-1100x640.png');

    // Đặt lại during a paused run: the run starts again from the start pose, at t = 0, and stays paused there.
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');
    await frame.getByTestId('robot-reset').click();
    await expect.poll(async () => (await view(frame))?.t ?? 99).toBe(0);
    const restarted = await view(frame);
    expect(restarted?.robot.xCm).toBeCloseTo(25, 1);
    expect(restarted?.robot.yCm).toBeCloseTo(40, 1);
    expect(restarted?.robot.yawDeg).toBeCloseTo(0, 1);
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');

    // Dừng: the run is over, and the robot stays where it stopped until Đặt lại puts back the start.
    await frame.getByTestId('robot-stop').click();
    expect(await status(frame)).toBe('stopped');
    await expect(frame.getByTestId('robot-status')).toHaveText('Đã dừng');
    expect(await view(frame)).not.toBeNull();
    await frame.getByTestId('robot-reset').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Chưa chạy');
    expect(await view(frame)).toBeNull();
    expect(await litBlocks(frame)).toEqual([]);

    // The host heard the run start and stop (Đặt lại during a run is the same run going on).
    await expect.poll(() => messageTypes(page)).toEqual(expect.arrayContaining(['ready', 'project-changed', 'run-started', 'run-stopped']));
    const types = await messageTypes(page);
    expect(types.filter((type) => type === 'run-started' || type === 'run-stopped')).toEqual(['run-started', 'run-stopped']);
    expect(errors).toEqual([]);
  });

  test('scores the reference solution 100 at 4×, the HUD showing both goals met and the run’s end', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await expect(frame.getByTestId('robot-speed').getByRole('radio', { name: '4×' })).toHaveAttribute('aria-checked', 'true');
    await frame.getByTestId('robot-run').click();
    // The scenario's time limit is 15 s: under 4 s at 4×, with a margin for a slow machine.
    await expect(frame.getByTestId('robot-status')).toHaveText('Đã hết thời gian', { timeout: 20_000 });
    await expect(frame.getByTestId('robot-score')).toHaveText('Điểm 100/100');
    await expect(frame.locator('[data-goal=reach-target]')).toHaveAttribute('data-passed', 'true');
    await expect(frame.locator('[data-goal=stop-in-target]')).toHaveAttribute('data-passed', 'true');
    const end = await view(frame);
    expect(end?.robot.xCm).toBeGreaterThan(76);
    expect(end?.robot.xCm).toBeLessThan(106);
    expect(await frame.evaluate(() => window.__stem?.robot.snapshotHash())).toMatch(/^[0-9a-f]{8}$/);
    await screenshot(page, '03-scored-1100x640.png');
    await frame.getByTestId('robot-camera').getByRole('button', { name: 'Nhìn từ trên' }).click();
    await page.waitForTimeout(600);
    await screenshot(page, '04-top-view-1100x640.png');
    await frame.getByTestId('robot-camera').getByRole('button', { name: 'Theo xe' }).click();
    await page.waitForTimeout(600);
    await screenshot(page, '05-follow-1100x640.png');
    expect(errors).toEqual([]);
  });

  test('steps 0.1 s of simulated time from idle, paused, then runs on with Tiếp tục', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.getByTestId('robot-step').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');
    await expect.poll(async () => (await view(frame))?.t).toBeCloseTo(0.1, 9);
    await frame.getByTestId('robot-step').click();
    await expect.poll(async () => (await view(frame))?.t).toBeCloseTo(0.2, 9);
    await page.waitForTimeout(300);
    expect((await view(frame))?.t).toBeCloseTo(0.2, 9);
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(0.4);
  });

  test('says when the browser takes the 3D view’s WebGL away, and draws again when it comes back; the run goes on', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    const lose = (action: 'loseContext' | 'restoreContext') =>
      frame.evaluate((which) => {
        const canvas = document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement;
        const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
        gl.getExtension('WEBGL_lose_context')?.[which]();
      }, action);
    await lose('loseContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveText('Khung nhìn 3D bị mất đồ hoạ. Đang khôi phục…');
    const before = (await view(frame))?.t ?? 0;
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(before + 0.2);
    await lose('restoreContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveCount(0);
    await expect(frame.getByTestId('blockly-panel').locator('svg.blocklySvg')).toBeVisible();
  });
});

test.describe('the robot lab’s layout (N18 R4.2)', () => {
  test('at 1100 x 640 in the lesson frame: the view about 60 %, the program beside it, nothing scrolls', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-line-follow'));
    const width = await frame.evaluate(() => window.innerWidth);
    const viewport = await frame.getByTestId('robot-viewport').boundingBox();
    const program = await frame.getByTestId('program-region').boundingBox();
    expect(width).toBe(1100);
    expect(viewport!.width / width).toBeGreaterThan(0.55);
    expect(viewport!.width / width).toBeLessThan(0.65);
    expect(program!.x).toBeGreaterThanOrEqual(viewport!.x + viewport!.width);
    expect(await scrolls(frame)).toEqual({ sideways: false, down: false });
    await expect(frame.getByRole('tab', { name: 'Khối lệnh' })).toHaveAttribute('aria-selected', 'true');
    await expect(frame.getByRole('tab', { name: 'C++' })).toBeVisible();
    await expect(frame.getByRole('tab', { name: 'Cổng & chân' })).toBeVisible();
    await screenshot(page, '06-line-follow-1100x640.png');
  });

  test('at 760 px: Robot and Chương trình are tabs, a Run shows the robot, nothing scrolls', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 760, height: 640 });
    await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');
    await page.getByTestId('robot-canvas').locator('canvas').waitFor({ state: 'attached' });
    await expect(page.getByRole('tab', { name: 'Chương trình', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await scrolls(page)).toEqual({ sideways: false, down: false });
    await screenshot(page, '07-program-tab-760.png');
    await page.evaluate((document) => window.__stem?.loadProject(document), solved());
    await page.getByTestId('robot-run').click();
    await expect(page.getByRole('tab', { name: 'Robot', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('robot-status')).toHaveText('Đang chạy');
    expect(await scrolls(page)).toEqual({ sideways: false, down: false });
    await expect.poll(async () => ((await page.evaluate(() => window.__stem?.robot.getSnapshot())) as RobotView | null)?.robot.xCm ?? 0).toBeGreaterThan(30);
    await screenshot(page, '08-robot-tab-760.png');
    expect(errors).toEqual([]);
  });
});
