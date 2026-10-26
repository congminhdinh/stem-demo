import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import { pinLowTierChainOff } from './robot-chain';

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
  // N18 R4.2 fix round 1: the first frame drawn, not just the canvas element (SwiftShader takes about 2 s to get there).
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 15_000 });
  await expect(frame.getByTestId('robot-3d-loading')).toHaveCount(0);
  await pinLowTierChainOff(frame);
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
/** A point in the frame's own pixels, in the lesson page's: the frame sits inside the iframe's 2 px border. */
const frameOffset = (box: { x: number; y: number } | null, point: { x: number; y: number }) => ({ x: (box?.x ?? 0) + 2 + point.x, y: (box?.y ?? 0) + 2 + point.y });
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
    await expect.poll(() => litBlocks(frame), { timeout: 30_000 }).toEqual(['drive-time']);
    expect((await view(frame))?.robot.yCm).toBeCloseTo(40, 0);
    await screenshot(page, '02-running-1100x640.png');

    // Đặt lại during a paused run: the run starts again from the start pose, at t = 0, and stays paused there.
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');
    await frame.getByTestId('robot-reset').click();
    await expect.poll(async () => (await view(frame))?.t ?? 99, { timeout: 30_000 }).toBe(0);
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
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc', { timeout: 20_000 });
    await expect(frame.getByTestId('robot-status')).toHaveAttribute('data-tone', 'success');
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

  test('a run the time limit ends is a stopped run: the host hears run-stopped once, Dừng is off and Chạy is on, and the end stays in view (bt-lab-fix, m1)', async ({ page, baseURL }) => {
    // A 15 s round at 4× takes about 4 s; under the suite's own load SwiftShader may draw much slower, so the waits below are conditions.
    test.setTimeout(90_000);
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`));
    const runMessages = async () => (await messageTypes(page)).filter((type) => type === 'run-started' || type === 'run-stopped');
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-stop')).toBeEnabled();
    await expect.poll(runMessages).toEqual(['run-started']);
    // The scenario's time limit is 15 s: 4 s at 4×, with room for a slow machine. The host is told when the round is over, with no Dừng.
    await expect.poll(runMessages, { timeout: 60_000 }).toEqual(['run-started', 'run-stopped']);
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc');
    await expect(frame.getByTestId('robot-stop')).toBeDisabled();
    await expect(frame.getByTestId('robot-run')).toBeEnabled();
    // Nothing reset: the end badge, the HUD's score and clock and the robot's final pose stay as the run left them.
    await expect(frame.getByTestId('robot-score')).toHaveText('Điểm 100/100');
    await expect(frame.getByTestId('robot-time')).toHaveText('Thời gian 15,0 / 15 s');
    expect((await view(frame))?.t).toBeCloseTo(15, 3);
    // Đặt lại robot starts the run again, which the host hears; Dừng ends it, once. No wait: each is the next thing to happen.
    await frame.getByTestId('robot-reset').click();
    await expect.poll(runMessages).toEqual(['run-started', 'run-stopped', 'run-started']);
    await expect(frame.getByTestId('robot-stop')).toBeEnabled();
    await frame.getByTestId('robot-stop').click();
    await expect.poll(runMessages).toEqual(['run-started', 'run-stopped', 'run-started', 'run-stopped']);
    await expect(frame.getByTestId('robot-stop')).toBeDisabled();
    expect(await runMessages()).toEqual(['run-started', 'run-stopped', 'run-started', 'run-stopped']);
    expect(errors).toEqual([]);
  });

  test('draws the idle view before any run: the canvas shows the arena and the robot, not the page behind it', async ({ page, baseURL }) => {
    // Counts the draws to the screen and reads pixels of each one, in a microtask after it starts: after the frame's draw calls, before
    // the compositor takes the picture (the drawing buffer is not preserved).
    await page.addInitScript(() => {
      const probe = window as unknown as { __draws: number; __pixels: number[][] };
      probe.__draws = 0;
      probe.__pixels = [];
      const clear = WebGL2RenderingContext.prototype.clear;
      WebGL2RenderingContext.prototype.clear = function (this: WebGL2RenderingContext, mask: number) {
        if (this.getParameter(this.FRAMEBUFFER_BINDING) === null) {
          probe.__draws += 1;
          queueMicrotask(() => {
            const pixels: number[][] = [];
            for (let i = 1; i <= 5; i += 1) {
              for (let j = 1; j <= 5; j += 1) {
                const pixel = new Uint8Array(4);
                this.readPixels(Math.floor((this.drawingBufferWidth * i) / 6), Math.floor((this.drawingBufferHeight * j) / 6), 1, 1, this.RGBA, this.UNSIGNED_BYTE, pixel);
                pixels.push([...pixel]);
              }
            }
            probe.__pixels = pixels;
          });
        }
        clear.call(this, mask);
      };
    });
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await expect(frame.getByTestId('robot-status')).toHaveText('Chưa chạy');
    const { draws, pixels } = await frame.evaluate(() => {
      const probe = window as unknown as { __draws: number; __pixels: number[][] };
      return { draws: probe.__draws, pixels: probe.__pixels };
    });
    expect(draws).toBeGreaterThanOrEqual(1);
    expect(pixels).toHaveLength(25);
    // The view's own colours (the sky, the floor, the walls, the zones, the robot), not the plain background of the page (#f1f4f9).
    const colours = new Set(pixels.map((pixel) => pixel.join(',')));
    expect(colours.size).toBeGreaterThanOrEqual(4);
    expect(pixels.filter(([r, g, b]) => r === 0xf1 && g === 0xf4 && b === 0xf9)).toHaveLength(0);
  });

  test('draws the run in every frame its snapshot changes, and nothing once the robot rests (the canvas draws on demand)', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    // Counts the canvas's draws to the screen: three clears WebGL's default framebuffer once per render.
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
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.3);
    const during = await frame.evaluate(
      () =>
        new Promise<{ changed: number; draws: number }>((done) => {
          const counter = window as unknown as { __draws: number };
          const start = counter.__draws;
          let last = -1;
          let changed = 0;
          let frames = 0;
          const step = () => {
            const t = (window.__stem?.robot.getSnapshot() as { t: number } | null)?.t ?? -1;
            if (t !== last) changed += 1;
            last = t;
            if (++frames < 90) requestAnimationFrame(step);
            else done({ changed, draws: counter.__draws - start });
          };
          requestAnimationFrame(step);
        }),
    );
    expect(during.changed).toBeGreaterThan(30);
    expect(during.draws / during.changed).toBeGreaterThan(0.8);
    // The program ends after 5 s and the robot rests in the target: the canvas stops drawing, and the HUD's clock goes on (fix round 1).
    await expect(frame.getByTestId('robot-status')).toHaveText('Chương trình đã chạy xong', { timeout: 10_000 });
    await page.waitForTimeout(1500);
    const rested = await frame.evaluate(() => (window as unknown as { __draws: number }).__draws);
    const restedAt = await frame.getByTestId('robot-time').textContent();
    await page.waitForTimeout(1000);
    expect(await frame.evaluate(() => (window as unknown as { __draws: number }).__draws)).toBe(rested);
    expect(await frame.getByTestId('robot-time').textContent()).not.toBe(restedAt);
  });

  test('steps 0.1 s of simulated time from idle, paused, then runs on with Tiếp tục', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.getByTestId('robot-step').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Tạm dừng');
    await expect.poll(async () => (await view(frame))?.t, { timeout: 30_000 }).toBeCloseTo(0.1, 9);
    await frame.getByTestId('robot-step').click();
    await expect.poll(async () => (await view(frame))?.t, { timeout: 30_000 }).toBeCloseTo(0.2, 9);
    await page.waitForTimeout(300);
    expect((await view(frame))?.t).toBeCloseTo(0.2, 9);
    await frame.getByTestId('robot-pause').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.4);
  });

  test('says when the browser takes the 3D view’s WebGL away, and draws again when it comes back; the run goes on', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy');
    // N18 R4.6 fix round 1 (controller ruling b): the extension is taken before the loss. A lost context answers `getExtension` with null,
    // so asking for it again to restore (as this test did) restored nothing, and the message went away because the view gave up.
    await frame.evaluate(() => {
      const canvas = document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement;
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
      (window as unknown as { __loseContext: WEBGL_lose_context | null }).__loseContext = gl.getExtension('WEBGL_lose_context');
    });
    const lose = (action: 'loseContext' | 'restoreContext') =>
      frame.evaluate((which) => {
        const extension = (window as unknown as { __loseContext: WEBGL_lose_context | null }).__loseContext;
        if (extension === null) throw new Error('This browser has no WEBGL_lose_context');
        extension[which]();
      }, action);
    await lose('loseContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveText('Khung nhìn 3D bị mất đồ hoạ. Đang khôi phục…');
    const before = (await view(frame))?.t ?? 0;
    await expect.poll(async () => (await view(frame))?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(before + 0.2);
    await lose('restoreContext');
    await expect(frame.getByTestId('robot-webgl-lost')).toHaveCount(0);
    // It came back: the 3D view is still the view (a context that stayed lost would have given way to the 2D map after 2 s).
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await expect(frame.getByTestId('robot-scene')).toBeVisible();
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

  // N18 bt-lab-fix (c4): a program the host loads (or the learner's last one, restored) is brought into view; the learner's edits never move it.
  type BlocksView = { scale: number; blocks: { left: number; top: number; right: number; bottom: number }; view: { left: number; top: number; right: number; bottom: number } };
  /** The editor's zoom, the box of its top-level blocks and the part of the editor that shows the workspace (not its toolbox or scrollbars), in page pixels. */
  const blocksView = (target: Page | Frame): Promise<BlocksView> =>
    target.evaluate(() => {
      const panel = document.querySelector('[data-testid=blockly-panel]')!;
      const rect = (element: Element | null) => element?.getBoundingClientRect() ?? null;
      const area = panel.getBoundingClientRect();
      const toolbox = rect(panel.querySelector('.blocklyToolbox'));
      const vertical = rect(panel.querySelector('.blocklyScrollbarVertical.blocklyMainWorkspaceScrollbar'));
      const horizontal = rect(panel.querySelector('.blocklyScrollbarHorizontal.blocklyMainWorkspaceScrollbar'));
      const boxes = [...panel.querySelectorAll('svg.blocklySvg > g.blocklyWorkspace > g.blocklyBlockCanvas > g.blocklyDraggable')].map((block) => block.getBoundingClientRect());
      const canvas = panel.querySelector('svg.blocklySvg > g.blocklyWorkspace > g.blocklyBlockCanvas')!.getAttribute('transform') ?? '';
      return {
        scale: Number(/scale\(([\d.]+)\)/.exec(canvas)?.[1] ?? Number.NaN),
        blocks: { left: Math.min(...boxes.map((box) => box.left)), top: Math.min(...boxes.map((box) => box.top)), right: Math.max(...boxes.map((box) => box.right)), bottom: Math.max(...boxes.map((box) => box.bottom)) },
        view: { left: toolbox?.right ?? area.left, top: area.top, right: vertical !== null && vertical.width > 0 ? vertical.left : area.right, bottom: horizontal !== null && horizontal.height > 0 ? horizontal.top : area.bottom },
      };
    });
  const missionDocument = (place?: { x: number; y: number }) => {
    const workspace = JSON.parse(JSON.stringify(robotSolutions['rb-mini-mission'].reference)) as { blocks: { blocks: { x?: number; y?: number }[] } };
    if (place !== undefined) Object.assign(workspace.blocks.blocks[0]!, place);
    return { ...robotStarterDocument('rb-mini-mission'), program: { blocks: workspace } };
  };
  /** The top-left of the blocks is in the view (the toolbox's edge and the top are the view's own). */
  const topLeftInView = ({ blocks, view }: BlocksView) => blocks.left >= view.left - 1 && blocks.top >= view.top - 1 && blocks.left < view.right && blocks.top < view.bottom;

  test('brings the program a host loads into view: the lesson frame shows all of the mission’s reference, zoomed out a little', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-mini-mission&origin=${encodeURIComponent(lessonOrigin)}`));
    const starter = await blocksView(frame);
    await frame.evaluate((document) => window.__stem?.loadProject(document), missionDocument());
    await expect.poll(async () => (await blocksView(frame)).blocks.bottom).toBeGreaterThan(starter.blocks.bottom);
    const loaded = await blocksView(frame);
    // Every block is in the view, at a scale between the lab's smallest and 1.
    expect(loaded.blocks.left).toBeGreaterThanOrEqual(loaded.view.left);
    expect(loaded.blocks.top).toBeGreaterThanOrEqual(loaded.view.top);
    expect(loaded.blocks.right).toBeLessThanOrEqual(loaded.view.right);
    expect(loaded.blocks.bottom).toBeLessThanOrEqual(loaded.view.bottom);
    expect(loaded.scale).toBeGreaterThanOrEqual(0.5);
    expect(loaded.scale).toBeLessThan(1);
    await screenshot(page, '09-loaded-mission-1100x640.png');

    // The learner's own edit never moves the view: dragging the program a little moves it, not the editor.
    const from = frameOffset(await page.locator('iframe').boundingBox(), { x: loaded.blocks.left + 14, y: loaded.blocks.top + 10 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 15, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await blocksView(frame)).blocks.left).toBeGreaterThan(loaded.blocks.left + 10);
    const dragged = await blocksView(frame);
    expect(dragged.scale).toBe(loaded.scale);
    expect(dragged.view).toEqual(loaded.view);
    // And it is written to the document, so the host hears of the edit (the project changes; the view is no part of it).
    await expect.poll(async () => (await messageTypes(page)).filter((type) => type === 'project-changed').length).toBeGreaterThan(0);
  });

  test('brings the program into view even when it is placed far from where the editor starts, and keeps its top-left in sight in a narrow frame', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 948, height: 450 });
    await page.goto(labUrl(baseURL, 'lab=robot&template=rb-mini-mission'));
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ state: 'attached', timeout: 15_000 });
    await pinLowTierChainOff(page);
    // Placed at (1500, 1100) of the workspace: well outside the first view.
    const starter = await blocksView(page);
    await page.evaluate((document) => window.__stem?.loadProject(document), missionDocument({ x: 1500, y: 1100 }));
    // The load has shown when the program is not the starter's (its height differs); then it is in view.
    await expect.poll(async () => Math.abs((await blocksView(page)).blocks.bottom - (await blocksView(page)).blocks.top - (starter.blocks.bottom - starter.blocks.top))).toBeGreaterThan(20);
    expect(topLeftInView(await blocksView(page))).toBe(true);
    const narrow = await blocksView(page);
    // The panel is about 230 px wide beside the toolbox: the reference does not fit at the lab's smallest scale, which is where it stops, and
    // the rest of it is a scroll away.
    expect(narrow.scale).toBe(0.5);
    expect(narrow.blocks.right - narrow.blocks.left).toBeGreaterThan(narrow.view.right - narrow.view.left);
    await screenshot(page, '10-loaded-mission-948x450.png');
    expect(errors).toEqual([]);
  });

  test('brings a program loaded while the lab has no size (its frame is out of sight) into view once the frame is shown', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-mini-mission&origin=${encodeURIComponent(lessonOrigin)}`));
    const starter = await blocksView(frame);
    await page.locator('iframe').evaluate((element) => (element.style.display = 'none'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), missionDocument());
    await page.locator('iframe').evaluate((element) => (element.style.display = ''));
    await expect.poll(async () => Math.abs((await blocksView(frame)).blocks.bottom - (await blocksView(frame)).blocks.top - (starter.blocks.bottom - starter.blocks.top))).toBeGreaterThan(20);
    // Fitted to the editor as it is shown (every block in view at the lab's smallest scale), not to the empty one it was loaded into, which
    // zoomed it out to the smallest scale with the same blocks cut off.
    await expect.poll(async () => (await blocksView(frame)).blocks.right <= (await blocksView(frame)).view.right).toBe(true);
    const shown = await blocksView(frame);
    expect(topLeftInView(shown)).toBe(true);
    expect(shown.blocks.bottom).toBeLessThanOrEqual(shown.view.bottom);
    expect(shown.scale).toBeGreaterThanOrEqual(0.5);
    await screenshot(page, '11-loaded-while-hidden-1100x640.png');
  });

  // N18 bt-lab-fix (c2): the result card stands beside the HUD, not over its goal points, in the lab's frames in the LMS at 1440, 1366 and
  // 1280 px wide (1022 x 590, 948 x 450 and 862 x 402 px of lab). At 1440 nothing moves: the card keeps its 330 px.
  for (const { name, width, height, cardWidth } of [
    { name: '1440', width: 1022, height: 590, cardWidth: 330 },
    { name: '1366', width: 948, height: 450, cardWidth: null },
    { name: '1280', width: 862, height: 402, cardWidth: null },
  ]) {
    test(`the result card does not cover the HUD’s goals in the ${name}-wide LMS frame (${width} x ${height})`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height });
      await page.goto(labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
      await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ state: 'attached', timeout: 15_000 });
      await pinLowTierChainOff(page);
      await page.evaluate((document) => window.__stem?.loadProject(document), solved());
      await page.locator('[data-testid=robot-check-speed] [data-speed=fast]').click();
      await page.getByTestId('robot-check-start').click();
      await expect(page.getByTestId('robot-check-results')).toHaveAttribute('data-open', 'true', { timeout: 60_000 });
      await expect(page.getByTestId('robot-check-verdict')).toBeVisible();
      const boxes = await page.evaluate(() => {
        const box = (testId: string) => {
          const { left, top, right, bottom } = document.querySelector(`[data-testid=${testId}]`)!.getBoundingClientRect();
          return { left, top, right, bottom, width: right - left };
        };
        return { stage: box('robot-viewport'), hud: box('robot-hud'), card: box('robot-check-results'), goals: box('robot-goals') };
      });
      // Side by side: the card starts at or after the HUD's right edge (the HUD and the card share the top part of the view).
      expect(boxes.card.top).toBeLessThan(boxes.hud.bottom);
      expect(boxes.card.left).toBeGreaterThanOrEqual(boxes.hud.right);
      expect(boxes.card.right).toBeLessThanOrEqual(boxes.stage.right);
      if (cardWidth !== null) expect(boxes.card.width).toBe(cardWidth);
      else expect(boxes.card.width).toBeGreaterThanOrEqual(200);
      await expect(page.getByTestId('robot-check-verdict')).toHaveText('Đạt');
      await screenshot(page, `12-result-card-${name}.png`);
      expect(errors).toEqual([]);
    });
  }

  test('at 760 px: Robot and Chương trình are tabs, a Run shows the robot, nothing scrolls', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 760, height: 640 });
    await page.goto('/?embed=1&lab=robot&template=rb-drive-to-zone');
    await page.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ state: 'attached', timeout: 15_000 });
    await pinLowTierChainOff(page);
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
