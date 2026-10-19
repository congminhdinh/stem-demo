import { expect, test, type Frame, type Page } from '@playwright/test';
import { createDefaultProgram } from '../src/core/program/blocks';
import { autosaveDelayMs } from '../src/ui/state/autosave';
import {
  buttonAndLed,
  buttonCenter,
  canvasState,
  currentProject,
  expectBlockText,
  expectSaved,
  openApp,
  renderedLit,
  samples,
  storedProjects,
} from './helpers';

// S1 (plan §9.2 "S1"): ?embed=1&template=<key> opens that template as an
// embedded lab. It never reads nor writes the standalone last project, so
// the tests first make a standalone project the last one, then check that a
// lab neither shows it nor changes what IndexedDB holds.

const labPath = (template: string) => `/?embed=1&template=${template}`;

/** Opens an embedded lab and waits until it has rendered its project. */
async function openLab(page: Page, template: string) {
  await page.goto(labPath(template));
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

/** The IndexedDB databases of the page's origin; the standalone editor's is "stem-studio". */
const databaseNames = (target: Page | Frame) =>
  target.evaluate(async () => (await indexedDB.databases()).map((database) => database.name));

/**
 * Showing that nothing was saved needs a wait: autosave is debounced, so a
 * lab that saved would have written within this time.
 */
const waitPastAutosave = (page: Page) =>
  page.evaluate((delay) => new Promise((resolve) => setTimeout(resolve, delay)), autosaveDelayMs * 3);

for (const { template, sample, blockText } of [
  { template: 'blink', sample: samples.blink, blockText: 'wait' },
  { template: 'led-on', sample: samples.ledOn, blockText: 'digital write' },
  { template: 'button-direct', sample: samples.buttonDirect, blockText: 'forever' },
  { template: 'button-led', sample: samples.buttonLed, blockText: 'digital read' },
]) {
  test(`${labPath(template)} opens the "${sample.name}" sample`, async ({ page }) => {
    await openLab(page, template);

    expect(await currentProject(page)).toEqual(sample);
    const shown = await canvasState(page);
    expect(shown.components.map(({ id, deviceType }) => ({ id, deviceType }))).toEqual(
      sample.circuit.components.map(({ id, deviceType }: { id: string; deviceType: string }) => ({ id, deviceType })),
    );
    expect(shown.wires.map((wire) => wire.id)).toEqual(sample.circuit.wires.map((wire: { id: string }) => wire.id));
    await expect(page.getByTestId('blockly-panel').locator('.blocklyText', { hasText: blockText }).first()).toBeVisible();
    expect(await databaseNames(page)).not.toContain('stem-studio');
  });
}

test(`${labPath('empty')} opens an empty project`, async ({ page }) => {
  await openLab(page, 'empty');

  expect(await currentProject(page)).toEqual({
    schemaVersion: 1,
    id: 'template-empty',
    name: 'Untitled',
    circuit: { components: [], wires: [] },
    program: { blocks: createDefaultProgram() },
  });
  expect((await canvasState(page)).components).toEqual([]);
  await expectBlockText(page, 'on start');
  await expectBlockText(page, 'forever');
});

test('a Button LED lab neither shows nor replaces the standalone last project', async ({ page }) => {
  // Standalone: the user's own project (New, then an LED) is the last project.
  await openApp(page);
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('button', { name: 'Add LED' }).click();
  await expect.poll(async () => (await canvasState(page)).components.map((component) => component.deviceType)).toEqual([
    'led',
  ]);
  const own = await currentProject(page);
  await expectSaved(page);
  const stored = await storedProjects(page);

  // The lab opens Button LED, and is used: edited, run, button held.
  await openLab(page, 'button-led');
  expect(await currentProject(page)).toEqual(samples.buttonLed);
  await page.getByRole('button', { name: 'Add Resistor' }).click();
  await expect.poll(async () => (await canvasState(page)).components).toHaveLength(5);
  await page.getByRole('button', { name: 'Run' }).click();
  const center = await buttonCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: true, lit: true });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Stop' }).click();
  await waitPastAutosave(page);
  expect(await storedProjects(page)).toEqual(stored);

  // Reloading the lab starts again from the template, not from the edit.
  await page.reload();
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
  expect(await currentProject(page)).toEqual(samples.buttonLed);

  // Back in the standalone editor: the user's own project.
  await openApp(page);
  expect(await currentProject(page)).toEqual(own);
  expect((await canvasState(page)).components.map((component) => component.deviceType)).toEqual(['led']);
});

test('a Blink lab shows the bundled Blink, not a standalone Blink edited under the same id', async ({ page }) => {
  // Standalone: the Blink sample, edited, is the last project under its own id.
  await openApp(page);
  await page.getByRole('button', { name: 'Add Push Button' }).click();
  await expect.poll(async () => (await canvasState(page)).components).toHaveLength(4);
  const editedBlink = await currentProject(page);
  expect(editedBlink).toMatchObject({ id: samples.blink.id });
  await expectSaved(page);
  const stored = await storedProjects(page);

  // The lab opens the bundled Blink; running it saves nothing.
  await openLab(page, 'blink');
  expect(await currentProject(page)).toEqual(samples.blink);
  expect((await canvasState(page)).components).toHaveLength(3);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => renderedLit(page)).toBe(true);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'New' }).click();
  await waitPastAutosave(page);
  expect(await storedProjects(page)).toEqual(stored);

  await openApp(page);
  expect(await currentProject(page)).toEqual(editedBlink);
});

