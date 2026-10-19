import { expect, test, type Page } from '@playwright/test';
import { scrollFrame } from '../src/core/simulation/peripherals/display';
import { ybcSolutionDocument, type YbcLessonKey } from '../src/samples/ybc-solutions';
import { canvasState, readJson } from './helpers';

// N17 B6: the labs of the full Yolo:Bit board, as the LMS opens them (`lab=yolobit`, Vietnamese). The rainbow on the Basic board
// and the thermometer on the Advanced one pass Kiểm tra with their solution; A pressed on the drawing of the board turns the rainbow;
// the temperature the learner sets is what B scrolls; a lab of the Advanced board refuses the Basic one, in Vietnamese; and a check
// whose tab is hidden is interrupted, never passed (Review Focus 4).

test.use({ viewport: { width: 1000, height: 640 } });

const passed = 'Đạt! Bạn đã hoàn thành mọi mục tiêu.';
const interrupted = 'Chưa đạt: lần kiểm tra bị gián đoạn (tab bị ẩn hoặc máy chạy chậm). Hãy để tab này mở và bấm Kiểm tra lại.';
const parts = readJson('../src/core/devices/definitions/ybc-board.json').board.onboard as { id: string; at: { x: number; y: number; width: number; height: number } }[];

async function openLab(page: Page, key: YbcLessonKey, profile: string) {
  await page.goto(`/?embed=1&lab=yolobit&template=${key}&profile=${profile}`);
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

async function openSolved(page: Page, key: YbcLessonKey, profile: string) {
  await openLab(page, key, profile);
  await page.evaluate((document) => window.__stem?.loadProject(document), { ...ybcSolutionDocument(key), profile });
}

async function checkAndWait(page: Page) {
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  await expect(page.getByTestId('challenge-status')).toHaveText(/^(Đạt|Chưa đạt)/, { timeout: 10_000 });
}

const boardOf = async (page: Page) => (await canvasState(page)).components.find((component) => component.deviceType === 'ybc-board');
/** The one colour the whole display is lit in, or null. */
const fill = async (page: Page) => {
  const cells = (await boardOf(page))?.display ?? [];
  return cells.length === 25 && cells.every((cell) => cell !== null && cell === cells[0]) ? cells[0] : null;
};
const glyph = (character: string) => scrollFrame([character], 0).pixels.map((pixel) => (pixel === null ? '0' : '1')).join('');
/** Waits until the display shows `character` in full: watched every 40 ms in the page, since a scrolled character stays only 200 ms. */
const showsCharacter = (page: Page, character: string) =>
  page.waitForFunction(
    (wanted) =>
      window.__stem
        ?.getCanvasState()
        ?.components.find((component) => component.deviceType === 'ybc-board')
        ?.display?.map((cell) => (cell === null ? '0' : '1'))
        .join('') === wanted,
    glyph(character),
    { polling: 40, timeout: 5_000 },
  );

/** The middle of a part drawn on the board, in page pixels. */
async function partCentre(page: Page, partId: string) {
  const state = await canvasState(page);
  const board = state.components.find((component) => component.deviceType === 'ybc-board');
  const at = parts.find((part) => part.id === partId)?.at;
  const canvas = await page.getByTestId('circuit-canvas').boundingBox();
  if (!board || !at || !canvas) {
    throw new Error(`No ${partId} on the board`);
  }
  const { scale, x, y } = state.viewport;
  return { x: canvas.x + x + (board.x + at.x + at.width / 2) * scale, y: canvas.y + y + (board.y + at.y + at.height / 2) * scale };
}

async function pressOnDrawing(page: Page, partId: string) {
  const centre = await partCentre(page, partId);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

test('the rainbow on the Basic board (profile=ybc-basic): the solution passes Kiểm tra; the board has no sensor controls or readings', async ({ page }) => {
  await openSolved(page, 'ybc-rainbow', 'ybc-basic');
  await expect(page.getByTestId('goal-a-changes-colour')).toContainText('Bấm A hai lần thì cả màn hình sáng hai màu khác nhau');
  await checkAndWait(page);
  await expect(page.getByTestId('challenge-status')).toHaveText(passed);
  await expect(page.getByTestId('goal-a-changes-colour')).toHaveAttribute('data-state', 'passed');

  // Basic: no temperature or accelerometer control, and no line of readings under the display while a run is on.
  await page.getByRole('button', { name: 'Chạy' }).click();
  await expect(page.getByTestId('control-button-a')).toBeEnabled();
  await expect(page.getByTestId('control-temperature')).toHaveCount(0);
  await expect(page.getByTestId('control-accelerometer')).toHaveCount(0);
  expect((await boardOf(page))?.temperature).toBeUndefined();
  await page.getByRole('button', { name: 'Dừng' }).click();
});

test('the rainbow with profile=ybc-advanced passes as well', async ({ page }) => {
  await openSolved(page, 'ybc-rainbow', 'ybc-advanced');
  await checkAndWait(page);
  await expect(page.getByTestId('challenge-status')).toHaveText(passed);
});

test('A pressed on the drawing of the board turns the whole display to the next colour: red, green, blue', async ({ page }) => {
  await openSolved(page, 'ybc-rainbow', 'ybc-basic');
  await page.getByRole('button', { name: 'Chạy' }).click();
  await expect.poll(() => fill(page)).toBe('#FF0000');

  await pressOnDrawing(page, 'button-a');
  await expect.poll(() => fill(page)).toBe('#00FF00');
  await pressOnDrawing(page, 'button-a');
  await expect.poll(() => fill(page)).toBe('#0000FF');
  await page.getByRole('button', { name: 'Dừng' }).click();
});

test('the thermometer on the Advanced board: the temperature set on the slider is what B scrolls, and Kiểm tra passes', async ({ page }) => {
  await openSolved(page, 'ybc-thermometer', 'ybc-advanced');
  await page.getByRole('button', { name: 'Chạy' }).click();
  const slider = page.getByTestId('control-temperature');
  await expect(slider).toBeEnabled();
  await slider.fill('30');
  await expect(page.getByTestId('control-temperature-value')).toHaveText('30 °C');
  await expect.poll(async () => (await boardOf(page))?.temperature).toBe(30);

  await pressOnDrawing(page, 'button-b');
  await showsCharacter(page, '3');
  await showsCharacter(page, '0');
  await page.getByRole('button', { name: 'Dừng' }).click();

  await checkAndWait(page);
  await expect(page.getByTestId('challenge-status')).toHaveText(passed);
  await expect(page.getByTestId('goal-b-scrolls-30')).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('goal-uses-temperature')).toHaveAttribute('data-state', 'passed');
});

test.describe('every new lab: the starter does not pass, the solution does', () => {
  const labs: [YbcLessonKey, string][] = [
    ['ybc-rainbow', 'ybc-basic'],
    ['ybc-thermometer', 'ybc-advanced'],
    ['ybc-dice', 'ybc-advanced'],
    ['ybc-servo-gate', 'ybc-advanced'],
  ];
  for (const [key, profile] of labs) {
    test(`${key} (${profile})`, async ({ page }) => {
      await openLab(page, key, profile);
      await checkAndWait(page);
      await expect(page.getByTestId('challenge-status')).toHaveText('Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.');

      await page.evaluate((document) => window.__stem?.loadProject(document), { ...ybcSolutionDocument(key), profile });
      await checkAndWait(page);
      await expect(page.getByTestId('challenge-status')).toHaveText(passed);
    });
  }
});

test.describe('a lab of the Advanced board', () => {
  for (const key of ['ybc-thermometer', 'ybc-dice', 'ybc-servo-gate']) {
    test(`${key} refuses profile=ybc-basic, saying why in Vietnamese`, async ({ page }) => {
      await page.goto(`/?embed=1&lab=yolobit&template=${key}&profile=ybc-basic`);
      const error = page.getByTestId('launch-error');
      await expect(error).toBeVisible();
      await expect(error).toContainText(`Mẫu bài "${key}" cần mức Nâng cao (profile=ybc-advanced): bài dùng khối hoặc linh kiện mà mức Cơ bản không có.`);
      await expect(page.getByTestId('circuit-canvas')).toHaveCount(0);
    });
  }

  test('opens without a profile on its own level, and in the legacy launch', async ({ page }) => {
    await page.goto('/?embed=1&lab=yolobit&template=ybc-servo-gate');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    expect(await page.evaluate(() => (window.__stem?.getProject() as { profile?: string }).profile)).toBe('ybc-advanced');
    await expect(page.getByRole('button', { name: 'Thêm Động cơ servo' })).toBeVisible();

    await page.goto('/?embed=1&template=ybc-dice');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    expect(await page.evaluate(() => (window.__stem?.getProject() as { profile?: string }).profile)).toBe('ybc-advanced');
  });
});

test('a check whose tab is hidden is interrupted, not passed; checked again with the tab open, it passes (Review Focus 4)', async ({ page }) => {
  await openSolved(page, 'ybc-rainbow', 'ybc-basic');
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  await expect(page.getByTestId('check-overlay')).toHaveAttribute('data-state', 'running');
  // The browser hides the tab (another tab, a minimised window).
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByTestId('challenge-status')).toHaveText(interrupted);
  await expect(page.getByTestId('goal-a-changes-colour')).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('run-status')).toHaveText('Chưa chạy');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await checkAndWait(page);
  await expect(page.getByTestId('challenge-status')).toHaveText(passed);
});
