import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import type { TopViewSensorsState } from '../src/ui/robot3d/top-view-sensors-state';
import type { SensorOverlayProbe } from '../src/ui/robot3d/parts/sensor-overlay';
import { pinLowTierChainOff } from './robot-chain';
import { basicSkip } from '../tests/basic-skip';

basicSkip(test.skip, 'the sensor overlays');

// N18 R4.3: the robot lab's sensor overlays in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts, project
// chromium-robot). In stop-at-wall, the goal's zone is lit before the run; once it runs the ultrasonic ray, its echo dot and its tag with the
// distance in cm (the comma) appear and match the sensor's reading; "Hiện cảm biến" takes them off and brings them back; they show in a
// check at 1× and in Xem lại; the zone's glow pulses while a run goes on and stands still with reduced motion; a robot at rest draws no
// frame for them (also while a run goes on with the robot at rest, the pulse being no frame of its own); the ray is on the canvas, in the
// colour of the beam, and gone with the switch; the switch has a 44 px hit area; and the 2D map ("Xem 2D") has the same. Screenshots go to R43_SHOTS_DIR (the report's), or under test-results.

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R43_SHOTS_DIR ?? join('test-results', 'robot-lab-sensors');

type RobotView = { t: number; status: string; robot: { xCm: number; yCm: number; yawDeg: number }; sensors: { kind: string; cm?: number; hitId?: string | null }[] };

