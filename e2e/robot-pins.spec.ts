import { expect, test, type Frame, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { robotSolutions } from '../src/samples/robot-solutions';
import { robotStarterDocument } from '../src/samples/robot-templates';
import { pinLowTierChainOff } from './robot-chain';

// N18 R4.5: the robot lab's C++ and Cổng & chân tabs in the 1100 x 640 frame of a lesson page. The ports & pins tab is the hub panel: it
// follows a run of the drive-to-zone lesson (the live percent of each motor, the pins D5 PWM 128, D7 HIGH, D8 LOW, the board's pads, the
// table) and the C++ tab shows the golden sketch of the lesson's reference solution, marks the block the robot is in, copies and
// downloads it. The screenshots go to R45_SHOTS_DIR (the report's), or under test-results.

const lessonOrigin = 'http://lesson.localhost:5190';
const shots = process.env.R45_SHOTS_DIR ?? join('test-results', 'robot-pins');
const golden = readFileSync(join(import.meta.dirname, '..', 'tests', 'robot-solutions', 'rb-drive-to-zone.ino'), 'utf8');

const labUrl = (baseURL: string | undefined, query: string) => new URL(`/?embed=1&${query}`, baseURL).href;
const solved = () => ({ ...robotStarterDocument('rb-drive-to-zone'), program: { blocks: robotSolutions['rb-drive-to-zone'].reference } });

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.getByTestId('robot-lab').waitFor();
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

const screenshot = async (page: Page, name: string) => {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name) });
};

/** Whether a tab's pane scrolls sideways, or the page does (neither may). */
const overflowsSideways = (frame: Frame, testId: string) =>
  frame.evaluate((id) => {
    const element = document.querySelector(`[data-testid=${id}]`);
    const page = document.scrollingElement;
    return { pane: element === null ? null : element.scrollWidth > element.clientWidth, page: page === null ? null : page.scrollWidth > page.clientWidth };
  }, testId);

const tab = (frame: Frame, name: string) => frame.getByRole('tab', { name, exact: true });

// N18 bt-lab-fix: under a suite's load SwiftShader draws a run slowly (at most 8 ticks a drawn frame), so the waits in this file are for a
// condition, not for a time, and a test's own limit is for a hang, not for a busy machine.
test.describe.configure({ timeout: 120_000 });

