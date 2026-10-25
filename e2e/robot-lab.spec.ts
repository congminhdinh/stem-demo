import { expect, test, type Frame, type Page } from '@playwright/test';
import { robotStarterDocument } from '../src/samples/robot-templates';

// N18 R4.1: the robot lab (`lab=robot`) in the frame of a lesson page, as the LMS launches it (plan §4.7): its shell renders at the
// design size (1100 x 640), says ready over stem-lab/v1 with `lab: "robot"`, takes a robot project of the host and nothing else.
// The 3D scene, the world and the checks come later (R4.2, R3.x, R6).

const lessonOrigin = 'http://lesson.localhost:5190';

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };

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
  return frame;
}

const messages = (page: Page) => page.evaluate(() => (window as unknown as { __labMessages: Recorded[] }).__labMessages);
const messagesOfType = async (page: Page, type: string) => (await messages(page)).filter((message) => message.data.type === type);
const sendToLab = (page: Page, message: unknown, targetOrigin: string) =>
  page.evaluate(([data, origin]) => (window as unknown as { __sendToLab(m: unknown, o: string): void }).__sendToLab(data, origin), [message, targetOrigin] as const);

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

/** The box of an element in the frame's own coordinates (the lesson page puts a border and an offset around the frame). */
const box = (frame: Frame, testId: string) =>
  frame.getByTestId(testId).evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });

test.describe('a robot lab in a lesson (stem-lab/v1)', () => {
  test('renders its shell in the 1100 x 640 frame and says ready with lab: robot', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const labOrigin = new URL(baseURL ?? '').origin;
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-drive-to-zone&profile=uno-basic&origin=${encodeURIComponent(lessonOrigin)}`));

    // The shell, in Vietnamese: the lab's title, the scenario's, a labelled viewport and the block editor.
    await expect(frame.getByRole('heading', { level: 1, name: 'Robot 3D' })).toBeVisible();
    await expect(frame.getByRole('heading', { level: 2, name: 'Chạy tới vùng đích' })).toBeVisible();
    await expect(frame.getByRole('region', { name: 'Khung nhìn robot' })).toBeVisible();
    await expect(frame.getByRole('region', { name: 'Khung nhìn robot' })).toContainText('Khung nhìn 3D của robot sẽ hiện ở đây.');
    await expect(frame.getByRole('region', { name: 'Chương trình' })).toBeVisible();
    await expect(frame.getByTestId('blockly-panel').locator('svg.blocklySvg')).toBeVisible();
    await expect(frame.getByTestId('robot-loading')).toHaveCount(0);
    // A lab never offers New; the robot has no Run or Check until R4.2 and R6.
    await expect(frame.getByRole('button', { name: 'Mới' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en'); // the lesson page itself
    expect(await frame.evaluate(() => document.documentElement.lang)).toBe('vi');

    // The design size: both parts fit in the frame side by side, and the page does not scroll.
    const viewport = await box(frame, 'robot-viewport');
    const program = await box(frame, 'program-region');
    expect(viewport.width).toBeGreaterThan(400);
    expect(program.width).toBeGreaterThan(400);
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(program.x + 1);
    const [width, height] = await frame.evaluate(() => [window.innerWidth, window.innerHeight]);
    expect(program.x + program.width).toBeLessThanOrEqual(width ?? 0);
    expect(program.y + program.height).toBeLessThanOrEqual(height ?? 0);
    expect(viewport.y + viewport.height).toBeLessThanOrEqual(height ?? 0);
    expect(viewport.height).toBeGreaterThan(400);
    expect(await frame.evaluate(() => [document.scrollingElement?.scrollWidth, document.scrollingElement?.clientWidth, document.scrollingElement?.scrollHeight, document.scrollingElement?.clientHeight])).toEqual([
      width,
      width,
      height,
      height,
    ]);

    // ready: from the lab's origin, with the fields of plan §4.7 and no null.
    await expect.poll(() => messagesOfType(page, 'ready')).toEqual([
      {
        origin: labOrigin,
        data: { protocol: 'stem-lab/v1', type: 'ready', lab: 'robot', template: 'rb-drive-to-zone', profile: 'uno-basic', scenarioVersion: 1, maxScore: 100, goals: [] },
      },
    ]);
    // Opening the template changed nothing: the host is not told of an edit.
    await page.waitForTimeout(1500);
    expect(await messagesOfType(page, 'project-changed')).toEqual([]);
    expect(await messagesOfType(page, 'check-result')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the sandbox says ready without a maxScore; a lab=robot launch with profile=uno-advanced opens that profile', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-sandbox&profile=uno-advanced&origin=${encodeURIComponent(lessonOrigin)}`));
    await expect.poll(async () => (await messagesOfType(page, 'ready')).map((message) => message.data)).toEqual([
      { protocol: 'stem-lab/v1', type: 'ready', lab: 'robot', template: 'rb-sandbox', profile: 'uno-advanced', scenarioVersion: 1, goals: [] },
    ]);
    expect(Object.hasOwn((await messagesOfType(page, 'ready'))[0]?.data ?? {}, 'maxScore')).toBe(false);
    await expect(frame.getByTestId('robot-scenario')).toHaveText('Sân tập tự do');
    expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(robotStarterDocument('rb-sandbox', 'uno-advanced'));
  });

  test('opens the robot project of the host and ignores a generic one', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-square-route&origin=${encodeURIComponent(lessonOrigin)}`));
    await expect.poll(() => messagesOfType(page, 'ready')).toHaveLength(1);
    const template = robotStarterDocument('rb-square-route');
    expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(template);

    // A saved robot project, kit and all, comes back as it was saved.
    const saved = { ...template, id: 'saved-by-the-host', kit: { id: 'ref-uno-rover', version: '0' } };
    await sendToLab(page, { protocol: 'stem-lab/v1', type: 'load-project', document: saved }, new URL(frame.url()).origin);
    await expect.poll(() => frame.evaluate(() => window.__stem?.getProject())).toEqual(saved);

    // A project of another family does not open, and says nothing.
    const generic = { schemaVersion: 1, id: 'generic', name: 'Generic', circuit: { components: [], wires: [] }, program: { blocks: {} } };
    await sendToLab(page, { protocol: 'stem-lab/v1', type: 'load-project', document: generic }, new URL(frame.url()).origin);
    await page.waitForTimeout(500);
    expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(saved);
  });

  test('has the dev-only robot hooks: no snapshot before a run, and a speed to set', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-sandbox'));
    expect(await frame.evaluate(() => window.__stem?.robot.getSnapshot())).toBeNull();
    expect(await frame.evaluate(() => window.__stem?.robot.snapshotHash())).toBeNull();
    expect(await frame.evaluate(() => [window.__stem?.robot.getSpeed(), window.__stem?.robot.setSpeed(2), window.__stem?.robot.getSpeed()])).toEqual([1, undefined, 2]);
  });
});

test.describe('a robot lab on its own', () => {
  test('opens without origin, and in a frame narrower than 800 px the parts share the width', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 640 });
    await page.goto('/?embed=1&lab=robot&template=rb-line-follow');
    await expect(page.getByTestId('robot-lab')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Bám theo vạch kẻ' })).toBeVisible();
    const viewport = await page.getByTestId('robot-viewport').boundingBox();
    const program = await page.getByTestId('program-region').boundingBox();
    expect(viewport?.width).toBeGreaterThan(600);
    expect(program?.width).toBeGreaterThan(600);
  });

  test('speaks English with lang=en', async ({ page }) => {
    await page.goto('/?embed=1&lab=robot&template=rb-square-route&lang=en');
    await expect(page.getByRole('heading', { level: 2, name: 'Drive a square' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Robot view' })).toBeVisible();
  });

  for (const [query, reason] of [
    ['lab=robot&template=rb-unknown', 'Không có mẫu bài "rb-unknown".'],
    ['lab=robot&template=blink', 'Mẫu bài "blink" không mở trong lab=robot.'],
    ['lab=robot&template=rb-sandbox&profile=ybc-basic', 'Không có cấp độ "ybc-basic": dùng uno-basic hoặc uno-advanced.'],
    ['lab=blockly&template=rb-sandbox', 'Mẫu bài "rb-sandbox" không mở trong lab=blockly.'],
  ] as const) {
    test(`shows the error screen, not a project, for ${query}`, async ({ page }) => {
      await page.goto(`/?embed=1&${query}`);
      await expect(page.getByTestId('launch-error')).toBeVisible();
      await expect(page.getByTestId('launch-error')).toContainText(reason);
      await expect(page.getByTestId('robot-lab')).toHaveCount(0);
      await expect(page.getByTestId('program-region')).toHaveCount(0);
      expect(await page.evaluate(() => window.__stem)).toBeUndefined();
      if (query.startsWith('lab=robot')) {
        await expect(page.getByTestId('launch-error')).toContainText('rb-drive-to-zone, rb-square-route, rb-stop-at-wall, rb-line-follow, rb-servo-gate, rb-mini-mission, rb-sandbox');
      }
    });
  }

  test('the legacy launch (no lab) has no robot scenario: it is the error screen too', async ({ page }) => {
    await page.goto('/?embed=1&template=rb-sandbox');
    await expect(page.getByTestId('launch-error')).toContainText('The template "rb-sandbox" opens only in lab=robot: add lab=robot.');
    await expect(page.getByTestId('robot-lab')).toHaveCount(0);
  });
});

test.describe('a robot lab whose chunk does not load', () => {
  test('says so, with a Reload button, instead of a blank page; one click on Reload brings the lab once the chunk can be fetched', async ({ page }) => {
    // The chunk (in the dev server: the module of the lab) is refused, as a network that failed would.
    await page.route('**/src/ui/robot3d/RobotLab.tsx*', (route) => route.abort());
    await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');

    await expect(page.getByTestId('robot-load-failed')).toBeVisible();
    await expect(page.getByTestId('robot-load-failed')).toHaveText('Không hiện được bài thực hành robot. Hãy kiểm tra kết nối mạng, rồi bấm Tải lại.');
    await expect(page.getByRole('heading', { level: 1, name: 'Robot 3D' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tải lại' })).toBeVisible();
    await expect(page.getByTestId('robot-lab')).toHaveCount(0);

    // The page never reloads by itself: a marker left on it is still there after a while.
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);

    // One click while the chunk still cannot be fetched: Chromium keeps the failed import, so the same click reloads the page (the marker
    // is gone), which fails again the same way and shows the message again.
    await page.getByRole('button', { name: 'Tải lại' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
    await expect(page.getByTestId('robot-load-failed')).toBeVisible();

    // The chunk can be fetched again: ONE click brings the lab.
    await page.unroute('**/src/ui/robot3d/RobotLab.tsx*');
    await page.getByRole('button', { name: 'Tải lại' }).click();
    await expect(page.getByTestId('robot-lab')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Chạy tới vùng đích' })).toBeVisible();
    await expect(page.getByTestId('robot-load-failed')).toHaveCount(0);
  });
});