const labUrl = (baseURL: string | undefined, query = 'template=rb-stop-at-wall') => new URL(`/?embed=1&lab=robot&${query}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.getByTestId('robot-lab').waitFor();
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await expect(frame.getByTestId('robot-3d-loading')).toHaveCount(0);
  // The overlay's state reader and the map's: the very instances the lab runs on, from the dev server.
  await frame.evaluate(async () => {
    const overlay = '/src/ui/robot3d/sensor-overlay-state.ts';
    const map = '/src/ui/robot3d/top-view-sensors-state.ts';
    const w = window as unknown as { __sensorOverlay: unknown; __topViewSensors: unknown };
    w.__sensorOverlay = await import(/* @vite-ignore */ overlay);
    w.__topViewSensors = await import(/* @vite-ignore */ map);
  });
  await pinLowTierChainOff(frame);
  return frame;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

const view = (frame: Frame) => frame.evaluate(() => window.__stem?.robot.getSnapshot() as RobotView | null);
const overlay = (frame: Frame) =>
  frame.evaluate(() => (window as unknown as { __sensorOverlay: { readSensorOverlay(): SensorOverlayProbe | null } }).__sensorOverlay.readSensorOverlay());
const mapOverlay = (frame: Frame) =>
  frame.evaluate(() => (window as unknown as { __topViewSensors: { readTopViewSensors(): TopViewSensorsState | null } }).__topViewSensors.readTopViewSensors());
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/**
 * Reads `read` until it has the same value twice, 400 ms apart, and gives that value. A frame the machine draws late (SwiftShader under a
 * suite's load) has come by then; a scene that kept drawing would never give the same count twice, and the wait ends at 30 s.
 */
async function settled<T>(read: () => Promise<T>): Promise<T> {
  let last: { value: T } | null = null;
  await expect
    .poll(
      async () => {
        const value = await read();
        const same = last !== null && JSON.stringify(last.value) === JSON.stringify(value);
        last = { value };
        return same;
      },
      { timeout: 30_000, intervals: [400] },
    )
    .toBe(true);
  return (last as { value: T } | null)!.value;
}

/** stop-at-wall with a program of its solutions: the reference, or the exploit of that name. */
const projectOf = (program: 'reference' | string) => {
  const solution = robotSolutions['rb-stop-at-wall'];
  const blocks = program === 'reference' ? solution.reference : solution.exploits?.find((exploit) => exploit.name === program)?.program;
  if (blocks === undefined) throw new Error(`rb-stop-at-wall has no program ${program}`);
  return { ...robotStarterDocument('rb-stop-at-wall'), program: { blocks } };
};

/** What a tag says for a reading: to a tenth of a cm, with the learner's comma. */
const tagOf = (cm: number) => `${(Math.round(cm * 10) / 10).toFixed(1).replace('.', ',')} cm`;
const ultrasonicOf = (snapshot: RobotView | null) => snapshot?.sensors.find((sensor) => sensor.kind === 'ultrasonic');

// N18 bt-lab-fix: under a suite's load SwiftShader draws a run slowly (at most 8 ticks a drawn frame), so the waits in this file are for a
// condition, not for a time, and a test's own limit is for a hang, not for a busy machine.
test.describe.configure({ timeout: 120_000 });

test.describe('the sensor overlays in the robot lab (N18 R4.3)', () => {
  test('stop-at-wall: the goal’s zone is lit before the run, then the ray, its echo and its tag in cm appear and match the reading', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    // Before a run: the zone the goal needs, and no beam (nothing has been read yet).
    await expect.poll(async () => (await overlay(frame))?.zone, { timeout: 30_000 }).toBe('stop-zone');
    expect((await overlay(frame))?.ultrasonics[0]).toMatchObject({ role: 'ultrasonic', visible: false, label: null });
    await expect(frame.getByTestId('robot-sensors')).toHaveAttribute('aria-pressed', 'true');
    await screenshot(page, '01-idle-zone-lit.png');

    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 30_000 }).toMatchObject({ visible: true, ray: true, hit: true, echo: true });
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.label, { timeout: 30_000 }).toMatch(/^\d{1,3},\d cm$/);
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    await screenshot(page, '02-running-ray-and-label.png');

    // Held still (Tạm dừng), the tag says the very distance the sensor read, to a tenth of a cm.
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng', { timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const reading = ultrasonicOf(await view(frame));
          return (await overlay(frame))?.ultrasonics[0]?.label === (reading?.cm === undefined ? null : tagOf(reading.cm));
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const held = ultrasonicOf(await view(frame));
    expect(held?.hitId).toBe('front-wall');
    expect(held?.cm).toBeGreaterThan(14);
    expect((await overlay(frame))?.ultrasonics[0]?.cm).toBeCloseTo(held!.cm!, 6);
    expect(errors).toEqual([]);
  });

  test('"Hiện cảm biến" takes the overlays off and brings them back with the reading, and a click on it asks for a frame', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.ray, { timeout: 30_000 }).toBe(true);
    await frame.getByTestId('robot-pause').click();
    const toggle = frame.getByTestId('robot-sensors');
    await expect(toggle).toHaveAttribute('aria-label', 'Hiện cảm biến');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // The scene was asked for a frame though nothing else moves: the overlay is gone.
    await expect.poll(async () => (await overlay(frame))?.shown, { timeout: 30_000 }).toBe(false);
    expect((await overlay(frame))?.ultrasonics[0]).toMatchObject({ visible: false, ray: false, hit: false });
    await screenshot(page, '03-sensors-off.png');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 30_000 }).toMatchObject({ visible: true, ray: true, hit: true });
    expect((await overlay(frame))?.ultrasonics[0]?.label).toMatch(/^\d+,\d cm$/);
  });

  test('they stay on in a check at 1× and at 4×, and in Xem lại', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('crash-and-back-off'));
    const shownInCheck = async () => {
      await expect(frame.getByTestId('robot-check-round')).toHaveText('Lượt 1/3');
      await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 60_000 }).toMatchObject({ visible: true, ray: true, hit: true });
      expect((await overlay(frame))?.shown).toBe(true);
    };
    // Kiểm tra at 1×: the run is in the view with its overlays (the learner can switch them off there, too: the switch is not in the tools).
    await frame.locator('[data-testid=robot-check-speed] [data-speed="1x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await shownInCheck();
    await expect(frame.getByTestId('robot-sensors')).toBeVisible();
    await screenshot(page, '04-check-1x.png');
    await frame.getByTestId('robot-check-cancel').click();
    await expect(frame.getByTestId('robot-check-start')).toBeVisible({ timeout: 30_000 });
    // At 4×, to its result.
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await shownInCheck();
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 150_000 });
    // Xem lại: the round again at 1×.
    await frame.getByTestId('robot-check-replay-2').click();
    await expect(frame.getByTestId('robot-round')).toHaveText('Lượt 2/3');
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 60_000 }).toMatchObject({ visible: true, ray: true, hit: true });
    await screenshot(page, '05-replay.png');
    expect(errors).toEqual([]);
  });

  test('the goal’s zone pulses while a run goes on, and stands still with reduced motion', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    const levels = new Set<number>();
    await expect
      .poll(
        async () => {
          const probe = await overlay(frame);
          if (probe?.zone === 'stop-zone') levels.add(Math.round(probe.pulse * 100));
          return levels.size;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(3);
  });

  test('with reduced motion the zone does not pulse', async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1.5);
    const levels = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const probe = await overlay(frame);
      expect(probe?.zone).toBe('stop-zone');
      levels.add(probe!.pulse);
      await page.waitForTimeout(100);
    }
    expect([...levels]).toEqual([0.5]);
  });

  test('a robot at rest draws no frame for the overlays: they ask for one only when their picture changes', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.evaluate(() => {
      // Counts the canvas's draws to the screen: three clears WebGL's default framebuffer once per render.
      const gl = (document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement).getContext('webgl2')!;
      const counter = window as unknown as { __draws: number };
      counter.__draws = 0;
      const clear = gl.clear.bind(gl);
      gl.clear = (mask: number) => {
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) counter.__draws += 1;
        clear(mask);
      };
    });
    const draws = () => frame.evaluate(() => (window as unknown as { __draws: number }).__draws);
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.ray, { timeout: 30_000 }).toBe(true);
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng', { timeout: 30_000 });
    // Held still, the scene draws nothing more: the pulse and the overlays make no frames of their own.
    await page.waitForTimeout(1200);
    const rested = await draws();
    await page.waitForTimeout(1500);
    expect(await draws()).toBe(rested);
    // The switch is one frame, and then rest again.
    await frame.getByTestId('robot-sensors').click();
    await expect.poll(draws, { timeout: 30_000 }).toBeGreaterThan(rested);
    // The frame the switch asked for may come in more than one draw, the second a moment after the first when the machine is busy: the count
    // is read once it has stopped changing, and then it must stay.
    const after = await settled(draws);
    await page.waitForTimeout(1200);
    expect(await draws()).toBe(after);
  });

  test('line-follow: a spot on the mat under each eye, a red disc where it reads dark, from the free view and from behind the robot', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'template=rb-line-follow'));
    await expect.poll(async () => (await overlay(frame))?.zone, { timeout: 30_000 }).toBe('garage');
    const line = { ...robotStarterDocument('rb-line-follow'), program: { blocks: robotSolutions['rb-line-follow'].reference } };
    await frame.evaluate((document) => window.__stem?.loadProject(document), line);
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1.5);
    // Each eye has a spot on the mat, and, over the run, each has read dark (the tape) and bright (the mat).
    const seen = { dark: new Set<string>(), bright: new Set<string>() };
    await expect
      .poll(
        async () => {
          const spots = (await overlay(frame))?.spots ?? [];
          expect(spots.map((spot) => spot.role)).toEqual(['lineLeft', 'lineCenter', 'lineRight']);
          for (const spot of spots) if (spot.visible) (spot.dark ? seen.dark : seen.bright).add(spot.role);
          return seen.dark.size > 0 && seen.bright.size > 0;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await screenshot(page, '07-line-follow-free.png');
    await frame.locator('[data-testid=robot-camera] [data-mode=follow]').click();
    await page.waitForTimeout(800);
    await screenshot(page, '08-line-follow-behind.png');
    expect(errors).toEqual([]);
  });

  test('the ray is on the canvas: pixels of the beam’s blue appear beside the robot with the overlays on and go with the switch', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.ray, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng', { timeout: 30_000 });
    // The drawing buffer of every draw to the screen, read after its draw calls (before it is composited), and its pixels counted that are
    // clearly blue: the blue is far over the red (the beam's #0284c7 and its softer edges; the robot has a few blue parts, which are in
    // both counts, so the two are compared).
    await frame.evaluate(() => {
      const canvas = document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2')!;
      const seen = ((window as unknown as { __blue: { draws: number; blue: number } }).__blue = { draws: 0, blue: -1 });
      const clear = gl.clear.bind(gl);
      gl.clear = (mask: number) => {
        clear(mask);
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null) return;
        queueMicrotask(() => {
          const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
          gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let blue = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2]! >= 150 && pixels[i + 2]! - pixels[i]! >= 90) blue += 1;
          seen.blue = blue;
          seen.draws += 1;
        });
      };
    });
    const seen = () => frame.evaluate(() => (window as unknown as { __blue: { draws: number; blue: number } }).__blue);
    const drawFrame = async (change: () => Promise<void>) => {
      const before = (await seen()).draws;
      await change();
      await expect.poll(async () => (await seen()).draws, { timeout: 30_000 }).toBeGreaterThan(before);
      // The last draw of the frames the change asked for.
      return (await settled(seen)).blue;
    };
    const toggle = frame.getByTestId('robot-sensors');
    const off = await drawFrame(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
    const on = await drawFrame(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    });
    expect(off).toBeGreaterThanOrEqual(0);
    // The ray (a few px wide, 80 cm long), its edges and its tag's border: well over a hundred more pixels.
    expect(on - off).toBeGreaterThan(100);
    const offAgain = await drawFrame(async () => {
      await toggle.click();
    });
    expect(Math.abs(offAgain - off)).toBeLessThan(30);
  });

  test('a run that goes on with the robot at rest draws no frame: the pulse is no frame of its own, and the tag settles to the exact reading', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.evaluate(() => {
      const gl = (document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement).getContext('webgl2')!;
      (window as unknown as { __draws: number }).__draws = 0;
      const clear = gl.clear.bind(gl);
      gl.clear = (mask: number) => {
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) (window as unknown as { __draws: number }).__draws += 1;
        clear(mask);
      };
    });
    const draws = () => frame.evaluate(() => (window as unknown as { __draws: number }).__draws);
    await frame.getByTestId('robot-run').click();
    // The reference drives up to the wall and stops 15 cm from it, in the zone; its goal then passes after the hold, and the zone's glow goes.
    await expect.poll(async () => (await overlay(frame))?.zone, { timeout: 30_000 }).toBeNull();
    // Still running: the program loops for ever, the clock goes on, the robot stands.
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy', { timeout: 30_000 });
    // The overlays have settled (the tag, once, by the loop stopping) and nothing else asks for a frame.
    await page.waitForTimeout(1500);
    const rested = await draws();
    const restedAt = await frame.getByTestId('robot-time').textContent();
    await page.waitForTimeout(2500);
    expect(await draws()).toBe(rested);
    expect(await frame.getByTestId('robot-time').textContent()).not.toBe(restedAt);
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy', { timeout: 30_000 });
    // And the tag says the reading to a tenth: it settled to it.
    const reading = ultrasonicOf(await view(frame));
    expect((await overlay(frame))?.ultrasonics[0]?.label).toBe(tagOf(reading!.cm!));
  });

  test('no shader program is compiled once the scene is up: the overlays’ is compiled with it, before the first frame', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    // Counts the programs the page links, in every frame, from before the canvas is made.
    await page.addInitScript(() => {
      const w = window as unknown as { __links: number };
      w.__links = 0;
      for (const context of [WebGL2RenderingContext, WebGLRenderingContext]) {
        const link = context.prototype.linkProgram;
        context.prototype.linkProgram = function (this: WebGLRenderingContext, program: WebGLProgram) {
          w.__links += 1;
          link.call(this, program);
        };
      }
    });
    const frame = await openInLesson(page, labUrl(baseURL, 'template=rb-line-follow'));
    const links = () => frame.evaluate(() => (window as unknown as { __links: number }).__links);
    // The zones' tags come one frame after the first, and the lab settles in a second.
    await page.waitForTimeout(1500);
    const before = await links();
    expect(before).toBeGreaterThan(3);
    const line = { ...robotStarterDocument('rb-line-follow'), program: { blocks: robotSolutions['rb-line-follow'].reference } };
    await frame.evaluate((document) => window.__stem?.loadProject(document), line);
    await frame.getByTestId('robot-run').click();
    // The beam, the tag, the spots (dark and bright) and the zone all show; none needs a new program.
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.ray, { timeout: 30_000 }).toBe(true);
    const seen = { dark: false, bright: false };
    await expect
      .poll(
        async () => {
          for (const spot of (await overlay(frame))?.spots ?? []) if (spot.visible) seen[spot.dark ? 'dark' : 'bright'] = true;
          return seen.dark && seen.bright;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect.poll(async () => (await overlay(frame))?.zone, { timeout: 30_000 }).toBe('garage');
    await page.waitForTimeout(500);
    expect(await links()).toBe(before);
  });

  test('the switch has a hit area of 44 px in the camera’s panel and over the 2D map: a point 21 px from its middle, every way, is its own', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    // In the frame's own coordinates: the middle of the button, and what is found 21 px up, down, left and right of it.
    const reach = () =>
      frame.evaluate(() => {
        const button = document.querySelector('[data-testid=robot-sensors]')!;
        const box = button.getBoundingClientRect();
        const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
        const own = (px: number, py: number) => document.elementFromPoint(px, py)?.closest('[data-testid=robot-sensors]') === button;
        return { width: box.width, height: box.height, middle: own(x, y), up: own(x, y - 21), down: own(x, y + 21), left: own(x - 21, y), right: own(x + 21, y) };
      });
    // The camera panel's button is 28 px tall and 44 wide; its hit area reaches 8 px above and below.
    const inCamera = await reach();
    expect(inCamera.width).toBeGreaterThanOrEqual(44);
    expect(inCamera.height).toBeLessThan(44);
    expect(inCamera).toMatchObject({ middle: true, up: true, down: true, left: true, right: true });
    // Over the 2D map it is a panel of 44 × 44.
    await frame.getByTestId('robot-viewmode').click();
    await frame.getByTestId('robot-topview').waitFor();
    const onMap = await reach();
    expect(onMap.width).toBeGreaterThanOrEqual(44);
    expect(onMap.height).toBeGreaterThanOrEqual(44);
    expect(onMap).toMatchObject({ middle: true, up: true, down: true, left: true, right: true });
  });

  test('on the detailed graphics tier the overlays are drawn too', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    // SwiftShader starts the lab on the light tier; the quality button gives it the detailed one, with a new canvas.
    expect(await frame.getByTestId('robot-canvas').getAttribute('data-tier')).toBe('low');
    await frame.getByTestId('robot-quality').click();
    await expect(frame.getByTestId('robot-canvas')).toHaveAttribute('data-tier', 'high');
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 30_000 });
    await expect.poll(async () => (await overlay(frame))?.zone, { timeout: 60_000 }).toBe('stop-zone');
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 30_000 }).toMatchObject({ visible: true, ray: true, hit: true });
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1.5);
    await screenshot(page, '09-high-tier.png');
    expect(errors).toEqual([]);
  });

  test('the 2D map (Xem 2D) has the cone, the tag, the spots and the zone, and the same switch', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'template=rb-line-follow'));
    await frame.getByTestId('robot-viewmode').click();
    await frame.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await mapOverlay(frame))?.zone, { timeout: 30_000 }).toBe('garage');
    const line = { ...robotStarterDocument('rb-line-follow'), program: { blocks: robotSolutions['rb-line-follow'].reference } };
    await frame.evaluate((document) => window.__stem?.loadProject(document), line);
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await mapOverlay(frame))?.cones[0]?.visible, { timeout: 30_000 }).toBe(true);
    const drawn = (await mapOverlay(frame))!;
    expect(drawn.labels[0]?.text).toMatch(/^\d+(,\d)? cm$/);
    expect(drawn.spots.some((spot) => spot.visible)).toBe(true);
    await screenshot(page, '06-map-2d.png');
    await frame.getByTestId('robot-sensors').click();
    await expect.poll(async () => (await mapOverlay(frame))?.shown, { timeout: 30_000 }).toBe(false);
    await frame.getByTestId('robot-sensors').click();
    await expect.poll(async () => (await mapOverlay(frame))?.shown, { timeout: 30_000 }).toBe(true);
    expect(errors).toEqual([]);
  });
});
