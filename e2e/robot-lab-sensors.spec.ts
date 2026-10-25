import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import type { TopViewSensorsState } from '../src/ui/robot3d/top-view-sensors-state';
import type { SensorOverlayProbe } from '../src/ui/robot3d/parts/sensor-overlay';

// N18 R4.3: the robot lab's sensor overlays in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts, project
// chromium-robot). In stop-at-wall, the goal's zone is lit before the run; once it runs the ultrasonic ray, its echo dot and its tag with the
// distance in cm (the comma) appear and match the sensor's reading; "Hiện cảm biến" takes them off and brings them back; they show in a
// check at 1× and in Xem lại; the zone's glow pulses while a run goes on and stands still with reduced motion; a robot at rest draws no
// frame for them; and the 2D map ("Xem 2D") has the same. Screenshots go to R43_SHOTS_DIR (the report's), or under test-results.

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
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 15_000 });
  await expect(frame.getByTestId('robot-3d-loading')).toHaveCount(0);
  // The overlay's state reader and the map's: the very instances the lab runs on, from the dev server.
  await frame.evaluate(async () => {
    const overlay = '/src/ui/robot3d/sensor-overlay-state.ts';
    const map = '/src/ui/robot3d/top-view-sensors-state.ts';
    const w = window as unknown as { __sensorOverlay: unknown; __topViewSensors: unknown };
    w.__sensorOverlay = await import(/* @vite-ignore */ overlay);
    w.__topViewSensors = await import(/* @vite-ignore */ map);
  });
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

