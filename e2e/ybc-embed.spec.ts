import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectDocumentSchema } from '../src/core/circuit/document';
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
    await expect(error).toContainText('The template "ybc-heart" does not open in lab=blockly.');
    await expect(error).toContainText('Các mẫu được hỗ trợ: blink, led-on, button-direct, button-led, empty.');
  });
});
