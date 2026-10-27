import { expect, test, type Frame, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { composite, contrastRatio, parseColor, type Rgba } from '../src/ui/a11y/contrast';
import { hat, robotSolutions, workspace } from '../src/samples/robot-solutions';
import { robotStarterDocument, type RobotTemplateKey } from '../src/samples/robot-templates';
import { patternInk } from '../src/ui/robot3d/zone-pattern';
import { decodePng } from '../scripts/lib/png';
import { readJson } from './helpers';
import { pinLowTierChainOff } from './robot-chain';
import { basicSkip } from '../tests/basic-skip';

// N18 R8: the robot lab for a keyboard and a screen reader, in the 1100 x 640 frame of a lesson page, drawn by SwiftShader (playwright.config.ts,
// project chromium-robot). There is no axe here (no new dependency): the checks read Playwright's accessibility snapshot (names and roles of
// every control), the page's live regions (one polite, one assertive, what they say on a run and a check), the focus (it is not taken from the
// host on load; it goes to a check's result and back to Kiểm tra; the Tab order), the camera's keys, the colour contrast of what is drawn
// (computed from the real page, as axe's color-contrast rule does), reduced motion, a browser zoomed to 200 %, and the zones' patterns on
// the 2D map. Screenshots go to R8_SHOTS_DIR (the report's), or under test-results.

// A check and a run at 4× on SwiftShader take a while on a shared machine.
test.describe.configure({ timeout: 120_000 });

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R8_SHOTS_DIR ?? join('test-results', 'robot-lab-a11y');

const labUrl = (baseURL: string | undefined, template: RobotTemplateKey = 'rb-drive-to-zone') =>
  new URL(`/?embed=1&lab=robot&template=${template}&origin=${encodeURIComponent(lessonOrigin)}`, baseURL).href;

async function frameOf(page: Page): Promise<Frame> {
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) throw new Error('The lab iframe has no frame');
  return frame;
}

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await frameOf(page);
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


/** A project of `template` whose program is one `stem_on_start` hat with these blocks under it. */
const programOf = (template: Exclude<RobotTemplateKey, 'rb-sandbox'>, ...body: Record<string, unknown>[]) => ({ ...robotStarterDocument(template), program: { blocks: workspace(hat('stem_on_start', body)) } });
/** A drive block with no speed in its socket: the program does not compile (U-21's input is required). */
const brokenDrive = { type: 'uno_drive_move', id: 'broken', fields: { DIRECTION: 'forward' } };
/** Prints a line on Serial. */
const printLine = (text: string) => ({ type: 'text_print', id: 'print', inputs: { TEXT: { shadow: { type: 'text', id: 'say', fields: { TEXT: text } } } } });

// The live regions -------------------------------------------------------------------------------------------------------------------

/** Every live region the lab owns (the program's editor is Blockly's, the Serial console is a log told to be quiet). */
const liveRegions = (frame: Frame) =>
  frame.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.robot-lab [aria-live], .robot-lab [role=status], .robot-lab [role=alert], .robot-lab [role=log], .robot-lab [role=timer], .robot-lab [role=marquee]')]
      .filter((element) => element.getAttribute('aria-live') !== 'off' && element.closest('.robot-program') === null)
      .map((element) => ({ live: element.getAttribute('aria-live'), role: element.getAttribute('role'), testId: element.getAttribute('data-testid'), atomic: element.getAttribute('aria-atomic') })),
  );

/** Records every message a live region of the lab is given, from now on (`window.__said[testId]`). */
async function recordSaid(frame: Frame) {
  await frame.evaluate(() => {
    const said: Record<string, string[]> = { 'robot-check-announce': [], 'robot-alert-announce': [] };
    (window as unknown as { __said: typeof said }).__said = said;
    for (const testId of Object.keys(said)) {
      const region = document.querySelector(`[data-testid=${testId}]`)!;
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) if (node.textContent) said[testId]!.push(node.textContent);
      }).observe(region, { childList: true });
    }
  });
}
const said = (frame: Frame, testId: 'robot-check-announce' | 'robot-alert-announce') => frame.evaluate((id) => (window as unknown as { __said: Record<string, string[]> }).__said[id]!, testId);

// The accessibility snapshot ---------------------------------------------------------------------------------------------------------

type AriaNode = { role?: string; name?: string; text?: string; children?: AriaNode[]; [flag: string]: unknown };
const interactiveRoles = new Set(['button', 'radio', 'tab', 'slider', 'separator', 'checkbox', 'switch', 'link', 'textbox', 'combobox', 'spinbutton', 'searchbox', 'treeitem', 'menuitem', 'option', 'listbox']);

function walk(nodes: readonly AriaNode[], visit: (node: AriaNode) => void) {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
  }
}

/** The lab's accessibility tree as Playwright reads it. */
async function tree(frame: Frame): Promise<AriaNode[]> {
  return (await frame.locator('.robot-lab').ariaSnapshotJSON()) as unknown as AriaNode[];
}

/** Every control of the tree has a name. */
function expectNamed(nodes: readonly AriaNode[], where: string) {
  const unnamed: string[] = [];
  let seen = 0;
  walk(nodes, (node) => {
    if (node.role !== undefined && interactiveRoles.has(node.role)) {
      seen++;
      if ((node.name ?? '').trim() === '') unnamed.push(node.role);
    }
  });
  expect(seen, `${where}: controls found`).toBeGreaterThan(5);
  expect(unnamed, `${where}: controls with no name`).toEqual([]);
}

const named = (nodes: readonly AriaNode[], role: string, name: string | RegExp) => {
  const found: AriaNode[] = [];
  walk(nodes, (node) => {
    if (node.role === role && (typeof name === 'string' ? node.name === name : name.test(node.name ?? ''))) found.push(node);
  });
  return found;
};

// The colour contrast of what is drawn -----------------------------------------------------------------------------------------------

type TextBox = { text: string; fontPx: number; bold: boolean; color: string; backgrounds: string[]; overCanvas: boolean };

/**
 * Every piece of text of the lab in view, with its colour and the backgrounds up its ancestors, from the page. Elements over the 3D view are
 * judged over its worst case (pure black or pure white, whichever is worse), as the tokens' own test does; a control that is disabled is
 * exempt (WCAG 1.4.3). The program's tabs are looked at (C++, ports and pins); the block editor is Blockly's and is not.
 */