test('a broken launch URL shows an error, never the standalone last project', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await openApp(page);
  await expectSaved(page);
  const stored = await storedProjects(page);

  for (const [search, problem] of [
    ['?embed=1&template=blinky', 'Unknown template "blinky".'],
    ['?embed=1', 'No template was given: add template=<key>.'],
    ['?embed=true&template=button-led', 'embed must be given once, as embed=1.'],
    ['?template=button-led', 'A template opens only in an embedded lab: add embed=1.'],
  ] as const) {
    await page.goto(`/${search}`);

    const error = page.getByTestId('launch-error');
    await expect(error).toContainText('This lab could not be opened.');
    await expect(error).toContainText(problem);
    await expect(error).toContainText(
      'Supported templates: blink, led-on, button-direct, button-led, empty, ybc-heart, ybc-button-ab, ybc-night-light, ybc-melody, ybc-empty, ybc-rainbow, ybc-thermometer, ybc-dice, ybc-servo-gate.',
    );
    await expect(page.getByTestId('circuit-canvas')).toHaveCount(0);
    await expect(page.getByTestId('program-region')).toHaveCount(0);
    expect(await page.evaluate(() => window.__stem)).toBeUndefined();
  }
  expect(await storedProjects(page)).toEqual(stored);
  expect(errors).toEqual([]);
});

test.describe('in an iframe of another site', () => {
  // The lesson page (e2e/lesson-host.mjs, started by playwright.config.ts)
  // stands in for Student Web or the CMS: another site than the lab, on
  // loopback, and a secure context (*.localhost) as https would be.
  const lessonOrigin = 'http://lesson.localhost:5190';

  async function openInLesson(page: Page, labUrl: string, sandbox?: string) {
    const lesson = new URL('/lesson', lessonOrigin);
    lesson.searchParams.set('lab', labUrl);
    if (sandbox !== undefined) {
      lesson.searchParams.set('sandbox', sandbox);
    }
    await page.goto(lesson.href);
    const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
    if (!frame) {
      throw new Error('The lab iframe has no frame');
    }
    await frame.waitForFunction(() => window.__stem?.getCanvasState() != null);
    return frame;
  }

  /** What Konva rendered in the frame (dev-only hook). */
  const frameCanvas = async (frame: Frame) => {
    const state = await frame.evaluate(() => window.__stem?.getCanvasState());
    if (!state) {
      throw new Error('Canvas state is not available');
    }
    return state;
  };

  /** World → page coordinates: the frame's canvas box is given in page coordinates. */
  async function pagePoint(frame: Frame, componentId: string) {
    const box = await frame.getByTestId('circuit-canvas').locator('canvas').first().boundingBox();
    const component = (await frameCanvas(frame)).components.find((candidate) => candidate.id === componentId);
    if (!box || !component) {
      throw new Error(`${componentId} is not on the visible canvas`);
    }
    return { x: box.x + component.x, y: box.y + component.y };
  }

  /** Console errors and uncaught exceptions of the lesson page and of its iframe. */
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

  for (const { template, sample } of [
    { template: 'blink', sample: samples.blink },
    { template: 'button-led', sample: samples.buttonLed },
  ]) {
    test(`loads the ${template} lab, cross-site, and it can be run there`, async ({ page, baseURL }) => {
      const errors = collectErrors(page);
      const labUrl = new URL(labPath(template), baseURL).href;

      const frame = await openInLesson(page, labUrl);

      expect(await page.evaluate(() => [window.isSecureContext, window.origin])).toEqual([true, lessonOrigin]);
      // The frame shows the lab itself, not a browser error page for a refused frame.
      expect(frame.url()).toBe(labUrl);
      expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(sample);
      await expect(frame.getByTestId('circuit-canvas')).toBeVisible();
      await expect(frame.getByTestId('program-region').locator('.blocklyText', { hasText: 'forever' })).toBeVisible();

      // Usable in the frame: Run lights the LED (Blink at once; Button LED while the button is held).
      const ledLit = async () => (await frameCanvas(frame)).components.find((component) => component.id === 'led')?.lit;
      await frame.getByRole('button', { name: 'Run' }).click();
      if (template === 'button-led') {
        const button = await pagePoint(frame, 'button');
        await page.mouse.move(button.x, button.y);
        await page.mouse.down();
        await expect.poll(ledLit).toBe(true);
        await page.mouse.up();
        await expect.poll(ledLit).toBe(false);
      } else {
        await expect.poll(ledLit).toBe(true);
      }
      await frame.getByRole('button', { name: 'Stop' }).click();
      await expect(frame.getByTestId('run-status')).toHaveText('Idle');

      // The lab created no storage in its (partitioned) origin.
      expect(await databaseNames(frame)).not.toContain('stem-studio');
      // The listener does hear the frame: a probe error is the only error.
      await frame.evaluate(() => console.error('probe from the lab frame'));
      await expect.poll(() => errors).toEqual(['probe from the lab frame']);
    });
  }

  test('loads a lab in a sandboxed iframe that allows scripts and its own origin', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const labUrl = new URL(labPath('button-led'), baseURL).href;

    const frame = await openInLesson(page, labUrl, 'allow-scripts allow-same-origin');

    expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(samples.buttonLed);
    await expect(frame.getByTestId('circuit-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
