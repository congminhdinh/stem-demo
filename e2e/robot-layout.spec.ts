import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import { pinLowTierChainOff } from './robot-chain';
import { basicSkip } from '../tests/basic-skip';

// N18 R4.6: where the robot lab puts things in its two frames: 1100 x 640, the size of the frame a lesson page gives it (the design size),
// and 760 px, a frame narrower than 800 px, where its two sides are tabs. In both, the view (3D or the 2D map that takes its place) is
// about 60 % of the width, the program is beside it with its three tabs, the header holds its run controls without crowding the title,
// and nothing scrolls. The 3D scene is drawn by software WebGL (SwiftShader) so that it renders the same on every machine. Screenshots go
// to R46_SHOTS_DIR (the report's), or under test-results.

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R46_SHOTS_DIR ?? join('test-results', 'robot-layout');

type Box = { x: number; y: number; width: number; height: number };

const labUrl = (baseURL: string | undefined, template = 'rb-line-follow') => new URL(`/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

/**
 * Loads the module that reads what the 2D map drew (src/ui/robot3d/top-view-state.ts) from the dev server, which serves the instance the
 * lab runs on, and keeps its reader on the page: `topView` then reads in one turn of the page (`both`: with the world, no frame between).
 */
async function installTopViewReader(target: Page | Frame) {
  await target.evaluate(async () => {
    const path = '/src/ui/robot3d/top-view-state.ts';
    const module = (await import(/* @vite-ignore */ path)) as { readTopViewState(): unknown };
    (window as unknown as { __readTopView(): unknown }).__readTopView = module.readTopViewState;
  });
}

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.getByTestId('robot-lab').waitFor();
  await installTopViewReader(frame);
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await pinLowTierChainOff(frame);
  return frame;
}

/** The box of an element in its own frame's coordinates (the lesson page puts a border and an offset around the frame). */
const box = (target: Page | Frame, selector: string): Promise<Box> =>
  target.locator(selector).first().evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });

/** Whether the page scrolls sideways or down (a lab never does either). */
const scrolls = (target: Page | Frame) =>
  target.evaluate(() => {
    const page = document.scrollingElement;
    return page === null ? null : { sideways: page.scrollWidth > page.clientWidth, down: page.scrollHeight > page.clientHeight };
  });

type TopViewShape = { stage: { width: number; height: number }; scale: number; robot: { xCm: number } | null };
const topView = (target: Page | Frame) => target.evaluate(() => (window as unknown as { __readTopView(): TopViewShape | null }).__readTopView());

const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
/** Whether `inner` lies inside `outer` (a pixel of slack for sub-pixel layout). */
const within = (inner: Box, outer: Box) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && right(inner) <= right(outer) + 1 && bottom(inner) <= bottom(outer) + 1;
/** Whether two boxes share any area. */
const overlap = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** The robot lab's parts in a split layout: the view on the left (about 60 %), the program with its tabs on the right, the header above. */
async function expectSplitLayout(frame: Frame, width: number, height: number) {
  expect(await frame.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height]);
  await expect(frame.getByTestId('lab-workspace')).toHaveAttribute('data-layout', 'split');
  const [header, viewport, program, stage, dock, title, controls] = await Promise.all([
    box(frame, '.robot-header'),
    box(frame, '[data-testid=robot-viewport]'),
    box(frame, '[data-testid=program-region]'),
    box(frame, '.robot-stage'),
    box(frame, '.robot-dock'),
    box(frame, '.robot-header h1'),
    box(frame, '[data-testid=robot-controls]'),
  ]);
  // The view takes about 60 % of the width, and the program is beside it, to its right.
  expect(viewport.x).toBe(0);
  expect(viewport.width / width).toBeGreaterThan(0.55);
  expect(viewport.width / width).toBeLessThan(0.65);
  expect(program.x).toBeGreaterThanOrEqual(right(viewport));
  expect(right(program)).toBeLessThanOrEqual(width + 1);
  expect(program.width).toBeGreaterThan(380);
  // Both start under the header and end at the bottom of the frame; the dock is under the stage inside the view.
  expect(viewport.y).toBeGreaterThanOrEqual(bottom(header) - 1);
  expect(program.y).toBeGreaterThanOrEqual(bottom(header) - 1);
  expect(bottom(viewport)).toBeLessThanOrEqual(height + 1);
  expect(bottom(program)).toBeLessThanOrEqual(height + 1);
  expect(stage.height).toBeGreaterThan(300);
  expect(dock.y).toBeGreaterThanOrEqual(bottom(stage) - 1);
  expect(within(dock, viewport)).toBe(true);
  // The program's three tabs are on the right, Khối lệnh chosen.
  const tabs = frame.locator('.robot-program-tabs [role=tab]');
  await expect(tabs).toHaveText(['Khối lệnh', 'C++', 'Cổng & chân']);
  await expect(frame.getByRole('tab', { name: 'Khối lệnh' })).toHaveAttribute('aria-selected', 'true');
  for (const tab of await tabs.all()) {
    const at = await tab.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    expect(within(at, program)).toBe(true);
  }
  // The header is one row: the run controls sit at its right, beside the title and the scenario's name and not under or over them.
  expect(header.height).toBeLessThan(64);
  expect(within(controls, header)).toBe(true);
  expect(controls.x).toBeGreaterThan(right(title));
  expect(overlap(controls, await box(frame, '[data-testid=robot-scenario]'))).toBe(false);
  expect(right(controls)).toBeLessThanOrEqual(width);
  // The HUD floats at the top left of the stage, the camera's views (3D) at its top right, never over each other.
  const hud = await box(frame, '[data-testid=robot-hud]');
  expect(within(hud, stage)).toBe(true);
  expect(hud.x - stage.x).toBeLessThan(16);
  expect(hud.y - stage.y).toBeLessThan(16);
  expect(await scrolls(frame)).toEqual({ sideways: false, down: false });
}

// N18 bt-lab-fix: under a suite's load SwiftShader draws a run slowly (at most 8 ticks a drawn frame), so the waits in this file are for a
// condition, not for a time, and a test's own limit is for a hang, not for a busy machine.
test.describe.configure({ timeout: 120_000 });

test.describe('the robot lab at 1100 x 640, the size of a lesson’s frame (N18 R4.6)', () => {
  test('puts the 3D view at about 60 % with the program and its three tabs beside it, the camera over the view, and nothing scrolls', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the C++ and Cổng & chân tabs (robot-lab-basic.spec.ts has its layout)');
    const frame = await openInLesson(page, labUrl(baseURL));
    await expectSplitLayout(frame, 1100, 640);
    const [stage, camera, hud] = await Promise.all([box(frame, '.robot-stage'), box(frame, '[data-testid=robot-camera]'), box(frame, '[data-testid=robot-hud]')]);
    expect(within(camera, stage)).toBe(true);
    expect(right(stage) - right(camera)).toBeLessThan(16);
    expect(camera.y - stage.y).toBeLessThan(16);
    expect(overlap(camera, hud)).toBe(false);
    // The canvas fills the stage.
    const canvas = await box(frame, '[data-testid=robot-canvas]');
    expect(canvas.width).toBeCloseTo(stage.width, 0);
    expect(canvas.height).toBeCloseTo(stage.height, 0);
    await screenshot(page, 'layout-3d-1100x640.png');
  });

  test('keeps the same layout when the 2D map takes the 3D view’s place: it fills the stage, with its scale bar and its note inside it', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the C++ and Cổng & chân tabs');
    const frame = await openInLesson(page, labUrl(baseURL));
    const before = await Promise.all([box(frame, '[data-testid=robot-viewport]'), box(frame, '[data-testid=program-region]')]);
    await frame.getByTestId('robot-viewmode').click();
    await expect(frame.getByTestId('robot-topview')).toBeVisible();
    await expectSplitLayout(frame, 1100, 640);
    // The view and the program are where they were; the view's own controls are not there, and the view button is.
    const after = await Promise.all([box(frame, '[data-testid=robot-viewport]'), box(frame, '[data-testid=program-region]')]);
    expect(after).toEqual(before);
    await expect(frame.getByTestId('robot-camera')).toBeHidden();
    const [viewport, fallback, map, button] = await Promise.all([
      box(frame, '[data-testid=robot-viewport]'),
      box(frame, '[data-testid=robot-fallback]'),
      box(frame, '[data-testid=robot-topview]'),
      box(frame, '[data-testid=robot-viewmode]'),
    ]);
    expect(within(fallback, viewport)).toBe(true);
    expect(within(map, fallback)).toBe(true);
    expect(within(button, fallback)).toBe(true);
    // The stage of Konva is the map's size: nothing of the arena is cut and nothing is left over.
    const state = await topView(frame);
    expect(state?.stage.width).toBeCloseTo(map.width, 0);
    expect(state?.stage.height).toBeCloseTo(map.height, 0);
    // 170 x 140 cm, in the room the map's margins leave.
    expect(state!.scale * 170).toBeLessThanOrEqual(map.width - 28 + 0.01);
    expect(state!.scale * 140).toBeLessThanOrEqual(map.height - 54 + 0.01);
    // The separator moves the share and the map follows it.
    await frame.getByTestId('lab-separator').focus();
    await frame.getByTestId('lab-separator').press('ArrowLeft');
    await expect.poll(async () => (await box(frame, '[data-testid=robot-viewport]')).width).toBeLessThan(before[0].width - 40);
    const narrower = await box(frame, '[data-testid=robot-topview]');
    await expect.poll(async () => (await topView(frame))?.stage.width).toBeCloseTo(narrower.width, 0);
    expect(await scrolls(frame)).toEqual({ sideways: false, down: false });
    await screenshot(page, 'layout-2d-1100x640.png');
  });

  test('keeps the header on one row with a run in progress, the HUD’s goals open and a long scenario name', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'rb-mini-mission (robot-lab-basic.spec.ts has its header on one row)');
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-mini-mission'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), { ...robotStarterDocument('rb-line-follow'), program: { blocks: robotSolutions['rb-line-follow'].reference } });
    const idle = await box(frame, '.robot-header');
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy', { timeout: 30_000 });
    const running = await box(frame, '.robot-header');
    expect(running.height).toBe(idle.height);
    expect(running.height).toBeLessThan(64);
    expect(await scrolls(frame)).toEqual({ sideways: false, down: false });
  });
});

test.describe('the robot lab at 760 px, narrower than 800 (N18 R4.6)', () => {
  test.use({ viewport: { width: 760, height: 640 } });

  async function openNarrow(page: Page) {
    await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');
    await pinLowTierChainOff(page);
    await installTopViewReader(page);
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ state: 'attached', timeout: 60_000 });
  }

  test('shows one side at a time in two tabs: Chương trình first, and the robot’s tab, 3D view over the whole width, once Chạy is pressed', async ({ page }) => {
    await openNarrow(page);
    await expect(page.getByTestId('lab-workspace')).toHaveAttribute('data-layout', 'tabs');
    await expect(page.locator('.lab-tabs [role=tab]')).toHaveText(['Chương trình', 'Robot']);
    await expect(page.getByRole('tab', { name: 'Chương trình', exact: true })).toHaveAttribute('aria-selected', 'true');
    // The program fills the width; the robot's side is out of sight and takes no room.
    const program = await box(page, '[data-testid=program-region]');
    expect(program.x).toBeLessThan(2);
    expect(program.width).toBeGreaterThan(740);
    await expect(page.getByTestId('robot-viewport')).toBeHidden();
    // The header wraps its controls onto a row of their own, and that is all it does.
    const header = await box(page, '.robot-header');
    const controls = await box(page, '[data-testid=robot-controls]');
    expect(within(controls, header)).toBe(true);
    expect(controls.y).toBeGreaterThan((await box(page, '.robot-header h1')).y + 10);
    expect(right(controls)).toBeLessThanOrEqual(760);
    expect(header.height).toBeLessThan(120);
    expect(await scrolls(page)).toEqual({ sideways: false, down: false });
    await screenshot(page, 'layout-program-tab-760.png');

    await page.evaluate((document) => window.__stem?.loadProject(document), { ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });
    await page.getByTestId('robot-run').click();
    await expect(page.getByRole('tab', { name: 'Robot', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('robot-status')).toHaveText('Đang chạy', { timeout: 30_000 });
    const viewport = await box(page, '[data-testid=robot-viewport]');
    const stage = await box(page, '.robot-stage');
    expect(viewport.x).toBeLessThan(2);
    expect(viewport.width).toBeGreaterThan(740);
    expect(right(viewport)).toBeLessThanOrEqual(760);
    expect(bottom(viewport)).toBeLessThanOrEqual(640 + 1);
    expect(stage.height).toBeGreaterThan(250);
    const canvas = await box(page, '[data-testid=robot-canvas]');
    expect(canvas.width).toBeCloseTo(stage.width, 0);
    expect(canvas.height).toBeCloseTo(stage.height, 0);
    // The camera's buttons are icons only in a view this narrow, and the HUD leaves them room.
    const [hud, camera] = await Promise.all([box(page, '[data-testid=robot-hud]'), box(page, '[data-testid=robot-camera]')]);
    expect(overlap(hud, camera)).toBe(false);
    expect(within(camera, stage)).toBe(true);
    expect(await scrolls(page)).toEqual({ sideways: false, down: false });
    await screenshot(page, 'layout-robot-tab-3d-760.png');
  });

  test('draws the 2D map over the width of the robot tab, scaled to fit, with the run going on', async ({ page }) => {
    await openNarrow(page);
    await page.evaluate((document) => window.__stem?.loadProject(document), { ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });
    await page.getByTestId('robot-run').click();
    await expect(page.getByRole('tab', { name: 'Robot', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('robot-viewmode').click();
    await expect(page.getByTestId('robot-topview')).toBeVisible();
    const [viewport, map, note] = await Promise.all([box(page, '[data-testid=robot-viewport]'), box(page, '[data-testid=robot-topview]'), box(page, '.robot-header')]);
    expect(map.width).toBeCloseTo(viewport.width, 0);
    expect(within(map, viewport)).toBe(true);
    expect(note.height).toBeLessThan(120);
    const state = await topView(page);
    expect(state?.stage.width).toBeCloseTo(map.width, 0);
    // 160 cm of arena across the room the margins leave.
    expect(state!.scale * 160).toBeLessThanOrEqual(map.width - 28 + 0.01);
    await expect.poll(async () => (await topView(page))?.robot?.xCm ?? 0, { timeout: 60_000 }).toBeGreaterThan(32);
    expect(await scrolls(page)).toEqual({ sideways: false, down: false });
    // Back to the program tab and the map's side is out of sight, and still drawing its stage at the size it had.
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click();
    await expect(page.getByTestId('robot-topview')).toBeHidden();
    await page.getByRole('tab', { name: 'Robot', exact: true }).click();
    await expect(page.getByTestId('robot-topview')).toBeVisible();
    expect((await topView(page))?.stage.width).toBeCloseTo(map.width, 0);
    await screenshot(page, 'layout-robot-tab-2d-760.png');
  });
});

test.describe('a frame that changes size under the 2D map (N18 R4.6 fix round 1)', () => {
  test('shrinks the map’s stage with a shorter and a narrower frame, and grows it with a larger one, never scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 640 });
    await page.goto('/?embed=1&lab=robot&template=rb-line-follow');
    await pinLowTierChainOff(page);
    await installTopViewReader(page);
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ state: 'attached', timeout: 60_000 });
    await page.getByTestId('robot-viewmode').click();
    await expect(page.getByTestId('robot-topview')).toBeVisible();
    const stageIsItsContainer = async () => {
      const [map, state] = await Promise.all([box(page, '[data-testid=robot-topview]'), topView(page)]);
      expect(state?.stage.width).toBeCloseTo(map.width, 0);
      expect(state?.stage.height).toBeCloseTo(map.height, 0);
      return { map, state: state! };
    };
    const first = await stageIsItsContainer();
    for (const [width, height] of [
      [1100, 500],
      [900, 500],
      [1100, 700],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => (await topView(page))?.stage.height).toBeCloseTo((await box(page, '[data-testid=robot-topview]')).height, 0);
      const now = await stageIsItsContainer();
      expect(await scrolls(page)).toEqual({ sideways: false, down: false });
      if (height === 500 && width === 1100) expect(now.map.height).toBeLessThan(first.map.height);
      if (height === 700) expect(now.map.height).toBeGreaterThan(first.map.height);
    }
  });
});

test.describe('where the robot lab turns to tabs (N18 R4.6)', () => {
  for (const [width, layout] of [
    [800, 'split'],
    [799, 'tabs'],
  ] as const) {
    test(`at ${width} px it is ${layout === 'split' ? 'side by side' : 'in tabs'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');
      await pinLowTierChainOff(page);
      await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ state: 'attached', timeout: 60_000 });
      await expect(page.getByTestId('lab-workspace')).toHaveAttribute('data-layout', layout);
      expect(await scrolls(page)).toEqual({ sideways: false, down: false });
    });
  }
});