async function textBoxes(frame: Frame): Promise<TextBox[]> {
  return frame.evaluate(() => {
    const boxes: TextBox[] = [];
    const walker = document.createTreeWalker(document.querySelector('.robot-lab')!, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      const element = node.parentElement;
      // The program's tabs (C++, ports and pins) are in; the block editor is Blockly's, drawn with its own theme (src/ui/blockly/theme.ts).
      if (text === '' || !element || element.closest('.blocklyDiv, .injectionDiv, .blocklyWidgetDiv, .blocklyDropDownDiv, script, style, .visually-hidden, [hidden], [inert]')) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      // Off-screen text (a 1 px clipped box: the live regions, the view's hint) is read, not seen.
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width <= 2 || rect.height <= 2) continue;
      if (element.closest(':disabled, [aria-disabled=true]')) continue;
      const backgrounds: string[] = [];
      let overCanvas = false;
      let opacity = 1;
      const withAlpha = (colour: string, alpha: number) => (colour.startsWith('rgba') || alpha === 1 ? colour : colour.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`));
      if (element instanceof SVGElement) {
        // Text of a drawing (the board of the ports and pins tab) is painted with `fill`, over the shapes under it: what the page hits at
        // its middle, from the top down, then the page's own backgrounds up from the drawing.
        const middle = [rect.x + rect.width / 2, rect.y + rect.height / 2] as const;
        for (const under of document.elementsFromPoint(middle[0], middle[1])) {
          if (under === element || element.contains(under) || under.contains(element)) continue;
          const underStyle = getComputedStyle(under);
          if (under instanceof SVGElement) {
            // Only a shape paints (a group or the drawing's root has a `fill` of its own that nothing shows).
            if (under instanceof SVGGeometryElement && underStyle.fill !== 'none') backgrounds.push(withAlpha(underStyle.fill, Number(underStyle.fillOpacity)));
          } else {
            backgrounds.push(underStyle.backgroundColor);
          }
        }
      }
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        opacity *= Number(ancestorStyle.opacity);
        if (!(element instanceof SVGElement) || !(ancestor instanceof SVGElement)) backgrounds.push(ancestorStyle.backgroundColor);
        if (ancestor.classList.contains('robot-stage')) {
          overCanvas = true;
          break;
        }
      }
      if (opacity < 1) continue;
      boxes.push({ text, fontPx: Number.parseFloat(style.fontSize), bold: Number(style.fontWeight) >= 700, color: element instanceof SVGElement ? withAlpha(style.fill, Number(style.fillOpacity)) : style.color, backgrounds, overCanvas });
    }
    return boxes;
  });
}

/** The ratio of a box's text to its background, worst case, and what it needs: 4.5, or 3 for large text. */
function judge(box: TextBox): { ratio: number; needs: number } {
  const needs = box.fontPx >= 24 || (box.fontPx >= 18.66 && box.bold) ? 3 : 4.5;
  const worst = (under: Rgba) => {
    // Up the ancestors, outermost first: each translucent background over what is under it.
    let ground = under;
    for (const background of [...box.backgrounds].reverse()) {
      const colour = parseColor(background);
      if (colour[3] > 0) ground = composite(colour, ground);
    }
    const text = parseColor(box.color);
    return contrastRatio(text[3] === 1 ? text : composite(text, ground), ground);
  };
  const page: Rgba = [255, 255, 255, 1];
  const unders: Rgba[] = box.overCanvas ? [[0, 0, 0, 1], page] : [page];
  return { ratio: Math.min(...unders.map(worst)), needs };
}

async function expectContrast(frame: Frame, where: string) {
  const boxes = await textBoxes(frame);
  expect(boxes.length, `${where}: text found`).toBeGreaterThan(10);
  const failing = boxes.map((box) => ({ box, ...judge(box) })).filter(({ ratio, needs }) => ratio < needs);
  expect(
    failing.map(({ box, ratio, needs }) => `${box.text.slice(0, 40)}: ${ratio.toFixed(2)} < ${needs} (${box.color} on ${box.backgrounds.join(' / ')})`),
    `${where}: text under AA`,
  ).toEqual([]);
}

// Tests ------------------------------------------------------------------------------------------------------------------------------

test.describe('the robot lab’s accessibility (N18 R8)', () => {
  test('opens inside the lesson without taking the focus of the page that frames it', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const lesson = new URL('/lesson', lessonOrigin);
    lesson.searchParams.set('lab', 'about:blank');
    await page.goto(lesson.href);
    // The lesson's own field has the focus; then the lab loads in its frame.
    await page.evaluate((url) => {
      const field = document.createElement('input');
      field.id = 'lesson-field';
      field.setAttribute('aria-label', 'Lesson note');
      document.body.prepend(field);
      field.focus();
      document.querySelector('iframe')!.src = url;
    }, labUrl(baseURL));
    const frame = await frameOf(page);
    await frame.getByTestId('robot-lab').waitFor();
    await pinLowTierChainOff(frame);
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    // Give anything that wanted the focus time to take it: a Blockly workspace that is done, a check, a run.
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('lesson-field');
    expect(await frame.evaluate(() => [document.activeElement === document.body, document.hasFocus()])).toEqual([true, false]);
    await expect(page.locator('#lesson-field')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('has names and roles on every control: the accessibility tree of the lab, idle, with the tools open, and after a check', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the camera views and the view tools');
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    // N18 final fix I1: a check runs fast by default; this lab's learner chose 1×.
    await frame.locator('[data-testid=robot-check-speed] [data-speed="1x"]').click();
    const idle = await tree(frame);
    expectNamed(idle, 'idle');

    // The structure a screen reader moves by.
    expect(named(idle, 'heading', 'Robot 3D')[0]?.level).toBe(1);
    expect(named(idle, 'heading', 'Chạy tới vùng đích')[0]?.level).toBe(2);
    expect(named(idle, 'toolbar', 'Chạy robot')).toHaveLength(1);
    expect(named(idle, 'radiogroup', 'Tốc độ')).toHaveLength(1);
    expect(named(idle, 'radiogroup', 'Tốc độ kiểm tra')).toHaveLength(1);
    expect(named(idle, 'radio', '1×').map((radio) => radio.checked)).toEqual([true, true]);
    expect(named(idle, 'group', 'Kiểm tra')).toHaveLength(1);
    expect(named(idle, 'region', 'Khung nhìn robot')).toHaveLength(1);
    // The 3D view is the one `application` of the lab (the block editor's own is Blockly's, in the program).
    expect(named(idle, 'application', 'Khung nhìn 3D của robot')).toHaveLength(1);
    expect(named(idle, 'group', 'Góc nhìn')).toHaveLength(1);
    expect(named(idle, 'button', 'Tự do')[0]?.pressed).toBe(true);
    expect(named(idle, 'button', 'Hiện cảm biến')).toHaveLength(1);
    expect(named(idle, 'group', 'Công cụ')).toHaveLength(1);
    expect(named(idle, 'region', 'Tình trạng lượt chạy')).toHaveLength(1);
    expect(named(idle, 'region', 'Màn hình Serial')).toHaveLength(1);
    expect(named(idle, 'region', 'Chương trình')).toHaveLength(1);
    expect(named(idle, 'tablist', 'Các phần của chương trình')).toHaveLength(1);
    expect(named(idle, 'tab', /./).map((tab) => [tab.name, tab.selected ?? false])).toEqual([
      ['Khối lệnh', true],
      ['C++', false],
      ['Cổng & chân', false],
    ]);
    expect(named(idle, 'separator', /khung nhìn/i)).toHaveLength(1);
    // The sound button says what it does; it is not also "pressed".
    expect(named(idle, 'button', 'Tắt âm thanh')[0]?.pressed).toBeUndefined();

    // The tools open: the pad (with its slider), the ruler's reading and the move tool's buttons are named too.
    await frame.getByTestId('robot-tool-teleop').click();
    await frame.getByTestId('robot-tool-ruler').click();
    const withRuler = await tree(frame);
    expectNamed(withRuler, 'tools: teleop and ruler');
    expect(named(withRuler, 'group', 'Bàn lái')).toHaveLength(1);
    expect(named(withRuler, 'slider', 'Tốc độ')).toHaveLength(1);
    expect(named(withRuler, 'button', 'Tiến')).toHaveLength(1);
    await frame.getByTestId('robot-tool-teleop').click();
    await frame.getByTestId('robot-tool-move').click();
    expectNamed(await tree(frame), 'tools: move');
    await frame.getByTestId('robot-tool-move').click();

    // Another tab of the program, and the 2D map.
    await frame.getByRole('tab', { name: 'Cổng & chân' }).click();
    expectNamed(await tree(frame), 'ports and pins');
    await frame.getByRole('tab', { name: 'C++' }).click();
    expectNamed(await tree(frame), 'C++');
    await frame.getByRole('tab', { name: 'Khối lệnh' }).click();
    await frame.getByTestId('robot-viewmode').click();
    const map = await tree(frame);
    expectNamed(map, '2D map');
    expect(named(map, 'img', /Bản đồ 2D/)).toHaveLength(1);
    await frame.getByTestId('robot-viewmode').click();

    // After a check the result is a named region with a heading, and its controls are named.
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    const result = await tree(frame);
    expectNamed(result, 'check result');
    expect(named(result, 'region', 'Kết quả kiểm tra')).toHaveLength(1);
    expect(named(result, 'heading', 'Kết quả kiểm tra')[0]?.level).toBe(3);
    expect(named(result, 'button', 'Đóng kết quả kiểm tra')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('has exactly two live regions, a polite one and an assertive one, and a run and a check update them in words, once', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'teleop (Lái tay)');
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    expect(await liveRegions(frame)).toEqual([
      { live: 'polite', role: null, testId: 'robot-check-announce', atomic: 'true' },
      { live: null, role: 'alert', testId: 'robot-alert-announce', atomic: 'true' },
    ]);
    await recordSaid(frame);

    // A run at 4×: started, the program finished, then over at the time limit with its score and why; nothing in between (not the clock, not
    // the score as it moves): at most three messages for a run of 20 s of simulated time.
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-status')).toHaveText('Lượt chạy kết thúc', { timeout: 30_000 });
    await expect.poll(async () => (await said(frame, 'robot-check-announce')).at(-1)).toMatch(/^Lượt chạy kết thúc: hết thời gian\. Điểm \d+\/100\.$/);
    // Started first, over last; the program finishing is a message of its own unless it comes in the same instant as the end.
    const run = await said(frame, 'robot-check-announce');
    expect(run[0]).toBe('Đã bắt đầu chạy.');
    expect(run.length).toBeLessThanOrEqual(3);
    expect(run.slice(1, -1).every((message) => message === 'Chương trình đã chạy xong.')).toBe(true);
    // N18 bt-lab-fix (m1): a run that ended by itself is a stopped run, so Dừng is off; a run that goes on is what Dừng stops and says so.
    await expect(frame.getByTestId('robot-stop')).toBeDisabled();
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-stop')).toBeEnabled();
    await frame.getByTestId('robot-stop').click();
    await expect.poll(async () => (await said(frame, 'robot-check-announce')).at(-1)).toBe('Đã dừng chạy.');
    expect(await said(frame, 'robot-alert-announce')).toEqual([]);

    // Teleop on and off.
    await frame.getByTestId('robot-tool-teleop').click();
    await expect.poll(async () => (await said(frame, 'robot-check-announce')).at(-1)).toBe('Đã bật lái tay. Dùng phím mũi tên hoặc W A S D để lái, phím cách để dừng.');
    await frame.getByTestId('robot-tool-teleop').click();
    await expect.poll(async () => (await said(frame, 'robot-check-announce')).at(-1)).toBe('Đã tắt lái tay.');

    // A check at 4× of a program that crashes: its start, each round's end as it ends and the result with its score; no run of the learner's.
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-stop-at-wall', 'crash-and-back-off'));
    const before = (await said(frame, 'robot-check-announce')).length;
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => (await said(frame, 'robot-check-announce')).slice(before).at(-1)).toMatch(/^Kết quả kiểm tra: Chưa đạt, \d+\/100 điểm$/);
    const check = (await said(frame, 'robot-check-announce')).slice(before);
    expect(check[0]).toBe('Đang kiểm tra…');
    expect(check.slice(1, -1).map((round) => round.replace(/, \d+ điểm$/, ''))).toEqual(['Lượt 1: Chưa đạt', 'Lượt 2: Chưa đạt', 'Lượt 3: Chưa đạt']);
    expect(check).toHaveLength(5);
    // A fast check says the start and the result (the rounds that end in the same instant are spoken as one, the last).
    await frame.getByTestId('robot-check-close').click();
    const beforeFast = (await said(frame, 'robot-check-announce')).length;
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await said(frame, 'robot-check-announce')).at(-1)).toMatch(/^Kết quả kiểm tra: /);
    const fast = (await said(frame, 'robot-check-announce')).slice(beforeFast);
    expect(fast[0]).toBe('Đang kiểm tra nhanh…');

    // A program that cannot run says why, at once, and only to the assertive region.
    const polite = (await said(frame, 'robot-check-announce')).length;
    await frame.getByTestId('robot-check-close').click();
    await frame.evaluate((document) => window.__stem?.loadProject(document), programOf('rb-stop-at-wall', brokenDrive));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-messages')).toBeVisible();
    const card = (await frame.locator('[data-testid=robot-messages] li').allInnerTexts()).join(' ');
    expect(card).not.toBe('');
    await expect.poll(async () => (await said(frame, 'robot-alert-announce')).at(-1)).toBe(card);
    expect((await said(frame, 'robot-check-announce')).length).toBe(polite);
    await screenshot(page, '01-compile-error-card.png');
    expect(errors).toEqual([]);
  });

  test('the Serial console is a labelled region of its own that never speaks, and can be reached by the keyboard', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    // A program that prints.
    await frame.evaluate((document) => window.__stem?.loadProject(document), programOf('rb-stop-at-wall', printLine('xin chào')));
    await frame.getByTestId('robot-run').click();
    const log = frame.getByTestId('console');
    await expect(log).toBeVisible();
    await expect(log).toContainText('xin chào');
    await expect(log).toHaveAttribute('role', 'log');
    await expect(log).toHaveAttribute('aria-live', 'off');
    await expect(log).toHaveAttribute('tabindex', '0');
    await expect(log).toHaveAccessibleName('Bảng in');
    expect((await liveRegions(frame)).map((region) => region.testId)).toEqual(['robot-check-announce', 'robot-alert-announce']);
    // Reached by Tab like any control (after the sound button), with the ring.
    await frame.getByTestId('robot-sound').focus();
    await page.keyboard.press('Tab');
    await expect(log).toBeFocused();
    expect(await log.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    await screenshot(page, '05-serial-console-focused.png');
  });

  test('has the 3D view as a named stop, which describes its keys, and the camera buttons say theirs', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the camera views');
    const frame = await openInLesson(page, labUrl(baseURL));
    const view = frame.getByTestId('robot-scene');
    await expect(view).toHaveAttribute('tabindex', '0');
    await expect(view).toHaveAccessibleName('Khung nhìn 3D của robot');
    await expect(view).toHaveAccessibleDescription(/^Phím: 1 Tự do, 2 Theo xe, 3 Nhìn từ trên; 0 hoặc Home đặt lại góc nhìn; \+ và − phóng to, thu nhỏ; Shift cùng các phím mũi tên để xoay\./);
    await expect(view).toHaveAccessibleDescription(/phím cách dừng\. Khi công cụ Di chuyển robot đang bật, Shift cùng các phím mũi tên dịch robot 5 cm và không xoay góc nhìn\.$/);
    await expect(view).toHaveAttribute('role', 'application');
    await expect(view).toHaveAttribute('aria-roledescription', 'khung nhìn có phím tắt');
    const buttons = frame.locator('[data-testid=robot-camera] button');
    await expect(buttons.nth(0)).toHaveAttribute('title', 'Tự do (phím 1)');
    await expect(buttons.nth(1)).toHaveAttribute('title', 'Theo xe (phím 2)');
    await expect(buttons.nth(2)).toHaveAttribute('title', 'Nhìn từ trên (phím 3)');
    await expect(buttons.nth(3)).toHaveAttribute('title', 'Đặt lại góc nhìn (phím 0 / Home)');
    // A sighted keyboard user sees the keys while the view has the focus; a click does not show them.
    await frame.getByTestId('robot-run').focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
    await expect(view).toBeFocused();
    await screenshot(page, '02-view-focused-hint.png');
    const hint = frame.getByTestId('robot-view-hint');
    expect((await hint.boundingBox())!.width).toBeGreaterThan(200);
    await frame.getByTestId('robot-run').focus();
    // Off the view it goes back to being read, not shown (a 1 px clipped box).
    expect((await hint.boundingBox())!.width).toBeLessThanOrEqual(2);
    // And a click on the view, which gives it the focus, shows nothing to the mouse.
    await frame.getByTestId('robot-canvas').click({ position: { x: 300, y: 200 } });
    expect((await hint.boundingBox())!.width).toBeLessThanOrEqual(2);
  });

  test('puts the Tab order header, the 3D view, the camera and the tools, then the program’s tabs, and traps the keyboard nowhere', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the camera views and the view tools');
    const frame = await openInLesson(page, labUrl(baseURL));
    const where = () =>
      frame.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return 'body';
        const area = active.closest('.robot-header') ? 'header' : active.closest('.robot-stage') ? 'view' : active.closest('.robot-dock') ? 'dock' : active.closest('.lab-gutter') ? 'gutter' : active.closest('.robot-program') ? 'program' : 'other';
        return `${area}: ${active.getAttribute('aria-label') ?? (active.innerText || active.getAttribute('data-testid') || active.tagName).trim().slice(0, 30)}`;
      });
    // N18 final fix I1: a check runs fast by default; this lab's learner chose 1×.
    await frame.locator('[data-testid=robot-check-speed] [data-speed="1x"]').click();
    await frame.getByTestId('robot-run').focus();
    const order = [await where()];
    for (let i = 0; i < 28; i++) {
      await page.keyboard.press('Tab');
      order.push(await where());
    }
    const areas = order.map((entry) => entry.split(':')[0]);
    // header controls, then the view (its own stop first, then the camera, the quality and view buttons, the goals, the tools), then the
    // dock, then the gutter's two stops and the program's tabs.
    expect(order.slice(0, 9)).toEqual(['header: Chạy', 'header: Bước 0,1 s', 'header: 1×', 'header: Kiểm tra', 'header: 1×', 'view: Khung nhìn 3D của robot', 'view: Tự do', 'view: Theo xe', 'view: Nhìn từ trên']);
    const first = (area: string) => areas.indexOf(area);
    expect(first('header')).toBeLessThan(first('view'));
    expect(first('view')).toBeLessThan(first('dock'));
    expect(first('dock')).toBeLessThan(first('gutter'));
    expect(first('gutter')).toBeLessThan(first('program'));
    expect(order.filter((entry) => entry.startsWith('view')).slice(-3)).toEqual(['view: Lái tay', 'view: Thước đo', 'view: Di chuyển robot']);
    expect(order).toContain('program: Khối lệnh');

    // Shift+Tab goes back the same way: nothing holds the focus.
    await frame.getByTestId('robot-scene').focus();
    await page.keyboard.press('Tab');
    expect(await where()).toBe('view: Tự do');
    await page.keyboard.press('Shift+Tab');
    expect(await where()).toBe('view: Khung nhìn 3D của robot');
    await page.keyboard.press('Shift+Tab');
    expect(await where()).toBe('header: 1×');

    // From the program's tabs on, the keyboard gets out of the lab (into the page that frames it) within a few dozen presses.
    await frame.getByRole('tab', { name: 'Khối lệnh' }).focus();
    let left = false;
    for (let i = 0; i < 80 && !left; i++) {
      await page.keyboard.press('Tab');
      left = await page.evaluate(() => document.activeElement?.tagName !== 'IFRAME');
    }
    expect(left, 'Tab leaves the lab').toBe(true);
  });

  test('has a visible focus ring of at least 3:1 on every control the Tab key reaches in the view', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the view tools');
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.getByTestId('robot-run').focus();
    const seen: string[] = [];
    for (let i = 0; i < 24 && seen.at(-1) !== 'Khối lệnh'; i++) {
      await page.keyboard.press('Tab');
      const ring = await frame.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        const style = getComputedStyle(active);
        const after = getComputedStyle(active, '::after');
        const name = active.getAttribute('aria-label') ?? (active.innerText || active.getAttribute('data-testid') || '').trim().slice(0, 30);
        return { name, outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`, after: `${after.borderTopStyle} ${after.borderTopWidth} ${after.borderTopColor}` };
      });
      const outlined = ring.outline.startsWith('solid 3px') || ring.after.startsWith('solid 3px');
      // A radio of a group that has the focus inside it is outlined by the group's arrow keys: its ring is the button's, the same.
      expect(outlined, `${ring.name}: ${ring.outline} / ${ring.after}`).toBe(true);
      const colour = ring.outline.startsWith('solid 3px') ? ring.outline.replace('solid 3px ', '') : ring.after.replace('solid 3px ', '');
      expect(contrastRatio(colour, '#ffffff'), ring.name).toBeGreaterThanOrEqual(3);
      seen.push(ring.name);
    }
    expect(seen).toContain('Khung nhìn 3D của robot');
    expect(seen).toContain('Lái tay');
  });

  test('keeps the text over the 3D view and in the controls at AA contrast: idle, in a run, with the tools open and over a result, on both graphics', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the quality button and the view tools');
    test.setTimeout(240_000);
    const frame = await openInLesson(page, labUrl(baseURL));
    await expectContrast(frame, 'idle');
    await screenshot(page, '03-idle-1100x640.png');

    // The other quality tier: the cards over the view are the same, over a different picture.
    const tier = (await frame.getByTestId('robot-quality').getAttribute('data-tier')) === 'high' ? 'low' : 'high';
    await frame.getByTestId('robot-quality').click();
    await expect(frame.getByTestId('robot-quality')).toHaveAttribute('data-tier', tier);
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 30_000 });
    await expectContrast(frame, `idle on ${tier} graphics`);

    await frame.getByTestId('robot-tool-teleop').click();
    await frame.getByTestId('robot-tool-ruler').click();
    await expectContrast(frame, 'tools: teleop and ruler');
    await frame.getByTestId('robot-tool-teleop').click();
    await frame.getByTestId('robot-tool-move').click();
    await expectContrast(frame, 'tools: move');
    await frame.getByTestId('robot-tool-move').click();

    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    await frame.evaluate(() => window.__stem?.robot.setSpeed(4));
    await frame.getByTestId('robot-run').click();
    // At most 8 ticks a drawn frame: t > 2 takes 30 frames, which SwiftShader's high tier draws slowly under a suite's load (N18 P2).
    await expect.poll(async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { t: number } | null)?.t ?? 0, { timeout: 150_000 }).toBeGreaterThan(2);
    await expectContrast(frame, 'a run');
    // The program's other tabs while the robot runs (their values are live): the C++ source with its marked line, the ports and pins.
    await frame.getByRole('tab', { name: 'Cổng & chân' }).click();
    await expect(frame.getByTestId('hub-table')).toBeVisible();
    await expectContrast(frame, 'ports and pins during a run');
    await frame.getByRole('tab', { name: 'C++' }).click();
    await expect(frame.getByTestId('cpp-source')).toBeVisible();
    await expectContrast(frame, 'C++ during a run');
    await frame.getByRole('tab', { name: 'Khối lệnh' }).click();
    await frame.getByTestId('robot-stop').click();
    await frame.getByRole('tab', { name: 'Cổng & chân' }).click();
    await expectContrast(frame, 'ports and pins after a run');
    await frame.getByRole('tab', { name: 'Khối lệnh' }).click();

    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-stop-at-wall', 'crash-and-back-off'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    await expectContrast(frame, 'a failed check');
    await screenshot(page, '04-check-result-1100x640.png');
  });

  test('takes the focus to the result’s heading when a check ends, and gives it back to Kiểm tra when the result is closed with Escape or ×', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    // By the keyboard, as a keyboard user does: Kiểm tra has the focus when it is pressed.
    await frame.getByTestId('robot-check-start').focus();
    await page.keyboard.press('Enter');
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    await expect(frame.getByTestId('robot-check-heading')).toBeFocused();
    await expect(frame.getByTestId('robot-check-heading')).toHaveText('Kết quả kiểm tra');
    await screenshot(page, '06-result-heading-focused.png');
    await page.keyboard.press('Escape');
    await expect(frame.getByTestId('robot-check-results')).toHaveCount(0);
    await expect(frame.getByTestId('robot-check-start')).toBeFocused();

    // Again, closed with its × button.
    await page.keyboard.press('Enter');
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    await expect(frame.getByTestId('robot-check-heading')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(frame.getByTestId('robot-check-fold')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(frame.getByTestId('robot-check-close')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(frame.getByTestId('robot-check-results')).toHaveCount(0);
    await expect(frame.getByTestId('robot-check-start')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('does not take the focus from the page for a check that ends while the learner is elsewhere', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="4x"]').click();
    await frame.getByTestId('robot-check-start').click();
    // The learner goes to the lesson's page and types there while the check runs.
    await page.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'lesson-field';
      document.body.prepend(field);
      field.focus();
    });
    await expect(frame.getByTestId('robot-check-results')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#lesson-field')).toBeFocused();
    await page.keyboard.type('abc');
    await expect(page.locator('#lesson-field')).toHaveValue('abc');
  });

  test('closes the message card with Escape and gives the focus back to the view', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    await frame.evaluate((document) => window.__stem?.loadProject(document), programOf('rb-stop-at-wall', brokenDrive));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-messages')).toBeVisible();
    await frame.locator('.robot-messages-close').focus();
    await page.keyboard.press('Escape');
    await expect(frame.getByTestId('robot-messages')).toHaveCount(0);
    // The 3D view's stop, which is named, and not the stage.
    await expect(frame.getByTestId('robot-scene')).toBeFocused();
    await expect(frame.getByTestId('robot-scene')).toHaveAccessibleName('Khung nhìn 3D của robot');
  });

  test('Escape in a result card closes the card and not Lái tay, which is on', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'teleop (Lái tay)');
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.evaluate((document) => window.__stem?.loadProject(document), projectOf('rb-drive-to-zone', 'reference'));
    await frame.locator('[data-testid=robot-check-speed] [data-speed="fast"]').click();
    await frame.getByTestId('robot-check-start').click();
    await expect(frame.getByTestId('robot-check-heading')).toBeFocused({ timeout: 60_000 });
    await frame.getByTestId('robot-tool-teleop').click();
    await expect(frame.getByTestId('robot-tool-teleop')).toHaveAttribute('aria-pressed', 'true');
    await frame.getByTestId('robot-check-heading').focus();
    await page.keyboard.press('Escape');
    await expect(frame.getByTestId('robot-check-results')).toHaveCount(0);
    await expect(frame.getByTestId('robot-tool-teleop')).toHaveAttribute('aria-pressed', 'true');
    await expect(frame.getByTestId('robot-teleop')).toBeVisible();
  });

  test('the covered 3D view is no Tab stop, has no name or hint, while the 2D map stands in for graphics that are gone; a card closed there gives the focus to the named map', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-stop-at-wall'));
    // The browser takes the WebGL context away and does not give it back (the extension is taken before it goes: a lost context has none).
    await frame.evaluate(() => {
      const canvas = document.querySelector('[data-testid=robot-canvas] canvas') as HTMLCanvasElement;
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGL2RenderingContext;
      const extension = gl.getExtension('WEBGL_lose_context')!;
      (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext = extension;
      extension.loseContext();
    });
    await expect(frame.getByTestId('robot-topview')).toBeVisible({ timeout: 30_000 });
    const view = frame.getByTestId('robot-scene');
    for (const attribute of ['tabindex', 'role', 'aria-label', 'aria-roledescription', 'aria-describedby', 'data-view-focus']) {
      await expect(view).not.toHaveAttribute(attribute, /.*/);
    }
    await expect(view).toHaveAttribute('inert', '');
    await expect(frame.getByTestId('robot-view-hint')).toHaveCount(0);
    // Tab walks the lab and never lands on it.
    await frame.getByTestId('robot-run').focus();
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab');
      expect(await frame.evaluate(() => document.activeElement?.closest('[data-testid=robot-scene]') ?? null), `Tab ${i + 1}`).toBeNull();
    }
    // A card closed over the map: the focus goes to the map, which is named.
    await frame.evaluate((document) => window.__stem?.loadProject(document), programOf('rb-stop-at-wall', brokenDrive));
    await frame.getByTestId('robot-run').click();
    await expect(frame.getByTestId('robot-messages')).toBeVisible();
    await frame.locator('.robot-messages-close').focus();
    await page.keyboard.press('Escape');
    await expect(frame.getByTestId('robot-messages')).toHaveCount(0);
    await expect(frame.getByTestId('robot-topview')).toBeFocused();
    await expect(frame.getByTestId('robot-topview')).toHaveAccessibleName(/Bản đồ 2D/);
    // And when the graphics return, the view is a stop again.
    await frame.evaluate(() => (window as unknown as { __loseContext: WEBGL_lose_context }).__loseContext.restoreContext());
    await expect(frame.getByTestId('robot-topview')).toHaveCount(0);
    await expect(view).toHaveAttribute('tabindex', '0');
    await expect(view).toHaveAttribute('role', 'application');
    await expect(view).not.toHaveAttribute('inert', /.*/);
    await expect(frame.getByTestId('robot-view-hint')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('ends Lái tay with Escape, as it clears the ruler', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'teleop (Lái tay) and the ruler');
    const frame = await openInLesson(page, labUrl(baseURL));
    await recordSaid(frame);
    await frame.getByTestId('robot-tool-teleop').click();
    await expect(frame.getByTestId('robot-teleop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(frame.getByTestId('robot-teleop')).toHaveCount(0);
    await expect(frame.getByTestId('robot-tool-teleop')).toHaveAttribute('aria-pressed', 'false');
    expect((await said(frame, 'robot-check-announce')).at(-1)).toBe('Đã tắt lái tay.');
  });
});

