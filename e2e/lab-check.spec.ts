import { expect, test, type Page } from '@playwright/test';
import { ybcImages } from '../src/samples/ybc-templates';
import { ybcSolutionDocument, type YbcLessonKey } from '../src/samples/ybc-solutions';

// N8s: Kiểm tra runs the program where the learner can see it: the board the canvas draws is the run the check
// judges, the virtual presses of the challenge are drawn (the board's buttons, the controls, the light level),
// and the board keeps the check's last frame afterwards, until the next run or edit.

type Seen = { display: string | null; pressed: string[]; light: number | undefined; controls: string[]; overlay: string | null };

/** What the learner sees now: the display as drawn (# lit), the parts drawn pressed, the controls shown pressed. */
const seen = (page: Page): Promise<Seen> =>
  page.evaluate(() => {
    const board = window.__stem?.getCanvasState()?.components.find((component) => component.display);
    return {
      display: board?.display ? board.display.map((pixel) => (pixel ? '1' : '0')).join('') : null,
      pressed: board?.pressedParts ?? [],
      light: board?.lightLevel,
      controls: [...document.querySelectorAll('[data-testid^="control-"][aria-pressed="true"]')].map((element) => element.getAttribute('data-testid') ?? ''),
      overlay: document.querySelector('[data-testid="check-overlay"]')?.getAttribute('data-state') ?? null,
    };
  });

/** The 25 cells of a template image as `seen` writes them. */
const cells = (frame: string) => frame.replaceAll(':', '');

async function openSolved(page: Page, key: YbcLessonKey) {
  await page.goto(`/?embed=1&lab=yolobit&template=${key}`);
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
  await page.evaluate((document) => window.__stem?.loadProject(document), ybcSolutionDocument(key));
}

/** Samples what the learner sees every 50 ms while the check runs, until it has a result. */
async function watchCheck(page: Page): Promise<Seen[]> {
  const frames: Seen[] = [];
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  const status = page.getByTestId('challenge-status');
  while (!/^(Đạt|Chưa đạt)/.test((await status.textContent()) ?? '')) {
    frames.push(await seen(page));
    await page.waitForTimeout(50);
  }
  return frames;
}

test.use({ viewport: { width: 1000, height: 640 } });

test('Button A/B: the check presses A then B on the board and the controls, and the board shows ✓ then ✗', async ({ page }) => {
  await openSolved(page, 'ybc-button-ab');
  const frames = await watchCheck(page);

  expect(frames.some((frame) => frame.overlay === 'running')).toBe(true);
  const pressedA = frames.find((frame) => frame.pressed.includes('button-a'));
  const pressedB = frames.find((frame) => frame.pressed.includes('button-b'));
  expect(pressedA?.controls).toEqual(['control-button-a']);
  expect(pressedB?.controls).toEqual(['control-button-b']);
  expect(frames.indexOf(pressedA as Seen)).toBeLessThan(frames.indexOf(pressedB as Seen));
  expect(frames.some((frame) => frame.display === cells(ybcImages.check))).toBe(true);
  expect(frames.some((frame) => frame.display === cells(ybcImages.cross))).toBe(true);

  // The result, and the board as the check left it (✗), held until the next run.
  await expect(page.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');
  await expect(page.getByTestId('run-status')).toHaveText('Chưa chạy');
  await expect.poll(() => seen(page)).toEqual({ display: cells(ybcImages.cross), pressed: [], light: undefined, controls: [], overlay: 'held' });
  await expect(page.getByTestId('display-text')).toContainText('#...#');
  await page.getByRole('button', { name: 'Chạy' }).click();
  await expect.poll(async () => (await seen(page)).overlay).toBeNull();
});

test('Night light: the check slides the light down then up, and the board lights then goes dark', async ({ page }) => {
  await openSolved(page, 'ybc-night-light');
  const frames = await watchCheck(page);

  expect(frames.some((frame) => frame.light === 10 && frame.display === cells(ybcImages.full))).toBe(true);
  expect(frames.some((frame) => frame.light === 80)).toBe(true);
  await expect(page.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');
});

test('an edit after a check drops the frame it left', async ({ page }) => {
  await openSolved(page, 'ybc-heart');
  await watchCheck(page);
  await expect.poll(async () => (await seen(page)).display).toBe(cells(ybcImages.heart));

  await page.getByRole('button', { name: 'Thêm Đèn LED' }).click();
  await expect.poll(() => seen(page)).toMatchObject({ display: '0'.repeat(25), overlay: null });
});

test('a Blockly lab: the check holds the push button, drawn closed, and the LED follows it', async ({ page }) => {
  await page.goto('/?embed=1&lab=blockly&template=button-led');
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
  const states: { closed?: boolean; lit?: boolean }[] = [];
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  const status = page.getByTestId('challenge-status');
  while (!/^(Đạt|Chưa đạt)/.test((await status.textContent()) ?? '')) {
    const { components } = (await page.evaluate(() => window.__stem?.getCanvasState())) ?? { components: [] };
    states.push({ closed: components.find((c) => c.id === 'button')?.closed, lit: components.find((c) => c.id === 'led')?.lit });
    await page.waitForTimeout(50);
  }
  expect(states).toContainEqual({ closed: true, lit: true });
  await expect(status).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');
});

test.describe('in a narrow frame', () => {
  test.use({ viewport: { width: 670, height: 600 } });

  test('Kiểm tra turns to the circuit, so the check is seen', async ({ page }) => {
    await openSolved(page, 'ybc-heart');
    await expect(page.getByRole('tab', { name: 'Chương trình' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByRole('tab', { name: 'Mạch' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('circuit-canvas')).toBeVisible();
    await expect(page.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.', { timeout: 10_000 });
  });
});
