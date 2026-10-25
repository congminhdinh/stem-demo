import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { topPose } from '../src/ui/robot3d/camera';

// N18 R4.8: the robot lab's view tools in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts, project
// chromium-robot). Lái tay drives the robot with the keyboard through the simulated hardware (the snapshot's pose moves, the host hears of
// no run); Thước đo measures between two clicks on the mat in the top view and on the 2D map, within 0.5 cm of the true distance;
// Di chuyển robot drags the robot to a new start. Nothing is written to the console as an error. Screenshots go to R48_SHOTS_DIR (the
// report's), or under test-results.

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R48_SHOTS_DIR ?? join('test-results', 'robot-lab-tools');
/** The 3D view's camera (Scene.tsx). */
const FOV_DEG = 40;
/** rb-drive-to-zone: 160 × 80 cm, the robot starts at (25, 40) facing +x. */
const ARENA_CM = [160, 80] as const;

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };
type RobotView = { t: number; robot: { xCm: number; yCm: number; yawDeg: number }; status: string };

const labUrl = (baseURL: string | undefined) => new URL(`/?embed=1&lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.getByTestId('robot-lab').waitFor();
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 15_000 });
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
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/** The number of cm a readout says ("61,9 cm"). */
const cmOf = async (locator: Locator) => Number((await locator.innerText()).replace(' cm', '').replace(',', '.'));

/**
 * Where the top view ("Nhìn từ trên", camera.ts `topPose`) shows an arena point on the page: straight down on the arena's middle, the
 * canvas's middle is it, and a cm is as many px as the field of view gives at the camera's height.
 */
async function topViewPoint(frame: Frame, xCm: number, yCm: number): Promise<{ x: number; y: number }> {
  const canvas = (await frame.getByTestId('robot-canvas').boundingBox())!;
  const aspect = canvas.width / canvas.height;
  const height = topPose({ widthM: ARENA_CM[0] / 100, depthM: ARENA_CM[1] / 100 }, FOV_DEG, aspect).position[1];
  const halfHeightCm = height * Math.tan((FOV_DEG * Math.PI) / 360) * 100;
  const pxPerCm = canvas.height / 2 / halfHeightCm;
  return { x: canvas.x + canvas.width / 2 + (xCm - ARENA_CM[0] / 2) * pxPerCm, y: canvas.y + canvas.height / 2 - (yCm - ARENA_CM[1] / 2) * pxPerCm };
}

test.describe('the robot lab’s view tools (N18 R4.8)', () => {
  test('Lái tay: the keyboard drives the robot through the simulated hardware, the D-pad shows, and the host hears of no run', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.getByTestId('robot-tool-teleop').click();
    await expect(frame.getByTestId('robot-tool-teleop')).toHaveAttribute('aria-pressed', 'true');
    await expect(frame.getByTestId('robot-teleop')).toBeVisible();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang lái tay');
    await expect.poll(async () => (await view(frame))?.status).toBe('running');
    const start = (await view(frame))!.robot;
    expect(start.xCm).toBeCloseTo(25, 0);

    // Hold ↑ (the view has the focus since the toggle gave it): the robot drives forward, along +x.
    await page.keyboard.down('ArrowUp');
    await expect.poll(async () => (await view(frame))!.robot.xCm, { timeout: 10_000 }).toBeGreaterThan(start.xCm + 8);
    await expect(frame.getByTestId('robot-pad-forward')).toHaveAttribute('aria-pressed', 'true');
    await screenshot(page, '01-teleop-dpad.png');
    await page.keyboard.up('ArrowUp');
    await expect(frame.getByTestId('robot-pad-forward')).toHaveAttribute('aria-pressed', 'false');
    // Let go: it stops (the pose holds still over a quarter second once the motors are off).
    await expect
      .poll(
        async () => {
          const before = (await view(frame))!.robot.xCm;
          await page.waitForTimeout(250);
          return Math.abs((await view(frame))!.robot.xCm - before);
        },
        { timeout: 5_000 },
      )
      .toBeLessThan(0.05);
    const stopped = (await view(frame))!.robot;
    expect(Math.abs(stopped.yCm - start.yCm)).toBeLessThan(1);

    // D turns it right (clockwise: the yaw goes down).
    await page.keyboard.down('d');
    await expect.poll(async () => (await view(frame))!.robot.yawDeg, { timeout: 10_000 }).toBeLessThan(stopped.yawDeg - 20);
    await page.keyboard.up('d');

    // The host never heard a run start: teleop is no run of the learner's program.
    expect(await messageTypes(page)).not.toContain('run-started');
    await frame.getByTestId('robot-tool-teleop').click();
    await expect(frame.getByTestId('robot-teleop')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Thước đo in the top view: two clicks on the mat read their distance within 0.5 cm, and the angle to the robot’s heading', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.locator('[data-testid=robot-camera] [data-mode=top]').click();
    await frame.getByTestId('robot-tool-ruler').click();
    await expect(frame.getByTestId('robot-ruler')).toHaveText('Bấm điểm thứ nhất trên sa bàn.');
    const a = await topViewPoint(frame, 60, 40);
    const b = await topViewPoint(frame, 120, 55);
    await page.mouse.click(a.x, a.y);
    await expect(frame.getByTestId('robot-ruler-from')).toBeVisible();
    await page.mouse.click(b.x, b.y);
    await expect(frame.getByTestId('robot-ruler-distance')).toBeVisible();
    // √(60² + 15²) = 61.85 cm, at 14.04° to the left of the robot's heading (+x).
    expect(Math.abs((await cmOf(frame.getByTestId('robot-ruler-distance'))) - Math.hypot(60, 15))).toBeLessThan(0.5);
    await expect(frame.getByTestId('robot-ruler-angle')).toHaveText(/^1[34],\d° sang trái$/);
    await screenshot(page, '02-ruler-top-view.png');

    // A click near the robot snaps to its middle.
    const robot = await topViewPoint(frame, 26, 41);
    await page.mouse.click(robot.x, robot.y);
    await expect(frame.getByTestId('robot-ruler-from')).toHaveText('tâm robot (x 25,0 · y 40,0 cm)');
    // Esc on the view clears it.
    await page.keyboard.press('Escape');
    await expect(frame.getByTestId('robot-ruler')).toHaveText('Bấm điểm thứ nhất trên sa bàn.');
    expect(errors).toEqual([]);
  });

  test('Di chuyển robot: a drag in the top view puts the robot at a new start, which a Run starts from', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.locator('[data-testid=robot-camera] [data-mode=top]').click();
    await frame.getByTestId('robot-tool-move').click();
    const from = await topViewPoint(frame, 25, 40);
    const to = await topViewPoint(frame, 80, 55);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await screenshot(page, '03-move-ghost.png');
    await page.mouse.up();
    await expect.poll(async () => (await view(frame))?.robot.xCm ?? 0).toBeGreaterThan(70);
    const placed = (await view(frame))!.robot;
    expect(Math.hypot(placed.xCm - 80, placed.yCm - 55)).toBeLessThan(0.5);
    await expect(frame.getByTestId('robot-move-pose')).toHaveText(/^x 8\d,\d · y 5\d,\d cm · 0°$/);
    // Q turns it 15° to the left.
    await page.keyboard.press('q');
    await expect.poll(async () => (await view(frame))!.robot.yawDeg).toBeCloseTo(15, 3);
    // A Run starts there.
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText(/Đang chạy|Chương trình đã chạy xong|Lượt chạy kết thúc/);
    await expect.poll(async () => (await view(frame))?.status).not.toBe('idle');
    const running = (await view(frame))!.robot;
    expect(Math.hypot(running.xCm - placed.xCm, running.yCm - placed.yCm)).toBeLessThan(5);
    expect(errors).toEqual([]);
  });

  test('on the 2D map (Xem 2D) the ruler measures there too, within 0.5 cm', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.getByTestId('robot-viewmode').click();
    await frame.getByTestId('robot-topview').waitFor();
    await frame.evaluate(async () => {
      const path = '/src/ui/robot3d/top-view-tools-state.ts';
      const module = (await import(/* @vite-ignore */ path)) as typeof import('../src/ui/robot3d/top-view-tools-state');
      (window as unknown as { __topViewTools: typeof module }).__topViewTools = module;
    });
    const at = (xCm: number, yCm: number) =>
      frame.evaluate(([x, y]) => (window as unknown as { __topViewTools: typeof import('../src/ui/robot3d/top-view-tools-state') }).__topViewTools.topViewStagePoint(x!, y!), [xCm, yCm]);
    const map = (await frame.getByTestId('robot-topview').boundingBox())!;
    await frame.getByTestId('robot-tool-ruler').click();
    for (const [xCm, yCm] of [
      [50, 20],
      [130, 70],
    ] as const) {
      const point = (await at(xCm, yCm))!;
      await page.mouse.click(map.x + point.x, map.y + point.y);
    }
    await expect(frame.getByTestId('robot-ruler-distance')).toBeVisible();
    expect(Math.abs((await cmOf(frame.getByTestId('robot-ruler-distance'))) - Math.hypot(80, 50))).toBeLessThan(0.5);
    const drawn = await frame.evaluate(() => (window as unknown as { __topViewTools: typeof import('../src/ui/robot3d/top-view-tools-state') }).__topViewTools.readTopViewTools());
    expect(drawn?.label).toMatch(/^94,\d cm$/);
    await screenshot(page, '04-ruler-2d-map.png');
    expect(errors).toEqual([]);
  });
});