test.describe('the camera by keyboard (N18 R8)', () => {
  /** The camera as the canvas says it: distance (m), turn about the vertical and angle from the vertical (degrees). */
  const camera = async (frame: Frame) => {
    const value = await frame.locator('[data-testid=robot-canvas] canvas').getAttribute('data-camera');
    const [distance, azimuth, polar] = (value ?? '0 0 0').split(' ').map(Number);
    return { distance: distance!, azimuth: azimuth!, polar: polar! };
  };
  /**
   * Waits until the camera stops moving (a glide has ended): the same pose twice, with two animation frames between the reads, so that a
   * machine that draws a frame in a second (SwiftShader under a suite's load) cannot look settled for want of a frame in which to move.
   */
  const settled = async (frame: Frame) => {
    let last = '';
    const read = async () => (await frame.locator('[data-testid=robot-canvas] canvas').getAttribute('data-camera')) ?? '';
    await expect
      .poll(
        async () => {
          const now = await read();
          await frame.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          const later = await read();
          const same = now === later && now === last;
          last = later;
          return same;
        },
        { timeout: 30_000, intervals: [300] },
      )
      .toBe(true);
    return camera(frame);
  };
  const pressed = (frame: Frame) => frame.locator('[data-testid=robot-camera] [data-mode][aria-pressed=true]').getAttribute('data-mode');

  test('1, 2 and 3 choose the views, 0 and Home put the view back, + and − zoom, Shift with the arrows orbit, and each says what it did', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the camera views (robot-lab-basic.spec.ts has its one camera’s keys)');
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL));
    await recordSaid(frame);
    const view = frame.getByTestId('robot-scene');
    await view.focus();
    const start = await settled(frame);
    expect(await pressed(frame)).toBe('orbit');

    await page.keyboard.press('2');
    expect(await pressed(frame)).toBe('follow');
    await page.keyboard.press('3');
    expect(await pressed(frame)).toBe('top');
    const top = await settled(frame);
    expect(top.polar).toBeLessThan(2);
    await page.keyboard.press('1');
    expect(await pressed(frame)).toBe('orbit');
    expect(await said(frame, 'robot-check-announce')).toEqual(['Góc nhìn: Theo xe.', 'Góc nhìn: Nhìn từ trên.', 'Góc nhìn: Tự do.']);
    const orbit = await settled(frame);
    expect(Math.abs(orbit.distance - start.distance)).toBeLessThan(0.01);

    // + brings the camera in by a share of its distance, − takes it out again.
    await page.keyboard.press('+');
    const closer = await settled(frame);
    expect(closer.distance / orbit.distance).toBeCloseTo(0.85, 2);
    await page.keyboard.press('=');
    expect((await settled(frame)).distance / closer.distance).toBeCloseTo(0.85, 2);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    expect((await settled(frame)).distance / orbit.distance).toBeCloseTo(1, 2);
    // It stops at the view's limits: held, it never goes through the floor or the table.
    for (let i = 0; i < 30; i++) await page.keyboard.press('+');
    expect((await settled(frame)).distance).toBeGreaterThanOrEqual(0.11);

    // 0 puts the view back where it started; so does Home.
    await page.keyboard.press('0');
    const again = await settled(frame);
    expect(Math.abs(again.distance - start.distance)).toBeLessThan(0.01);
    expect(Math.abs(again.azimuth - start.azimuth)).toBeLessThan(0.5);
    // Shift with an arrow swings the camera 7.5° round (right: the turn grows) and raises or sinks it.
    await page.keyboard.press('Shift+ArrowRight');
    const right = await settled(frame);
    expect(right.azimuth - again.azimuth).toBeCloseTo(7.5, 0);
    // The canvas says the pose rounded to a thousandth, and this view's distance sits on a rounding edge (1.7835): the float noise of an orbit
    // reads 1.783 or 1.784, which `toBeCloseTo(…, 3)` (a difference under 0.0005) takes for a change. It is the same distance to 0.005.
    expect(right.distance).toBeCloseTo(again.distance, 2);
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    expect((await settled(frame)).azimuth - again.azimuth).toBeCloseTo(-7.5, 0);
    await page.keyboard.press('Shift+ArrowUp');
    expect((await settled(frame)).polar - again.polar).toBeCloseTo(-7.5, 0);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    expect((await settled(frame)).polar - again.polar).toBeCloseTo(7.5, 0);
    for (let i = 0; i < 30; i++) await page.keyboard.press('Shift+ArrowDown');
    expect((await settled(frame)).polar).toBeLessThanOrEqual(85.01);
    await page.keyboard.press('Home');
    const home = await settled(frame);
    expect(Math.abs(home.polar - start.polar)).toBeLessThan(0.5);
    expect(await said(frame, 'robot-check-announce')).toContain('Đã đặt lại góc nhìn.');
    await screenshot(page, '07-camera-keys-orbited.png');
    expect(errors).toEqual([]);
  });

  test('takes the keys only when the 3D view has the focus: not from a button, a field or the program’s editor, and a plain arrow is the robot’s', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the camera views');
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.getByTestId('robot-scene').focus();
    const start = await settled(frame);
    // The camera's own button has the focus: the key is not the camera's.
    await frame.locator('[data-testid=robot-camera] [data-mode=orbit]').focus();
    await page.keyboard.press('3');
    await page.keyboard.press('+');
    expect(await pressed(frame)).toBe('orbit');
    expect((await settled(frame)).distance).toBeCloseTo(start.distance, 3);
    // A field in the view: typed text is its own.
    await frame.evaluate(() => {
      const field = document.createElement('input');
      field.id = 'typed';
      document.querySelector('.robot-stage')!.append(field);
      field.focus();
    });
    await page.keyboard.type('23+-0');
    await expect(frame.locator('#typed')).toHaveValue('23+-0');
    expect(await pressed(frame)).toBe('orbit');
    // The program's editor: a click on its workspace, then the keys.
    await frame.locator('.blocklyMainBackground').first().click({ position: { x: 300, y: 300 } });
    await page.keyboard.press('2');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await pressed(frame)).toBe('orbit');
    // A plain arrow on the view is not an orbit.
    await frame.getByTestId('robot-scene').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    expect((await settled(frame)).azimuth).toBeCloseTo(start.azimuth, 1);
    expect(await frame.evaluate(() => window.__stem?.robot.getSnapshot())).toBeNull();
  });

  test('in Lái tay the plain arrows drive the robot and Shift with them orbits the camera instead', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'teleop (Lái tay)');
    const frame = await openInLesson(page, labUrl(baseURL));
    await frame.getByTestId('robot-tool-teleop').click();
    await expect.poll(async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { status: string } | null)?.status, { timeout: 30_000 }).toBe('running');
    const pose = async () => ((await frame.evaluate(() => window.__stem?.robot.getSnapshot())) as { robot: { xCm: number; yCm: number; yawDeg: number } }).robot;
    const before = await pose();
    const start = await settled(frame);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const swung = await settled(frame);
    expect(swung.azimuth - start.azimuth).toBeCloseTo(15, 0);
    await page.waitForTimeout(400);
    const still = await pose();
    expect(Math.abs(still.xCm - before.xCm)).toBeLessThan(0.05);
    expect(Math.abs(still.yawDeg - before.yawDeg)).toBeLessThan(0.05);
    // A plain arrow drives (the view has the focus since the toggle gave it).
    await page.keyboard.down('ArrowUp');
    await expect.poll(async () => (await pose()).xCm, { timeout: 60_000 }).toBeGreaterThan(before.xCm + 5);
    await page.keyboard.up('ArrowUp');
    // And the camera did not turn for it.
    expect((await settled(frame)).azimuth).toBeCloseTo(swung.azimuth, 0);
  });

  test('reduced motion: the camera jumps to a view where it otherwise glides for a moment', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the camera views');
    const frame = await openInLesson(page, labUrl(baseURL));
    await settled(frame);
    // How many times the camera is reported to have moved while it goes to the top view.
    await frame.evaluate(() => {
      const canvas = document.querySelector('[data-testid=robot-canvas] canvas')!;
      const w = window as unknown as { __moves: number };
      w.__moves = 0;
      new MutationObserver(() => w.__moves++).observe(canvas, { attributes: true, attributeFilter: ['data-camera'] });
    });
    const moves = async (mode: 'top' | 'orbit') => {
      await frame.evaluate(() => ((window as unknown as { __moves: number }).__moves = 0));
      await frame.locator(`[data-testid=robot-camera] [data-mode=${mode}]`).click();
      await page.waitForTimeout(1200);
      return frame.evaluate(() => (window as unknown as { __moves: number }).__moves);
    };
    // The glide takes 0.45 s: the camera is seen at many places on the way.
    expect(await moves('top')).toBeGreaterThanOrEqual(5);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await moves('orbit')).toBeLessThanOrEqual(2);
    expect(await moves('top')).toBeLessThanOrEqual(2);
    // The reset jumps as well.
    await frame.evaluate(() => ((window as unknown as { __moves: number }).__moves = 0));
    await frame.getByTestId('robot-camera-reset').click();
    await page.waitForTimeout(800);
    expect(await frame.evaluate(() => (window as unknown as { __moves: number }).__moves)).toBeLessThanOrEqual(2);
  });
});

