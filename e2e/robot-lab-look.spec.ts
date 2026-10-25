import { expect, test, type Frame, type Page } from '@playwright/test';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';

// N18 R4.7: every pilot scenario's 3D view, in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts, project
// chromium-robot), is the modelled scene (not the simple fallback shapes) and looks 3D: across a grid of pixels read from its drawing
// buffer, the light varies (shading, shadows, materials: the luminance's standard deviation) and there are many colours, none of them
// the page's background. A blank or flat view (R4.2's blank viewport in rb-line-follow's 170 x 140 cm arena) fails here. Fix round 1:
// model files that do not load draw R4.2's simple shapes (never the 2D map), and the view measures what floats over it again when it is
// made again (Xem 2D, then Xem 3D): an open results card still slides the picture.

const lessonOrigin = 'http://lesson.localhost:5190';
const pilots = ['rb-drive-to-zone', 'rb-square-route', 'rb-stop-at-wall', 'rb-line-follow', 'rb-servo-gate', 'rb-mini-mission'] as const;

const labUrl = (baseURL: string | undefined, query: string) => new URL(`/?embed=1&${query}`, baseURL).href;

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('The lab iframe has no frame');
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 30_000 });
  return frame;
}

/** Reads a 24 × 16 grid of the drawing buffer's pixels at every draw to the screen, after its draw calls, before it is composited. */
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
  // Colours told apart at 4 bits a channel: anti-aliasing noise is not a colour.
  const colours = new Set(pixels.map((pixel) => pixel.map((c) => c >> 4).join(','))).size;
  return { deviation, colours, background: pixels.filter(([r, g, b]) => r === 0xf1 && g === 0xf4 && b === 0xf9).length };
}

test.describe('the robot lab’s 3D look (N18 R4.7)', () => {
  for (const key of pilots) {
    test(`${key}: the modelled scene, with shading and many colours`, async ({ page, baseURL }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.addInitScript(sampleDraws);
      const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=${key}`));
      await expect(frame.getByTestId('robot-canvas').locator('canvas')).toHaveAttribute('data-models', 'modelled');
      const pixels = await frame.evaluate(() => (window as unknown as { __look: number[][] }).__look);
      expect(pixels).toHaveLength(24 * 16);
      const { deviation, colours, background } = look(pixels);
      expect(deviation).toBeGreaterThan(0.08);
      expect(colours).toBeGreaterThanOrEqual(30);
      expect(background).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('the high tier draws the modelled scene too, with its soft shadows', async ({ page, baseURL }) => {
    await page.addInitScript(sampleDraws);
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-servo-gate'));
    await frame.getByTestId('robot-quality').click();
    await expect(frame.getByTestId('robot-canvas')).toHaveAttribute('data-tier', 'high');
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 30_000 });
    await expect(frame.getByTestId('robot-canvas').locator('canvas')).toHaveAttribute('data-models', 'modelled');
    await expect.poll(async () => look(await frame.evaluate(() => (window as unknown as { __look: number[][] }).__look)).colours).toBeGreaterThanOrEqual(30);
  });

  test('"Đặt lại góc nhìn" puts a moved camera back where the view starts', async ({ page, baseURL }) => {
    await page.addInitScript(sampleDraws);
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    const before = await frame.evaluate(() => (window as unknown as { __look: number[][] }).__look);
    const box = (await frame.getByTestId('robot-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify(await frame.evaluate(() => (window as unknown as { __look: number[][] }).__look))).not.toBe(JSON.stringify(before));
    await frame.getByTestId('robot-camera-reset').click();
    await expect(frame.getByTestId('robot-camera-reset')).toHaveAttribute('aria-label', 'Đặt lại góc nhìn');
    // Reduced motion is off: the camera glides back (0.45 s), then rests where it started.
    const sameShare = async () => {
      const after = await frame.evaluate(() => (window as unknown as { __look: number[][] }).__look);
      return after.filter((pixel, i) => pixel.every((c, k) => Math.abs(c - before[i]![k]!) <= 6)).length / after.length;
    };
    await expect.poll(sameShare, { timeout: 5_000 }).toBeGreaterThan(0.9);
  });

  test('model files that do not load: R4.2’s simple shapes are drawn, and no 2D map stands in', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route('**/robot3d/*.glb*', (route) => route.fulfill({ status: 404, body: 'missing' }));
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await expect(frame.getByTestId('robot-canvas').locator('canvas')).toHaveAttribute('data-models', 'simple');
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await expect(frame.getByTestId('robot-viewmode')).toHaveText('Xem 2D');
    expect(errors).toEqual([]);
  });

  test('a results card slides the picture after Xem 2D and Xem 3D: the view made again is the one measured', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.getByTestId('robot-viewmode').click();
    await expect(frame.getByTestId('robot-topview')).toBeVisible();
    await frame.getByTestId('robot-viewmode').click();
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 30_000 });
    const canvas = frame.getByTestId('robot-canvas').locator('canvas');
    await expect(canvas).toHaveAttribute('data-lens-shift', '0');
    await frame.evaluate((document) => window.__stem?.loadProject(document), { ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-results')).toHaveAttribute('data-open', 'true', { timeout: 60_000 });
    // The card covers the view's right: the picture slides left (a negative shift), to the middle of what the card leaves.
    await expect.poll(async () => Number((await canvas.getAttribute('data-lens-shift'))?.split(',')[0] ?? 0), { timeout: 5_000 }).toBeLessThan(-0.2);
    // Folded, the picture slides back.
    await frame.getByTestId('robot-check-fold').click();
    await expect(canvas).toHaveAttribute('data-lens-shift', '0', { timeout: 5_000 });
  });
});