test.describe('the sensor overlays in the robot lab (N18 R4.3)', () => {
  test('stop-at-wall: the goal’s zone is lit before the run, then the ray, its echo and its tag in cm appear and match the reading', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    // Before a run: the zone the goal needs, and no beam (nothing has been read yet).
    await expect.poll(async () => (await overlay(frame))?.zone).toBe('stop-zone');
    expect((await overlay(frame))?.ultrasonics[0]).toMatchObject({ role: 'ultrasonic', visible: false, label: null });
    await expect(frame.getByTestId('robot-sensors')).toHaveAttribute('aria-pressed', 'true');
    await screenshot(page, '01-idle-zone-lit.png');

    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]).toMatchObject({ visible: true, ray: true, hit: true, echo: true });
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.label).toMatch(/^\d{1,3},\d cm$/);
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(1);
    await screenshot(page, '02-running-ray-and-label.png');

    // Held still (Tạm dừng), the tag says the very distance the sensor read, to a tenth of a cm.
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');
    await expect
      .poll(async () => {
        const reading = ultrasonicOf(await view(frame));
        return (await overlay(frame))?.ultrasonics[0]?.label === (reading?.cm === undefined ? null : tagOf(reading.cm));
      })
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
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.ray).toBe(true);
    await frame.getByTestId('robot-pause').click();
    const toggle = frame.getByTestId('robot-sensors');
    await expect(toggle).toHaveAttribute('aria-label', 'Hiện cảm biến');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // The scene was asked for a frame though nothing else moves: the overlay is gone.
    await expect.poll(async () => (await overlay(frame))?.shown).toBe(false);
    expect((await overlay(frame))?.ultrasonics[0]).toMatchObject({ visible: false, ray: false, hit: false });
    await screenshot(page, '03-sensors-off.png');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]).toMatchObject({ visible: true, ray: true, hit: true });
    expect((await overlay(frame))?.ultrasonics[0]?.label).toMatch(/^\d+,\d cm$/);
  });

  test('they stay on in a check at 1× and at 4×, and in Xem lại', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('crash-and-back-off'));
    const shownInCheck = async () => {
      await expect(frame.getByTestId('robot-check-round')).toHaveText('Lượt 1/3');
      await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 20_000 }).toMatchObject({ visible: true, ray: true, hit: true });
      expect((await overlay(frame))?.shown).toBe(true);
    };
    // Kiểm tra at 1×: the run is in the view with its overlays (the learner can switch them off there, too: the switch is not in the tools).
    await frame.locator('[data-testid=robot-check-speed] [data-speed="1x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await shownInCheck();
    await expect(frame.getByTestId('robot-sensors')).toBeVisible();
    await screenshot(page, '04-check-1x.png');
    await frame.getByTestId('robot-check-cancel').click();
    await expect(frame.getByTestId('robot-check-start')).toBeVisible();
    // At 4×, to its result.
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await shownInCheck();
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    // Xem lại: the round again at 1×.
    await frame.getByTestId('robot-check-replay-2').click();
    await expect(frame.getByTestId('robot-round')).toHaveText('Lượt 2/3');
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0], { timeout: 20_000 }).toMatchObject({ visible: true, ray: true, hit: true });
    await screenshot(page, '05-replay.png');
    expect(errors).toEqual([]);
  });

  test('the goal’s zone pulses while a run goes on, and stands still with reduced motion', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    const levels = new Set<number>();
    await expect
      .poll(async () => {
        const probe = await overlay(frame);
        if (probe?.zone === 'stop-zone') levels.add(Math.round(probe.pulse * 100));
        return levels.size;
      })
      .toBeGreaterThan(3);
  });

  test('with reduced motion the zone does not pulse', async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('reference'));
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(1.5);
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
    await expect.poll(async () => (await overlay(frame))?.ultrasonics[0]?.ray).toBe(true);
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');
    // Held still, the scene draws nothing more: the pulse and the overlays make no frames of their own.
    await page.waitForTimeout(1200);
    const rested = await draws();
    await page.waitForTimeout(1500);
    expect(await draws()).toBe(rested);
    // The switch is one frame, and then rest again.
    await frame.getByTestId('robot-sensors').click();
    await expect.poll(draws).toBeGreaterThan(rested);
    const after = await draws();
    await page.waitForTimeout(1200);
    expect(await draws()).toBe(after);
  });

  test('line-follow: a spot on the mat under each eye, a red disc where it reads dark, from the free view and from behind the robot', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'template=rb-line-follow'));
    await expect.poll(async () => (await overlay(frame))?.zone).toBe('garage');
    const line = { ...robotStarterDocument('rb-line-follow'), program: { blocks: robotSolutions['rb-line-follow'].reference } };
    await frame.evaluate((document) => window.__stem?.loadProject(document), line);
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await view(frame))?.t ?? 0).toBeGreaterThan(1.5);
    // Each eye has a spot on the mat, and, over the run, each has read dark (the tape) and bright (the mat).
    const seen = { dark: new Set<string>(), bright: new Set<string>() };
    await expect
      .poll(async () => {
        const spots = (await overlay(frame))?.spots ?? [];
        expect(spots.map((spot) => spot.role)).toEqual(['lineLeft', 'lineCenter', 'lineRight']);
        for (const spot of spots) if (spot.visible) (spot.dark ? seen.dark : seen.bright).add(spot.role);
        return seen.dark.size > 0 && seen.bright.size > 0;
      })
      .toBe(true);
    await screenshot(page, '07-line-follow-free.png');
    await frame.locator('[data-testid=robot-camera] [data-mode=follow]').click();
    await page.waitForTimeout(800);
    await screenshot(page, '08-line-follow-behind.png');
    expect(errors).toEqual([]);
  });

  test('the 2D map (Xem 2D) has the cone, the tag, the spots and the zone, and the same switch', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'template=rb-line-follow'));
    await frame.getByTestId('robot-viewmode').click();
    await frame.getByTestId('robot-topview').waitFor();
    await expect.poll(async () => (await mapOverlay(frame))?.zone).toBe('garage');
    const line = { ...robotStarterDocument('rb-line-follow'), program: { blocks: robotSolutions['rb-line-follow'].reference } };
    await frame.evaluate((document) => window.__stem?.loadProject(document), line);
    await frame.getByTestId('robot-run').click();
    await expect.poll(async () => (await mapOverlay(frame))?.cones[0]?.visible).toBe(true);
    const drawn = (await mapOverlay(frame))!;
    expect(drawn.labels[0]?.text).toMatch(/^\d+(,\d)? cm$/);
    expect(drawn.spots.some((spot) => spot.visible)).toBe(true);
    await screenshot(page, '06-map-2d.png');
    await frame.getByTestId('robot-sensors').click();
    await expect.poll(async () => (await mapOverlay(frame))?.shown).toBe(false);
    await frame.getByTestId('robot-sensors').click();
    await expect.poll(async () => (await mapOverlay(frame))?.shown).toBe(true);
    expect(errors).toEqual([]);
  });
});
