import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectDocumentSchema } from '../src/core/circuit/document';
import { playNote, program } from '../src/core/program/__fixtures__/ybc-blocks';
import { ybcSolutionDocument, type YbcLessonKey } from '../src/samples/ybc-solutions';
import { ybcStarterDocument, type YbcTemplateKey } from '../src/samples/ybc-templates';

// N6a: the labs the LMS launches (`lab=`), in the lesson page of e2e/lesson-host.mjs, which records what the lab
// says over stem-lab/v1 and can answer it. Spec §12: open a Yolo:Bit lab, press Kiểm tra, receive check-result.

const lessonOrigin = 'http://lesson.localhost:5190';

/** The template as the lab opens it (templates.ts imports JSON, which Playwright's loader does not take). */
const starter = (key: YbcTemplateKey) => projectDocumentSchema.parse(ybcStarterDocument(key));

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
  await frame.waitForFunction(() => window.__stem?.getCanvasState() != null);
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

test.describe('a Yolo:Bit lab in a lesson (stem-lab/v1)', () => {
  test('says ready, checks the starter (not passed), loads the host’s project and checks it (passed)', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const labOrigin = new URL(baseURL ?? '').origin;
    const frame = await openInLesson(page, labUrl(baseURL, `lab=yolobit&template=ybc-heart&origin=${encodeURIComponent(lessonOrigin)}&profile=ybc-basic`));

    // ready: the template, its profile and the goals, from the lab's origin.
    await expect.poll(() => messagesOfType(page, 'ready')).toEqual([
      {
        origin: labOrigin,
        data: { protocol: 'stem-lab/v1', type: 'ready', template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'shows-heart', label: 'Màn hình hiện hình trái tim' }] },
      },
    ]);

    // The lab's chrome, in Vietnamese: no New, a Check button, the goals.
    await expect(frame.getByRole('heading', { name: 'Mạch Yolo:Bit' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Mới' })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'New' })).toHaveCount(0);
    await expect(frame.getByTestId('goal-shows-heart')).toHaveAttribute('data-state', 'todo');
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'hiển thị hình' })).toBeVisible();
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'khi bắt đầu' })).toBeVisible();

    // The starter's heart is loose: the check runs it and does not pass.
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(1);
    expect((await messagesOfType(page, 'check-result'))[0]?.data).toEqual({
      protocol: 'stem-lab/v1',
      type: 'check-result',
      passed: false,
      goals: [{ id: 'shows-heart', label: 'Màn hình hiện hình trái tim', passed: false }],
    });
    await expect(frame.getByTestId('goal-shows-heart')).toHaveAttribute('data-state', 'failed');
    await expect(frame.getByTestId('challenge-status')).toHaveText('Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.');
    // The check's run stops, then its result follows; opening the template changed nothing, so no project-changed.
    expect((await messages(page)).map((message) => message.data.type)).toEqual(['ready', 'run-started', 'run-stopped', 'check-result']);

    // The host sends the learner's saved project (the finished heart); the lab opens it.
    const solution = ybcSolutionDocument('ybc-heart');
    await sendToLab(page, { protocol: 'stem-lab/v1', type: 'load-project', document: solution }, labOrigin);
    await expect.poll(() => frame.evaluate(() => window.__stem?.getProject())).toEqual(solution);

    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(2);
    expect((await messagesOfType(page, 'check-result'))[1]?.data).toMatchObject({ passed: true, goals: [{ id: 'shows-heart', passed: true }] });
    await expect(frame.getByTestId('goal-shows-heart')).toHaveAttribute('data-state', 'passed');
    await expect(frame.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');

    // The loaded project went back to the host, debounced, as a project-changed.
    await expect.poll(() => messagesOfType(page, 'project-changed'), { timeout: 5_000 }).not.toHaveLength(0);
    expect((await messagesOfType(page, 'project-changed')).at(-1)?.data.document).toMatchObject({ id: 'template-ybc-heart', profile: 'ybc-basic' });
    expect(errors).toEqual([]);
  });

  test('talks to no other origin: a lab launched for another page sends nothing here and ignores this page', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const labOrigin = new URL(baseURL ?? '').origin;
    const frame = await openInLesson(page, labUrl(baseURL, `lab=yolobit&template=ybc-heart&origin=${encodeURIComponent('http://other.localhost:5190')}`));

    await sendToLab(page, { protocol: 'stem-lab/v1', type: 'load-project', document: ybcSolutionDocument('ybc-heart') }, labOrigin);
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(frame.getByTestId('challenge-status')).toHaveText('Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.', { timeout: 10_000 });

    // The browser dropped every message addressed to the other origin; the lab kept its template.
    expect(await messages(page)).toEqual([]);
    expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(starter('ybc-heart'));
    expect(errors).toEqual([]);
  });

  test('starts the sound with the click of Chạy inside the frame, without another click, and with Kiểm tra too (N17 B3)', async ({ page, baseURL }) => {
    // Every frame records what it asks of its audio: each resume, with whether it came inside a user gesture of that frame.
    await page.addInitScript(() => {
      const record = { resumes: [] as boolean[], started: [] as number[] };
      const made: AudioContext[] = [];
      Object.assign(window, { __sound: record, __soundContexts: made });
      const Real = window.AudioContext;
      window.AudioContext = class extends Real {
        constructor(options?: AudioContextOptions) {
          super(options);
          made.push(this);
        }
        override resume() {
          record.resumes.push(navigator.userActivation.isActive);
          return super.resume();
        }
        override createOscillator() {
          const oscillator = super.createOscillator();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = (when?: number) => {
            record.started.push(oscillator.frequency.value);
            start(when);
          };
          return oscillator;
        }
      };
    });
    const frame = await openInLesson(page, labUrl(baseURL, `lab=yolobit&template=ybc-melody&origin=${encodeURIComponent(lessonOrigin)}`));
    const sound = () =>
      frame.evaluate(() => {
        const { __sound: record, __soundContexts: made } = window as unknown as { __sound: { resumes: boolean[]; started: number[] }; __soundContexts: AudioContext[] };
        return { ...record, contexts: made.length, state: made.at(-1)?.state ?? null };
      });
    // On from the start: the switch says a click turns it off.
    await expect(frame.getByRole('button', { name: 'Tắt âm thanh' })).toBeVisible();
    // A program that sounds at once (the template's waits for button A).
    await frame.evaluate(
      (document) => window.__stem?.loadProject(document),
      {
        schemaVersion: 1,
        id: 'lab-sound',
        name: 'Sound',
        profile: 'ybc-basic',
        circuit: { components: [{ id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } }], wires: [] },
        program: { blocks: program([playNote('C4', 4), playNote('E4', 4), playNote('G4', 4)]) },
      },
    );
    const before = await sound();

    await frame.getByRole('button', { name: 'Chạy' }).click();

    await expect.poll(async () => (await sound()).started).toContain(262);
    const afterRun = await sound();
    expect(afterRun.contexts).toBe(before.contexts + 1);
    const runResumes = afterRun.resumes.slice(before.resumes.length);
    expect(runResumes.length).toBeGreaterThan(0);
    expect(runResumes.every((active) => active)).toBe(true);
    expect(afterRun.state).toBe('running');
    await frame.getByRole('button', { name: 'Dừng' }).click();

    // Check plays the program as Run does: its click resumes the sound the same way.
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect.poll(async () => (await sound()).resumes.length).toBeGreaterThan(afterRun.resumes.length);
    expect((await sound()).resumes.slice(afterRun.resumes.length).every((active) => active)).toBe(true);
    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(1);
  });

  test('a Blockly lab checks the finished Blink and passes', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=blockly&template=blink&origin=${encodeURIComponent(lessonOrigin)}`));

    await expect(frame.getByRole('heading', { name: 'Lập trình khối' })).toBeVisible();
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'lặp mãi mãi' })).toBeVisible();
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();

    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(1);
    expect((await messagesOfType(page, 'check-result'))[0]?.data).toMatchObject({
      passed: true,
      goals: [
        { id: 'led-blinks', passed: true },
        { id: 'uses-wait', passed: true },
      ],
    });
  });
});

// The lab layout fix (2026-10-20): in a lesson's frame of 1440 × 620 the Advanced board's runtime controls (N17) left the board
// about 10 px tall. The board keeps at least 240 px and is drawn whole; the controls scroll on their own; nothing else scrolls.
test.describe('a Yolo:Bit lab with every runtime control in a lesson frame of 1440 × 620', () => {
  test.use({ viewport: { width: 1480, height: 720 } });

  test('keeps the board in sight, at least 240 px tall, with the toolbar, and scrolls only the controls', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const frame = await openInLesson(page, labUrl(baseURL, `lab=yolobit&template=ybc-thermometer&origin=${encodeURIComponent(lessonOrigin)}&profile=ybc-advanced`));
    await page.locator('iframe').evaluate((iframe: HTMLIFrameElement) => {
      iframe.width = '1440';
      iframe.height = '620';
    });
    await expect.poll(() => frame.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1440, 620]);

    const frameBox = await page.locator('iframe').boundingBox();
    const canvas = frame.getByTestId('circuit-canvas');
    await expect.poll(async () => (await canvas.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(240);
    const canvasBox = await canvas.boundingBox();
    if (!frameBox || !canvasBox) {
      throw new Error('The lab or its canvas is not on screen');
    }
    expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height);
    // The board is fitted into the canvas: every port of it is inside.
    const { ports, viewport } = await frame.evaluate(() => window.__stem?.getCanvasState() ?? { ports: [], viewport: { scale: 1, x: 0, y: 0 } });
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      const x = viewport.x + port.x * viewport.scale;
      const y = viewport.y + port.y * viewport.scale;
      expect(x >= 0 && x <= canvasBox.width && y >= 0 && y <= canvasBox.height, `${port.componentId}/${port.portId}`).toBe(true);
    }

    for (const name of ['Chạy', 'Dừng', 'Kiểm tra', 'Đặt lại']) {
      await expect(frame.getByRole('button', { name, exact: true })).toBeInViewport();
    }
    await expect(frame.getByTestId('challenge-panel')).toBeInViewport();
    await expect(frame.getByTestId('control-temperature')).toBeInViewport();
    expect(await frame.evaluate(() => document.scrollingElement !== null && document.scrollingElement.scrollHeight > window.innerHeight)).toBe(false);
    // The last control is reached by scrolling the board panel; the board stays where it is.
    const panel = frame.getByTestId('board-panel');
    await panel.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(frame.getByRole('button', { name: 'Tắt âm thanh' })).toBeInViewport();
    expect((await canvas.boundingBox())?.height).toBe(canvasBox.height);
    expect(errors).toEqual([]);
  });
});

test.describe('a lab opened on its own (a new tab)', () => {
  for (const key of ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody'] as const satisfies readonly YbcLessonKey[]) {
    test(`checks ${key}: the starter does not pass, the finished program does`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/?embed=1&lab=yolobit&template=${key}&origin=${encodeURIComponent(lessonOrigin)}`);
      await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
      const status = page.getByTestId('challenge-status');

      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await expect(status).toHaveText(/^Chưa đạt/, { timeout: 10_000 });

      await page.evaluate((document) => window.__stem?.loadProject(document), ybcSolutionDocument(key));
      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await expect(status).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.', { timeout: 10_000 });
      await expect(page.getByTestId('run-status')).toHaveText('Chưa chạy');
      expect(errors).toEqual([]);
    });
  }

  test('Stop during a check ends it without a result; Reset asks twice, then brings the template back', async ({ page }) => {
    await page.goto(`/?embed=1&lab=yolobit&template=ybc-melody`);
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);

    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByRole('button', { name: 'Đang kiểm tra…' })).toBeDisabled();
    await page.getByRole('button', { name: 'Dừng' }).click();
    await expect(page.getByRole('button', { name: 'Kiểm tra' })).toBeEnabled();
    await expect(page.getByTestId('goal-a-plays-notes')).toHaveAttribute('data-state', 'todo');

    await page.evaluate((document) => window.__stem?.loadProject(document), ybcSolutionDocument('ybc-melody'));
    await page.getByRole('button', { name: 'Đặt lại' }).click();
    await expect(page.getByRole('button', { name: 'Bấm lần nữa để đặt lại' })).toBeVisible();
    expect(await page.evaluate(() => window.__stem?.getProject())).toEqual(ybcSolutionDocument('ybc-melody'));
    await page.getByRole('button', { name: 'Bấm lần nữa để đặt lại' }).click();
    await expect.poll(() => page.evaluate(() => window.__stem?.getProject())).toEqual(starter('ybc-melody'));
  });

  test('a broken lab launch says so in Vietnamese and lists that lab’s templates', async ({ page }) => {
    await page.goto('/?embed=1&lab=blockly&template=ybc-heart');

    const error = page.getByTestId('launch-error');
    await expect(error).toContainText('Không mở được bài thực hành này.');
    // The reason in Vietnamese (N8s); the parser's English stays for whoever wrote the URL, under "technical detail".
    await expect(error.getByText('Mẫu bài "ybc-heart" không mở trong lab=blockly.')).toBeVisible();
    await expect(error.getByText('The template "ybc-heart" does not open in lab=blockly.')).toBeHidden();
    await error.getByText('Chi tiết kỹ thuật (cho người tạo đường dẫn)').click();
    await expect(error.getByText('The template "ybc-heart" does not open in lab=blockly.')).toBeVisible();
    await expect(error).toContainText('Các mẫu được hỗ trợ: blink, led-on, button-direct, button-led, empty.');
  });

  test('says what the core reports and what the board is in Vietnamese; the legacy lab keeps English (N8s)', async ({ page }) => {
    const boardTexts = async () =>
      (await page.evaluate(() => window.__stem?.getCanvasState()))?.components.find((component) => component.deviceType === 'ybc-board')?.texts;

    await page.goto('/?embed=1&lab=yolobit&template=ybc-heart');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    expect(await boardTexts()).toEqual(expect.arrayContaining(['Bo mạch tương thích Bit', 'Ánh sáng', 'Loa']));

    // Two "on start" blocks: the compiler refuses the program, and the toolbar says why in Vietnamese.
    const twoStarts = ybcSolutionDocument('ybc-heart');
    (twoStarts.program.blocks as { blocks: { blocks: unknown[] } }).blocks.blocks.push({ type: 'stem_on_start', id: 'on-start-2', x: 40, y: 420 });
    await page.evaluate((document) => window.__stem?.loadProject(document), twoStarts);
    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByTestId('run-messages')).toContainText('Chương trình có lỗi.');
    await expect(page.getByTestId('run-messages')).toContainText('Lỗi: Chỉ được có một khối "khi bắt đầu".');

    await page.goto('/?embed=1&template=ybc-heart');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    expect(await boardTexts()).toEqual(expect.arrayContaining(['Bit-compatible Board', 'Light', 'Buzzer']));
  });

  test('offers the RGB display in Vietnamese: the colours by name, the built-in pictures, one light and all lights (N17 B1)', async ({ page }) => {
    await page.goto('/?embed=1&lab=yolobit&template=ybc-heart');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    const panel = page.getByTestId('blockly-panel');
    await panel.locator('.blocklyToolboxCategory', { hasText: 'Màn hình' }).click();
    await panel.locator('.blocklyFlyout .blocklyText').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(200);
    const texts = (await panel.locator('.blocklyFlyout .blocklyText').allTextContents()).join(' | ').replaceAll(String.fromCharCode(0xa0), ' ');
    expect(texts).toContain('hiển thị hình có sẵn | trái tim');
    expect(texts).toContain('bật đèn tại cột');
    expect(texts).toContain('tắt đèn tại cột');
    expect(texts).toContain('bật tất cả đèn màu');
    // The colour dropdowns say their colour in Vietnamese (`\b` does not know Vietnamese letters, so the separators are spelled out).
    expect(texts).toContain('hiển thị hình | đỏ |');
    expect(texts).toContain('| lục | bật đèn tại cột');
    expect(texts).not.toMatch(/\b(red|green|heart)\b/);
  });

  test('offers the melodies, the tone and stop of the Advanced board in Vietnamese under "Âm thanh"; a Basic lab does not (N17 B3)', async ({ page }) => {
    const soundTexts = async () => {
      const panel = page.getByTestId('blockly-panel');
      await panel.locator('.blocklyToolboxCategory', { hasText: 'Âm thanh' }).click();
      await panel.locator('.blocklyFlyout .blocklyText').first().waitFor({ state: 'attached' });
      await page.waitForTimeout(200);
      await expect(panel.locator('.blocklyToolboxCategory', { hasText: 'Âm thanh' })).toHaveCount(1);
      return (await panel.locator('.blocklyFlyout .blocklyText').allTextContents()).join(' | ').replaceAll(String.fromCharCode(0xa0), ' ');
    };
    await page.goto('/?embed=1&lab=yolobit&template=ybc-empty&profile=ybc-advanced');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    const advanced = await soundTexts();
    expect(advanced).toContain('phát nốt');
    expect(advanced).toContain('phát giai điệu | Chúc mừng sinh nhật | chờ xong');
    expect(advanced).toContain('phát giai điệu | nhảy lên | không chờ');
    expect(advanced).toContain('bật âm');
    expect(advanced).toContain('dừng âm thanh');
    await expect(page.getByRole('button', { name: 'Tắt âm thanh' })).toBeVisible();

    await page.goto('/?embed=1&lab=yolobit&template=ybc-melody');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    const basic = await soundTexts();
    expect(basic).toContain('phát nốt');
    expect(basic).not.toMatch(/giai điệu|bật âm|dừng âm thanh/);
  });

  test('offers the sensors of the Advanced board in Vietnamese: the blocks under "Đầu vào", the controls and the gesture (N17 B2)', async ({ page }) => {
    await page.goto('/?embed=1&lab=yolobit&template=ybc-empty&profile=ybc-advanced');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    const panel = page.getByTestId('blockly-panel');
    await panel.locator('.blocklyToolboxCategory', { hasText: 'Đầu vào' }).click();
    await panel.locator('.blocklyFlyout .blocklyText').first().waitFor({ state: 'attached' });
    await page.waitForTimeout(200);
    const texts = (await panel.locator('.blocklyFlyout .blocklyText').allTextContents()).join(' | ').replaceAll(String.fromCharCode(0xa0), ' ');
    expect(texts).toContain('mức ánh sáng');
    expect(texts).toContain('nhiệt độ (°C)');
    expect(texts).toContain('gia tốc | x | (mg)');
    expect(texts).toContain('cử chỉ là | lắc');
    expect(texts).toContain('cử chỉ là | nghiêng trái');
    // One "Đầu vào" category, not two.
    await expect(panel.locator('.blocklyToolboxCategory', { hasText: 'Đầu vào' })).toHaveCount(1);

    const boardTexts = (await page.evaluate(() => window.__stem?.getCanvasState()))?.components.find((component) => component.deviceType === 'ybc-board')?.texts;
    expect(boardTexts).toEqual(expect.arrayContaining(['Nhiệt độ', 'Gia tốc']));
    await expect(page.getByText('Nhiệt độ', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('control-accelerometer-shake')).toHaveText('Lắc');
    await expect(page.getByTestId('control-accelerometer-face-down')).toHaveText('Úp mặt');

    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByTestId('control-accelerometer-gesture')).toHaveText('Ngửa mặt');
    await page.getByTestId('control-accelerometer').focus();
    for (let press = 0; press < 4; press++) {
      await page.keyboard.press('ArrowLeft');
    }
    await expect(page.getByTestId('control-accelerometer-gesture')).toHaveText('Nghiêng trái');
    await page.getByTestId('control-accelerometer-shake').click();
    await expect(page.getByTestId('control-accelerometer-gesture')).toHaveText('Lắc');
    await expect(page.getByTestId('control-accelerometer-gesture')).toHaveText('Nghiêng trái', { timeout: 3_000 });
    await expect(page.getByTestId('control-temperature-value')).toHaveText('25 °C');
    await page.getByRole('button', { name: 'Dừng' }).click();
  });
});