test.describe('the zones’ patterns on the 2D map (N18 R8)', () => {
  test('the start is dotted, a target hatched and a checkpoint plain, each in its zone’s ink', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'rb-mini-mission');
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-mini-mission'));
    await frame.getByTestId('robot-viewmode').click();
    await expect(frame.getByTestId('robot-topview')).toBeVisible();
    // The HUD and the tools float over the map: fold the HUD away so that the zones show.
    await page.waitForTimeout(500);
    const zones = readJson('../src/samples/robot-scenarios/rb-mini-mission.json').arena.paint.zones as { kind: string; color: string }[];
    const ink = (kind: string) => patternInk(zones.find((zone) => zone.kind === kind)!.color, 'screen');
    const png = decodePng(await frame.getByTestId('robot-topview').screenshot());
    const near = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
      let count = 0;
      for (let i = 0; i < png.data.length; i += png.channels) {
        if (Math.abs(png.data[i]! - r!) <= 10 && Math.abs(png.data[i + 1]! - g!) <= 10 && Math.abs(png.data[i + 2]! - b!) <= 10) count++;
      }
      return count;
    };
    const counts = { start: near(ink('start')), target: near(ink('target')), checkpoint: near(ink('checkpoint')) };
    expect(counts.start, 'dots on the start').toBeGreaterThan(30);
    expect(counts.target, 'hatching on the target').toBeGreaterThan(60);
    // Nothing on a checkpoint: its ink turns up only by chance (an edge of the tape or of an object blends to it), a few pixels against the hundreds of a pattern.
    expect(counts.checkpoint, `nothing on a checkpoint (${JSON.stringify(counts)})`).toBeLessThan(Math.min(counts.start, counts.target) / 10);
    await screenshot(page, '08-zone-patterns-2d-map.png');
    expect(errors).toEqual([]);
  });

  test('are on the 3D mat too: the views a learner opens are drawn with it (screenshots for the report; the texture is held by mat-paint.patterns.test.ts)', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'rb-mini-mission and the camera views');
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, 'rb-mini-mission'));
    await expect(frame.locator('[data-testid=robot-canvas] canvas')).toHaveAttribute('data-models', 'modelled');
    await frame.locator('[data-testid=robot-camera] [data-mode=top]').click();
    await page.waitForTimeout(800);
    await screenshot(page, '09-zone-patterns-3d-top-view.png');
    await frame.locator('[data-testid=robot-camera] [data-mode=orbit]').click();
    await page.waitForTimeout(800);
    await screenshot(page, '10-zone-patterns-3d-free-view.png');
    expect(errors).toEqual([]);
  });
});