test.describe('the ports & pins and C++ tabs of the robot lab (N18 R4.5)', () => {
  test('Cổng & chân follows a run of the drive-to-zone lesson: the live motor %, the pins, the board and the table, then the stopped motors', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`));

    // Before a run: the kit's wiring, with no values.
    await tab(frame, 'Cổng & chân').click();
    await expect(frame.getByTestId('pin-inspector')).toHaveAttribute('data-live', 'false');
    await expect(frame.getByTestId('hub-value-motorLeft')).toHaveText('—');
    await expect(frame.getByTestId('hub-row-motorLeft')).toContainText('M1');
    await expect(frame.getByTestId('hub-pad-D5')).toHaveAttribute('data-state', 'idle');
    await expect(frame.getByTestId('hub-part-D5')).toHaveText('Motor trái EN');
    await screenshot(page, '01-pins-idle-1100x640.png');

    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await frame.getByTestId('robot-run').click();

    // The robot drives both motors at 50 %: D5 carries PWM 128 with D7 HIGH and D8 LOW, as the plan says.
    await expect(frame.getByTestId('pin-inspector')).toHaveAttribute('data-live', 'true');
    await expect(frame.getByTestId('hub-value-motorLeft')).toHaveText('50 %');
    await expect(frame.getByTestId('hub-value-motorRight')).toHaveText('50 %');
    await expect(frame.getByTestId('hub-direction-motorLeft')).toHaveText('tiến');
    await expect(frame.getByTestId('hub-row-motorLeft')).toHaveAttribute('title', 'Motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW');
    await expect(frame.getByTestId('hub-chip-D5')).toHaveText('D5ENPWM 128');
    await expect(frame.getByTestId('hub-chip-D7')).toHaveText('D7IN1HIGH');
    await expect(frame.getByTestId('hub-chip-D8')).toHaveText('D8IN2LOW');
    await expect(frame.getByTestId('hub-pad-D5')).toHaveAttribute('data-state', 'pwm');
    await expect(frame.getByTestId('hub-pad-D7')).toHaveAttribute('data-state', 'high');
    await expect(frame.getByTestId('hub-pad-D8')).toHaveAttribute('data-state', 'low');
    await screenshot(page, '02-pins-running-1100x640.png');

    // The names of the parts, with the signal of a pin when its part has several, stay inside the drawing: the text of each starts at
    // its pin and runs up (above the board) or down (below it), and the drawing has room for the longest.
    await expect(frame.getByTestId('hub-part-D7')).toHaveText('Motor trái IN1');
    await expect(frame.getByTestId('hub-part-D11')).toHaveText('Siêu âm ECHO');
    const labels = await frame.locator('[data-testid=hub-board] .hub-pad-part').evaluateAll((elements) => {
      const svg = (elements[0] as unknown as SVGGraphicsElement | undefined)?.ownerSVGElement;
      const height = svg?.viewBox.baseVal.height ?? 0;
      return elements.map((element) => {
        const text = element as unknown as SVGTextElement;
        const length = text.getComputedTextLength();
        const start = Number(text.getAttribute('y'));
        const upward = /rotate\(-90/.test(text.getAttribute('transform') ?? '');
        return { name: text.textContent, room: upward ? start : height - start, length };
      });
    });
    expect(labels).toHaveLength(15);
    for (const label of labels) {
      expect(label.length, label.name ?? '').toBeLessThanOrEqual(label.room);
    }

    // The cards and the table are under the board: the pane scrolls down to them.
    await frame.getByTestId('hub-table').scrollIntoViewIfNeeded();
    await screenshot(page, '02b-pins-table-1100x640.png');
    await frame.getByTestId('hub-board').scrollIntoViewIfNeeded();

    // No sideways scroll, in the pane or in the page.
    expect(await overflowsSideways(frame, 'pin-inspector')).toEqual({ pane: false, page: false });

    // The program ends with a stop: the motors read 0 % and stopped.
    await expect(frame.getByTestId('hub-value-motorLeft')).toHaveText('0 %', { timeout: 60_000 });
    await expect(frame.getByTestId('hub-direction-motorLeft')).toHaveText('dừng');
    await expect(frame.getByTestId('hub-pad-D5')).toHaveAttribute('data-state', 'low');

    // Đặt lại clears the values: the mapping stays.
    await frame.getByTestId('robot-stop').click();
    await frame.getByTestId('robot-reset').click();
    await expect(frame.getByTestId('hub-value-motorLeft')).toHaveText('—');
    await expect(frame.getByTestId('hub-row-motorLeft')).toHaveAttribute('title', 'Motor trái → M1 → D5, D7, D8');
    expect(errors).toEqual([]);
  });

  test('C++ shows the golden sketch of the lesson’s reference solution, marks the block the robot is in, and downloads it', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await tab(frame, 'C++').click();

    await expect(frame.getByTestId('cpp-source')).toBeVisible();
    expect(await frame.getByTestId('cpp-source').textContent()).toBe(golden);
    await expect(frame.getByTestId('cpp-file')).toHaveText('rb-drive-to-zone.ino');
    await expect(frame.getByTestId('cpp-footer')).toContainText('arduino-cli');
    await screenshot(page, '03-cpp-idle-1100x640.png');

    // A click on a block of the editor marks its lines in the C++ tab (the purple band; the running block's is the green one). Blockly
    // drops its selection when the focus goes to the tab, and the tab goes on marking the last block selected.
    await tab(frame, 'Khối lệnh').click();
    await frame.locator('[data-testid=blockly-panel] g.blocklyDraggable[data-id="drive-time"]').click({ position: { x: 10, y: 10 } });
    await tab(frame, 'C++').click();
    const selected = frame.locator('[data-testid=cpp-source] [data-selected=true]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveText('  delay(5000L);');
    await expect(frame.locator('[data-testid=cpp-source] [data-running=true]')).toHaveCount(0);
    await screenshot(page, '03b-cpp-selected-1100x640.png');

    // The robot waits 5 s inside the wait block: its line is the marked one.
    await frame.getByTestId('robot-run').click();
    const running = frame.locator('[data-testid=cpp-source] [data-running=true]');
    await expect(running).toHaveCount(1);
    await expect(running).toHaveText('  delay(5000L);');
    await screenshot(page, '04-cpp-running-1100x640.png');
    await frame.getByTestId('robot-stop').click();

    // The download is the same sketch, named for the lesson.
    const download = page.waitForEvent('download');
    await frame.getByTestId('cpp-download').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('rb-drive-to-zone.ino');
    const path = await file.path();
    expect(readFileSync(path, 'utf8')).toBe(golden);
    expect(await overflowsSideways(frame, 'cpp-tab')).toEqual({ pane: false, page: false });
    expect(errors).toEqual([]);
  });

  test('a program that does not compile shows why in the C++ tab, not an older sketch', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=robot&template=rb-drive-to-zone&origin=${encodeURIComponent(lessonOrigin)}`));
    await frame.evaluate((document) => window.__stem?.loadProject(document), solved());
    await tab(frame, 'C++').click();
    await expect(frame.getByTestId('cpp-source')).toBeVisible();
    const broken = solved();
    broken.program = { blocks: { blocks: { languageVersion: 0, blocks: [{ type: 'stem_on_start', id: 'on-start', x: 40, y: 40, inputs: { DO: { block: { type: 'ybc_wait_ms', id: 'w', inputs: { MS: { shadow: { type: 'math_number', id: 'n', fields: { NUM: 2 ** 40 } } } } } } } }] } } };
    await frame.evaluate((document) => window.__stem?.loadProject(document), broken);
    await expect(frame.getByTestId('cpp-diagnostics')).toBeVisible();
    await expect(frame.getByTestId('cpp-source')).toHaveCount(0);
    await expect(frame.getByTestId('cpp-copy')).toBeDisabled();
  });
});

