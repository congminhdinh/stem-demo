import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument, type RobotTemplateKey } from '../src/samples/robot-templates';
import { pinLowTierChainOff } from './robot-chain';

// N18 R6.3: Kiểm tra in the robot lab, in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts, project
// chromium-robot). A check of a reference sends the host a scored check-result after the check's run stopped; an exploit fails with the
// reasons in Vietnamese and "Xem lại" replays its round to the very world the check ended it in; a cancelled check sends nothing; and the
// result is the same at 1×, 4× and fast (headless), and with the tab hidden in the middle of a check (Review Focus 2). Screenshots go to
// R63_SHOTS_DIR (the report's), or under test-results.

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R63_SHOTS_DIR ?? join('test-results', 'robot-lab-check');

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };

const labUrl = (baseURL: string | undefined, template: RobotTemplateKey) =>
  new URL(`/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

/**
 * A tab the test can hide, in every frame: what a browser does to a background tab, which headless Chromium does not do to a page by itself
 * (measured for R6.3: neither another page brought to the front, a minimized window nor CDP Page.setWebLifecycleState "frozen" stops its
 * animation frames). Hidden, no animation frame runs (they wait), `document.hidden` is true and `visibilitychange` fires; shown, the frames
 * that waited run.
 */
function hideableTab(page: Page) {
  return page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    let hidden = false;
    let nextHeld = -1;
    const held = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback) => {
      if (!hidden) return request(callback);
      held.set(nextHeld, callback);
      return nextHeld--;
    };
    window.cancelAnimationFrame = (handle) => (handle < 0 ? void held.delete(handle) : cancel(handle));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    (window as unknown as { __hideTab(hide: boolean): void }).__hideTab = (hide) => {
      hidden = hide;
      document.dispatchEvent(new Event('visibilitychange'));
      if (!hide) {
        const waiting = [...held.values()];
        held.clear();
        waiting.forEach((callback) => request(callback));
      }
    };
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
  await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
  await expect(frame.getByTestId('robot-3d-loading')).toHaveCount(0);
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

const messages = (page: Page) => page.evaluate(() => (window as unknown as { __labMessages: Recorded[] }).__labMessages.map((message) => message.data));
const types = async (page: Page) => (await messages(page)).map((message) => message.type);
const checkResults = async (page: Page) => (await messages(page)).filter((message) => message.type === 'check-result');
const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/** A scenario's project with a program of its solutions: the reference, or the exploit of that name. */
function projectOf(template: Exclude<RobotTemplateKey, 'rb-sandbox'>, program: 'reference' | string) {
  const solution = robotSolutions[template];
  const blocks = program === 'reference' ? solution.reference : solution.exploits?.find((exploit) => exploit.name === program)?.program;
  if (blocks === undefined) throw new Error(`${template} has no program ${program}`);
  return { ...robotStarterDocument(template), program: { blocks } };
}

/** Kiểm tra at `speed`, then the check-result it sent and the hash of the world each round ended in (the dev build's panel says it). */
async function check(page: Page, frame: Frame, speed: '1x' | '4x' | 'fast', during?: () => Promise<void>) {
  const before = (await checkResults(page)).length;
  await frame.locator(`[data-testid=robot-check-speed] [data-speed="${speed}"]`).click();
  await frame.getByTestId('robot-check-start').click();
  await during?.();
  await expect.poll(async () => (await checkResults(page)).length, { timeout: 60_000 }).toBe(before + 1);
  await expect(frame.getByTestId('robot-check-results')).toBeVisible();
  const hashes = await frame.locator('[data-testid=robot-check-rounds] > li').evaluateAll((items) => items.map((item) => item.getAttribute('data-world-hash')));
  return { result: (await checkResults(page))[before]!, hashes };
}

// N18 bt-lab-fix: under a suite's load SwiftShader draws a run slowly (at most 8 ticks a drawn frame), so the waits in this file are for a
// condition, not for a time, and a test's own limit is for a hang, not for a busy machine.
test.describe.configure({ timeout: 120_000 });

test.describe('Kiểm tra in the robot lab (N18 R6.3)', () => {
  test('checks the reference at 4×: its run in the view, Lượt 1/1, then a check-result with its score after the run stopped', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    // The check holds the lab and shows its round and its run.
    await expect(frame.getByTestId('robot-check-round')).toHaveText('Lượt 1/1');
    await expect(frame.getByTestId('robot-run')).toBeDisabled();
    await expect(frame.getByTestId('robot-round')).toHaveText('Lượt 1/1');
    await expect.poll(async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { t: number } | null)?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(1);
    await screenshot(page, '01-checking-4x-1100x640.png');
    await expect.poll(async () => (await checkResults(page)).length, { timeout: 30_000 }).toBe(1);
    const [result] = await checkResults(page);
    expect(result).toMatchObject({
      protocol: 'stem-lab/v1',
      type: 'check-result',
      lab: 'robot',
      passed: true,
      goals: [
        { id: 'reach-target', label: 'Xe chạy vào vùng đích', passed: true },
        { id: 'stop-in-target', label: 'Xe dừng hẳn trong vùng đích', passed: true },
      ],
      score: 100,
      maxScore: 100,
      simTimeMs: 15000,
      variants: [{ seed: 1, passed: true, score: 100, simTimeMs: 15000 }],
      engine: 'robot-engine@1',
      scenarioVersion: 1,
    });
    expect(result!.programHash).toMatch(/^[0-9a-f]{64}$/);
    // The checked program first, then the check's run, then its result (lab-embed-contract §2).
    expect(await types(page)).toEqual(['ready', 'project-changed', 'run-started', 'run-stopped', 'check-result']);
    const checked = (await messages(page)).find((message) => message.type === 'project-changed')!.document;
    expect(checked).toEqual(await frame.evaluate(() => window.__stem?.getProject()));
    await expect(frame.getByTestId('robot-check-verdict')).toHaveText('Đạt');
    await expect(frame.getByTestId('robot-check-score')).toHaveText('100/100 điểm');
    await expect(frame.getByTestId('robot-run')).toBeEnabled();
    expect(await frame.evaluate(() => [document.scrollingElement?.scrollWidth, document.scrollingElement?.clientWidth])).toEqual([1100, 1100]);
    await screenshot(page, '02-passed-1100x640.png');
    expect(errors).toEqual([]);
  });

  test('an exploit fails with the reasons in Vietnamese, and Xem lại replays its round to the world the check ended it in', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-stop-at-wall', 'crash-and-back-off'));
    const { result, hashes } = await check(page, frame, 'fast');
    expect(result).toMatchObject({ passed: false, score: 0, goals: [{ id: 'stop-near-wall', passed: false }, { id: 'no-crash', passed: false }] });
    expect(result.variants).toHaveLength(3);
    // A fast check is not shown: the host heard no run.
    expect(await types(page)).toEqual(['ready', 'project-changed', 'check-result']);
    await expect(frame.getByTestId('robot-check-verdict')).toHaveText('Chưa đạt');
    const reasons = await frame.locator('[data-testid=robot-check-goals] .robot-check-why').allTextContents();
    expect(reasons).toHaveLength(6);
    for (const [index, reason] of reasons.slice(3).entries()) expect(reason).toMatch(new RegExp(`^Xe chạm tường lúc \\d+,\\d s ở lượt ${index + 1}$`));
    for (const [index, reason] of reasons.slice(0, 3).entries()) expect(reason).toMatch(new RegExp(`^Lượt chạy dừng vì xe đâm vào tường lúc \\d+,\\d s ở lượt ${index + 1}$`));
    await screenshot(page, '03-exploit-1100x640.png');

    // Xem lại round 2 at 1×: the same run again, to the same last world.
    await frame.getByTestId('robot-check-replay-2').click();
    await expect(frame.getByTestId('robot-round')).toHaveText('Lượt 2/3');
    await expect(frame.getByTestId('robot-speed').getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
    await expect(frame.getByTestId('robot-check-results')).toHaveAttribute('data-open', 'false');
    await expect(frame.getByTestId('robot-status')).toHaveText('Đang chạy', { timeout: 30_000 });
    await screenshot(page, '04-replay-1100x640.png');
    await expect(frame.getByTestId('robot-status')).toHaveText('Hết lượt: robot đã va chạm', { timeout: 60_000 });
    expect(await frame.evaluate(() => window.__stem?.robot.snapshotHash())).toBe(hashes[1]);
    // The HUD gives that round the check's score.
    await expect(frame.getByTestId('robot-score')).toHaveText('Điểm 0/100');
    expect(errors).toEqual([]);
  });

  test('Dừng kiểm tra ends the check without a result: the host is sent no check-result', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    // N18 final fix I1: a check runs fast by default; this one is shown at 1×.
    await frame.locator('[data-testid=robot-check-speed] [data-speed="1x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect.poll(async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { t: number } | null)?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.5);
    await frame.getByTestId('robot-check-cancel').click();
    await expect(frame.getByTestId('robot-check-start')).toBeVisible();
    await expect(frame.getByTestId('robot-run')).toBeEnabled();
    await expect(frame.getByTestId('robot-status')).toHaveText('Chưa chạy');
    await page.waitForTimeout(1500);
    expect(await types(page)).toEqual(['ready', 'project-changed', 'run-started', 'run-stopped']);
    await expect(frame.getByTestId('robot-check-results')).toHaveCount(0);
  });

  test('a load-project from the host during a check opens after it: the check-result first, then the project it loaded', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    const checked = projectOf('rb-drive-to-zone', 'reference');
    await frame.evaluate((document) => window.__stem?.loadProject(document), checked);
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect.poll(async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { t: number } | null)?.t ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.5);
    const loaded = { ...robotStarterDocument('rb-drive-to-zone'), id: 'saved-by-the-host' };
    await page.evaluate(([message, origin]) => (window as unknown as { __sendToLab(message: unknown, origin: string): void }).__sendToLab(message, origin as string), [
      { protocol: 'stem-lab/v1', type: 'load-project', document: loaded },
      new URL(frame.url()).origin,
    ] as const);
    // It waits: the check goes on with the program it checks.
    await page.waitForTimeout(300);
    expect(((await frame.evaluate(() => window.__stem?.getProject())) as { id: string }).id).toBe(checked.id);
    await expect(frame.getByTestId('robot-check-round')).toHaveText('Lượt 1/1');
    await expect.poll(async () => (await checkResults(page)).length, { timeout: 30_000 }).toBe(1);
    await expect.poll(() => frame.evaluate(() => window.__stem?.getProject())).toEqual(loaded);
    await expect.poll(() => types(page)).toEqual(['ready', 'project-changed', 'run-started', 'run-stopped', 'check-result', 'project-changed']);
    expect((await messages(page)).at(-1)?.document).toEqual(loaded);
    // The result was about the program it checked: the new project closes it.
    await expect(frame.getByTestId('robot-check-results')).toHaveCount(0);
  });

  test('same score/passed/hash for 1×, 4× and headless', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-drive-to-zone'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    const fast = await check(page, frame, 'fast');
    const quick = await check(page, frame, '4x');
    const real = await check(page, frame, '1x');
    expect(fast.result).toMatchObject({ passed: true, score: 100 });
    expect(fast.hashes).toEqual([expect.stringMatching(/^[0-9a-f]{8}$/)]);
    expect(quick).toEqual(fast);
    expect(real).toEqual(fast);
  });

  test('a tab hidden in the middle of a check at 4× pauses it, and gives the result a fast check gives', async ({ page, baseURL }) => {
    await hideableTab(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-stop-at-wall', 'crash-and-back-off'));
    const fast = await check(page, frame, 'fast');
    const hidden = await check(page, frame, '4x', async () => {
      await expect(frame.getByTestId('robot-check-round')).toHaveText('Lượt 2/3', { timeout: 60_000 });
      await frame.evaluate(() => (window as unknown as { __hideTab(hide: boolean): void }).__hideTab(true));
      // A frame the browser had already asked for may still come.
      await page.waitForTimeout(100);
      const at = await frame.evaluate(() => (window.__stem?.robot.getSnapshot() as { t: number }).t);
      await page.waitForTimeout(1500);
      // Hidden, the check stands still: no frame, no tick.
      expect(await frame.evaluate(() => (window.__stem?.robot.getSnapshot() as { t: number }).t)).toBe(at);
      await expect(frame.getByTestId('robot-check-round')).toHaveText('Lượt 2/3');
      await frame.evaluate(() => (window as unknown as { __hideTab(hide: boolean): void }).__hideTab(false));
    });
    expect(hidden).toEqual(fast);
    expect(fast.result).toMatchObject({ passed: false, score: 0 });
  });
});

// N19 D4, Gate G1 (plan §8): a program on the gripper car grabs a cube and puts it down in its zone, in the lab's frame of a lesson page. The
// reference of rb-grip-pick passes Kiểm tra with Node's result and Node's last world in each round (tests/__snapshots__/robot-determinism.json,
// `rb-grip-pick-reference`), and a run of it shows the car holding the cube.
test.describe('Kiểm tra of a gripper lesson (N19 D4, Gate G1)', () => {
  test('rb-grip-pick: the reference passes, with Node’s result and last worlds; Chạy at 4× lifts the cube in the jaws', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-grip-pick'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-grip-pick', 'reference'));
    const { result, hashes } = await check(page, frame, 'fast');
    expect(result).toMatchObject({
      protocol: 'stem-lab/v1',
      type: 'check-result',
      lab: 'robot',
      passed: true,
      goals: [
        { id: 'grab-cube', label: 'Gắp và nhấc khối lên', passed: true },
        { id: 'place-cube', label: 'Đặt khối vào vùng thả', passed: true },
        { id: 'no-crash', label: 'Không chạm tường', passed: true },
      ],
      score: 100,
      maxScore: 100,
      simTimeMs: 30000,
      variants: [
        { seed: 23, passed: true, score: 100, simTimeMs: 30000 },
        { seed: 24, passed: true, score: 100, simTimeMs: 30000 },
        { seed: 25, passed: true, score: 100, simTimeMs: 30000 },
      ],
      engine: 'robot-engine@1',
      scenarioVersion: 1,
      programHash: '810d030630f07c96a115b28f05ef5e1c59c10e1c6b948ed59a9f7178d590a6b4',
    });
    expect(hashes).toEqual(['d8b9f15d', '72464d2f', '96810539']);
    await expect(frame.getByTestId('robot-check-verdict')).toHaveText('Đạt');
    await expect(frame.getByTestId('robot-check-score')).toHaveText('100/100 điểm');
    await screenshot(page, '20-gripper-pick-passed-1100x640.png');

    // Chạy at 4×: the arm comes down, the jaws close on the cube and lift it.
    await frame.getByTestId('robot-speed').getByRole('radio', { name: '4×' }).click();
    await frame.getByTestId('robot-run').click();
    type Held = { robot: { gripper?: { heldId: string | null; liftDeg: number } }; objects: { id: string; pose: { zCm: number } }[] };
    await expect
      .poll(async () => {
        const world = (await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as Held | null;
        return world?.robot.gripper?.heldId === 'cube' && world.robot.gripper.liftDeg > 80 && world.objects[0]!.pose.zCm > 8;
      }, { timeout: 120_000, intervals: [100] })
      .toBe(true);
    await screenshot(page, '21-gripper-pick-holding-1100x640.png');
    expect(errors).toEqual([]);
  });
});