test.describe('the lab at a browser zoom of 200 % (N18 R8)', () => {
  // A 1100 x 640 window zoomed to 200 % shows the page 550 x 320 CSS pixels at twice the pixel ratio.
  test.use({ deviceScaleFactor: 2 });

  test('keeps every control whole and in reach at 550 x 320 CSS pixels: no scrolling sideways, none clipped, the 3D view shrinks', async ({ page, baseURL }) => {
    basicSkip(test.skip, 'the view tools');
    const errors = collectErrors(page);
    const lesson = new URL('/lesson', lessonOrigin);
    lesson.searchParams.set('lab', labUrl(baseURL));
    await page.goto(lesson.href);
    await page.evaluate(() => {
      const frame = document.querySelector('iframe')!;
      frame.width = '550';
      frame.height = '320';
    });
    const frame = await frameOf(page);
    await frame.getByTestId('robot-lab').waitFor();
    await pinLowTierChainOff(frame);
    expect(await frame.evaluate(() => [innerWidth, innerHeight, devicePixelRatio])).toEqual([550, 320, 2]);

    /** The controls of the frame: where they are, whether the part of them in view is the whole of them, and whether the page can scroll to them. */
    const audit = (where: string) =>
      frame.evaluate((label) => {
        const doc = document.documentElement;
        const problems: string[] = [];
        const lab = document.querySelector<HTMLElement>('.robot-lab')!;
        if (lab.scrollWidth > lab.clientWidth + 1) problems.push(`the lab scrolls sideways: ${lab.scrollWidth} of ${lab.clientWidth}`);
        const controls = [...document.querySelectorAll<HTMLElement>('.robot-lab button, .robot-lab [role=radio], .robot-lab [role=tab], .robot-lab input, .robot-lab summary')].filter(
          (element) => !element.closest('.robot-program-pane[data-shown=false], [inert], [hidden], .blocklyDiv, .injectionDiv') && getComputedStyle(element).visibility !== 'hidden',
        );
        for (const element of controls) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const name = element.getAttribute('aria-label') ?? (element.innerText || element.dataset.testid || element.tagName).trim().slice(0, 30);
          if (rect.left < -0.5 || rect.right > innerWidth + 0.5) problems.push(`${name}: sideways ${Math.round(rect.left)}..${Math.round(rect.right)} of ${innerWidth}`);
          // Clipped by an ancestor that hides what overflows it.
          for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (/(hidden|clip)/.test(style.overflowX + style.overflowY)) {
              const box = ancestor.getBoundingClientRect();
              if (rect.left < box.left - 1 || rect.right > box.right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) problems.push(`${name}: clipped by ${ancestor.className || ancestor.tagName}`);
              break;
            }
          }
        }
        return { label, scrollsSideways: doc.scrollWidth > innerWidth + 1, scrollsDown: lab.scrollHeight > lab.clientHeight + 1, controls: controls.length, problems };
      }, where);

    const program = await audit('program tab');
    expect(program.scrollsSideways).toBe(false);
    expect(program.problems, 'program tab').toEqual([]);
    await screenshot(page, '11-zoom-200-program-tab.png');
    await frame.getByTestId('robot-run').click();
    await frame.locator('[data-testid=robot-scene][data-drawn=true]').waitFor({ timeout: 60_000 });
    const robot = await audit('robot tab');
    await screenshot(page, '12-zoom-200-robot-tab.png');
    expect(robot.scrollsSideways).toBe(false);
    expect(robot.problems, 'robot tab').toEqual([]);
    // The window is too short for the lab: it scrolls, and the 3D view keeps room for the controls over it (the workspace is 460, less the tabs and the dock).
    expect(robot.scrollsDown).toBe(true);
    expect((await frame.locator('.robot-stage').boundingBox())!.height).toBeGreaterThanOrEqual(320);
    await frame.getByTestId('robot-tool-teleop').click();
    const tools = await audit('robot tab with the pad');
    await screenshot(page, '13-zoom-200-pad-open.png');
    expect(tools.problems, 'robot tab with the pad').toEqual([]);
    expect(errors).toEqual([]);
  });
});
