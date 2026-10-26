import { expect, test, type Frame, type Page } from '@playwright/test';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import { pinLowTierChainOff } from './robot-chain';

// N18 P2 fix round 1 (C1): the low tier's chain for a computer without a GPU, its steps forced through the dev hooks (the other robot
// specs pin it off; here it is pinned off too, so only the forced steps happen). SwiftShader, the low tier (playwright.config.ts,
// project chromium-robot), rb-drive-to-zone's reference solution. Capped, a run is drawn about every other display frame (`drawDue`:
// 29.3 ms from the last draw) and is the same run: the same hash at the same virtual time and at its time limit. The 2D map is only
// offered: "Xem 2D" shows it and the run goes on; "Giữ 3D" keeps 3D, and the offer does not come again.

// Two runs at 4× to the 15 s time limit draw at most 8 ticks a frame on SwiftShader: tens of seconds on a shared machine (fix round 2, N1).
test.describe.configure({ timeout: 120_000 });

const lessonOrigin = 'http://lesson.localhost:5190';
const labUrl = (baseURL: string | undefined) => new URL(`/?embed=1&lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;
const solved = () => ({ ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });
type RobotView = { t: number; status: string };
const view = (frame: Frame) => frame.evaluate(() => window.__stem?.robot.getSnapshot() as RobotView | null);
const hash = (frame: Frame) => frame.evaluate(() => window.__stem?.robot.snapshotHash() ?? null);

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('The lab iframe has no frame');
  await frame.getByTestId('robot-lab').waitFor();
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 15_000 });
  await pinLowTierChainOff(frame);
  await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
  return frame;
}

/** Steps the run 0.1 s at a time from idle to `tenths` tenths of a second of virtual time; then its hash. */
async function hashAfterSteps(frame: Frame, tenths: number): Promise<string | null> {
  for (let i = 1; i <= tenths; i++) {
    await frame.getByTestId('robot-step').click();
    await expect.poll(async () => (await view(frame))?.t).toBeCloseTo(i / 10, 9);
  }
  return hash(frame);
}

/** Runs to the scenario's time limit (15 s) at 4× and gives the hash of where it ended. */
async function hashAtTimeLimit(frame: Frame): Promise<string | null> {
  await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
  await frame.getByTestId('robot-run').click();
  await expect(frame.getByTestId('robot-hud')).toHaveAttribute('data-status', 'timeUp', { timeout: 60_000 });
  return hash(frame);
}

test.describe('the low tier’s chain, its steps forced (N18 P2 fix round 1)', () => {
  test('runs on the low tier, and a capped run is the same run: the same hash at 1.0 s of steps and at its time limit', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await expect(frame.getByTestId('robot-quality')).toHaveAttribute('data-tier', 'low');
    const stepped = await hashAfterSteps(frame, 10);
    await frame.getByTestId('robot-stop').click();
    const ended = await hashAtTimeLimit(frame);
    await frame.getByTestId('robot-stop').click();
    await frame.evaluate(() => window.__stem?.robot.forceLowTierStep('cap'));
    await expect(frame.getByTestId('robot-quality-note')).toHaveText('Đang vẽ 30 hình mỗi giây cho mượt hơn');
    expect(stepped).not.toBeNull();
    expect(await hashAfterSteps(frame, 10)).toBe(stepped);
    await frame.getByTestId('robot-stop').click();
    expect(await hashAtTimeLimit(frame)).toBe(ended);
  });

  test('draws a capped run about every other display frame: as often as drawDue allows, and about 0.5 draws a changed snapshot where the display keeps up', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate(() => window.__stem?.robot.forceLowTierStep('cap'));
    // Counts the canvas's draws to the screen (three clears WebGL's default framebuffer once a render), as robot-lab-scene.spec.ts does.
    await frame.evaluate(() => {
      const gl = (document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement).getContext('webgl2')!;
      const counter = window as unknown as { __draws: number };
      counter.__draws = 0;
      const clear = gl.clear.bind(gl);
      gl.clear = (mask: number) => {
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) counter.__draws += 1;
        clear(mask);
      };
    });
    await frame.evaluate(() => window.__stem?.robot.setSpeed(2));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(0.3);
    const during = await frame.evaluate(
      () =>
        new Promise<{ changed: number; draws: number; due: number; frames: number[] }>((done) => {
          const counter = window as unknown as { __draws: number };
          const start = counter.__draws;
          const frames: number[] = [];
          let last = -1;
          let changed = 0;
          const step = (now: number) => {
            frames.push(now);
            const t = (window.__stem?.robot.getSnapshot() as { t: number } | null)?.t ?? -1;
            if (t !== last) changed += 1;
            last = t;
            if (frames.length < 90) requestAnimationFrame(step);
            else {
              // The draws the cap allows over these display frames (frame-watch.ts drawDue: 1000 / 30 − 4 ms since the last draw).
              let since = Infinity;
              let due = 0;
              for (let i = 1; i < frames.length; i++) {
                since += frames[i]! - frames[i - 1]!;
                if (since >= 1000 / 30 - 4) {
                  due += 1;
                  since = 0;
                }
              }
              done({ changed, draws: counter.__draws - start, due, frames });
            }
          };
          requestAnimationFrame(step);
        }),
    );
    test.info().annotations.push({ type: 'capped draws', description: `${during.draws} draws, ${during.changed} snapshots changed, ${during.due} allowed by the cap over ${during.frames.length} display frames` });
    expect(during.changed).toBeGreaterThan(30);
    // Never more draws than the cap allows (one more for the frame in flight), and most of them.
    expect(during.draws).toBeLessThanOrEqual(during.due + 1);
    expect(during.draws).toBeGreaterThanOrEqual(during.due * 0.6);
    const gaps = during.frames.slice(1).map((t, i) => t - during.frames[i]!).sort((a, b) => a - b);
    if (gaps[Math.floor(gaps.length / 2)]! < 20) {
      // The display keeps up (60 Hz): about every other frame.
      expect(during.draws / during.changed).toBeGreaterThan(0.35);
      expect(during.draws / during.changed).toBeLessThan(0.65);
    }
  });

  test('offers the 2D map, and never shows it by itself: Xem 2D shows it and the run goes on', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    await frame.evaluate(() => window.__stem?.robot.forceLowTierStep('offer'));
    const offer = frame.getByTestId('robot-offer-2d');
    await expect(offer).toContainText('3D chạy chậm trên máy này: bản đồ 2D mượt hơn.');
    await page.waitForTimeout(1000);
    await expect(offer).toBeVisible();
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await frame.getByTestId('robot-offer-2d-accept').click();
    await expect(frame.getByTestId('robot-topview')).toBeVisible();
    await expect(offer).toHaveCount(0);
    const at = (await view(frame))?.t ?? 0;
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(at + 0.5);
  });

  test('keeps 3D on Giữ 3D, and does not offer the 2D map again', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate(() => window.__stem?.robot.forceLowTierStep('offer'));
    await frame.getByTestId('robot-offer-2d-keep').click();
    await expect(frame.getByTestId('robot-offer-2d')).toHaveCount(0);
    await expect(frame.locator('[data-testid=robot-scene][data-drawn=true]')).toHaveCount(1);
    await frame.evaluate(() => window.__stem?.robot.forceLowTierStep('offer'));
    await page.waitForTimeout(500);
    await expect(frame.getByTestId('robot-offer-2d')).toHaveCount(0);
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
  });
});