test.describe('the tabs in a narrow frame (N18 R4.5)', () => {
  test.use({ viewport: { width: 760, height: 640 } });

  test('neither tab scrolls sideways at 760 px, and Copy puts the sketch on the clipboard', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(labUrl(baseURL, 'lab=robot&template=rb-drive-to-zone'));
    await page.getByTestId('robot-lab').waitFor();
    await page.evaluate((document) => window.__stem?.loadProject(document), solved());
    // Under 800 px the program and the robot are two tabs of their own: Chương trình holds C++ and Cổng & chân.
    await page.getByRole('tab', { name: 'Chương trình', exact: true }).click();
    await page.getByRole('tab', { name: 'Cổng & chân', exact: true }).click();
    await expect(page.getByTestId('hub-board')).toBeVisible();
    const sideways = (testId: string) =>
      page.evaluate((id) => {
        const element = document.querySelector(`[data-testid=${id}]`);
        const scrolling = document.scrollingElement;
        return { pane: element === null ? null : element.scrollWidth > element.clientWidth, page: scrolling === null ? null : scrolling.scrollWidth > scrolling.clientWidth };
      }, testId);
    expect(await sideways('pin-inspector')).toEqual({ pane: false, page: false });
    await screenshot(page, '05-pins-760x640.png');
    await page.getByRole('tab', { name: 'C++', exact: true }).click();
    await expect(page.getByTestId('cpp-source')).toBeVisible();
    expect(await sideways('cpp-tab')).toEqual({ pane: false, page: false });
    await screenshot(page, '06-cpp-760x640.png');
    await page.getByTestId('cpp-copy').click();
    await expect(page.getByTestId('cpp-copy')).toHaveText('Đã chép');
    // The Windows clipboard turns LF into CRLF; the text is otherwise the file.
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(golden);
  });
});
