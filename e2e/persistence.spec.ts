import { expect, test, type Page } from '@playwright/test';
import { createDefaultProgram } from '../src/core/program/blocks';
import {
  buttonAndLed,
  buttonCenter,
  canvasState,
  chooseInDropdown,
  currentProject,
  expectBlockText,
  expectSaved,
  openApp,
  openProject,
  samples,
  storedProjects,
  worldToPage,
} from './helpers';

// E2E-4 (plan §11.3, M4): edits survive a reload through IndexedDB. Each test
// gets an empty browser storage. Projects are edited through the UI and
// restored by the app itself on reload; IndexedDB is only read (or, for the
// corruption test, damaged) with the browser's own API.

const levelDropdowns = (page: Page) => page.getByTestId('blockly-panel').locator('.blocklyDropdownText');

/** Reloads and waits until the app has opened its project again. */
async function reload(page: Page) {
  await page.reload();
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

test('keeps the circuit and the program as edited across a reload (E2E-4)', async ({ page }) => {
  await openApp(page);
  await expectBlockText(page, 'forever');

  // Circuit: add a push button, delete the cathode → GND wire.
  await page.getByRole('button', { name: 'Add Push Button' }).click();
  const { at } = await worldToPage(page);
  const wire = (await canvasState(page)).wires.find((candidate) => candidate.id === 'wire-cathode-gnd');
  if (!wire) {
    throw new Error('The blink sample has no cathode → GND wire');
  }
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = wire.points;
  await page.mouse.click(at((x1 + x2) / 2, (y1 + y2) / 2).x, at((x1 + x2) / 2, (y1 + y2) / 2).y);
  await page.keyboard.press('Delete');
  // Program: the first write HIGH → LOW, through Blockly.
  await chooseInDropdown(page, 'HIGH', 'LOW');
  await expect(levelDropdowns(page)).toHaveText(['D13', 'LOW', 'D13', 'LOW']);
  await expect.poll(async () => JSON.stringify(await currentProject(page))).not.toContain('"HIGH"');
  const edited = await currentProject(page);
  expect(edited).toMatchObject({
    circuit: { components: expect.arrayContaining([expect.objectContaining({ deviceType: 'push-button' })]) },
  });
  await expectSaved(page);

  await reload(page);

  expect(await currentProject(page)).toEqual(edited);
  const shown = await canvasState(page);
  expect(shown.components.map((component) => component.deviceType)).toEqual(['board', 'resistor', 'led', 'push-button']);
  expect(shown.wires.map((candidate) => candidate.id)).toEqual(['wire-d13-resistor', 'wire-resistor-anode']);
  await expect(levelDropdowns(page)).toHaveText(['D13', 'LOW', 'D13', 'LOW']);
});

test('opens the new project again after New and a reload', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'New' }).click();
  await expect.poll(async () => (await canvasState(page)).components).toEqual([]);
  const created = await currentProject(page);
  await expectSaved(page);

  await reload(page);

  expect(await currentProject(page)).toEqual(created);
  expect((await canvasState(page)).components).toEqual([]);
  await expectBlockText(page, 'on start');
  await expectBlockText(page, 'forever');
});

test('never saves a Blockly edit that was still pending when New replaced the project', async ({ page }) => {
  await openApp(page);
  await expectSaved(page);
  await chooseInDropdown(page, 'HIGH', 'LOW');
  await page.evaluate(async () => {
    // Blockly fires its queued change event after a frame and a task; once it
    // has, the edit's debounced save is pending. Press New while it still is.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    [...document.querySelectorAll('button')].find((button) => button.textContent === 'New')?.click();
  });
  // The pending save of the blink workspace must not land in the new project.
  await expect.poll(() => currentProject(page)).toMatchObject({
    name: 'Untitled',
    circuit: { components: [] },
    program: { blocks: createDefaultProgram() },
  });
  const created = await currentProject(page);
  await expectSaved(page);

  await reload(page);

  expect(await currentProject(page)).toEqual(created);
  // The blink record is the one saved when the app opened, without the edit.
  const blink = (await storedProjects(page)).find((record) => record.id === samples.blink.id);
  expect(blink?.document).toEqual(samples.blink);
});

test('restores the design only: a reload during a run with the button held starts idle (B2)', async ({ page }) => {
  await openProject(page, samples.buttonLed);
  await expectSaved(page);
  await page.getByRole('button', { name: 'Run' }).click();
  const center = await buttonCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await expect.poll(() => buttonAndLed(page)).toEqual({ closed: true, lit: true });

  // While running and held, storage still holds the design exactly as it was.
  expect((await storedProjects(page)).map((record) => record.document)).toEqual([samples.buttonLed]);

  await reload(page);
  await page.mouse.up();

  expect(await currentProject(page)).toEqual(samples.buttonLed);
  await expect(page.getByTestId('run-status')).toHaveText('Idle');
  expect(await buttonAndLed(page)).toEqual({ closed: false, lit: false });
});

/**
 * Damages every saved record in place, as a broken write or another app
 * version would: sets the value at `path` in the stored document (by default
 * an unknown schema version).
 */
const corruptSavedProjects = (page: Page, path: (string | number)[] = ['schemaVersion'], value: unknown = 99) =>
  page.evaluate(
    ([keys, newValue]) =>
      new Promise<void>((resolve, reject) => {
        const change = (document: Record<string | number, unknown>) => {
          const parent = keys.slice(0, -1).reduce<Record<string | number, unknown>>(
            (node, key) => node[key] as Record<string | number, unknown>,
            document,
          );
          parent[keys.at(-1)!] = newValue;
        };
        const opening = indexedDB.open('stem-studio');
        opening.onsuccess = () => {
          const db = opening.result;
          const transaction = db.transaction('projects', 'readwrite');
          const store = transaction.objectStore('projects');
          const reading = store.getAll();
          reading.onsuccess = () => {
            for (const record of reading.result) {
              change(record.document);
              store.put(record);
            }
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [path, value] as const,
  );

test('starts a new project with a notice, without crashing, when the saved project is corrupt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const notice = page.getByTestId('app-notice');
  await openApp(page);
  await expectSaved(page);
  await corruptSavedProjects(page);

  await reload(page);

  await expect(notice).toContainText('The saved project could not be opened, so a new project was started.');
  expect(await currentProject(page)).toMatchObject({ schemaVersion: 1, name: 'Untitled', circuit: { components: [] } });
  await expectBlockText(page, 'on start');
  // The notice is about the project the app opened: New replaces that project.
  await page.getByRole('button', { name: 'New' }).click();
  await expect(notice).toBeHidden();

  // Once more, and dismissed this time.
  await expectSaved(page);
  await corruptSavedProjects(page);
  await reload(page);
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();

  // The new project was saved, so the next reload opens it without a notice.
  const recovered = await currentProject(page);
  await expectSaved(page);
  await reload(page);
  expect(await currentProject(page)).toEqual(recovered);
  await expect(notice).toBeHidden();
  expect(errors).toEqual([]);
});

/** Where the "if" block of the button-led program is, in its stored document. */
const ifBlock = ['program', 'blocks', 'blocks', 'blocks', 0, 'inputs', 'DO', 'block'];

test('starts a new project with a notice when a saved program would make Blockly throw', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await openProject(page, samples.buttonLed);
  await expectSaved(page);
  // The "if" keeps its ELSE input but loses the extraState that creates it:
  // Blockly would throw 'The block "controls_if" … is missing a(n) ELSE connection'.
  await corruptSavedProjects(page, [...ifBlock, 'extraState'], null);
  expect(JSON.stringify((await storedProjects(page))[0]?.document)).toContain('"extraState":null');

  await reload(page);

  await expect(page.getByTestId('app-notice')).toContainText('The saved project could not be opened');
  expect(await currentProject(page)).toMatchObject({ name: 'Untitled', circuit: { components: [] } });
  await expectBlockText(page, 'on start');
  expect(await page.locator('#root > *').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('starts a new project with a notice at once when a saved "if" claims a billion else-ifs (F4)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await openProject(page, samples.buttonLed);
  await expectSaved(page);
  // Blockly would build two inputs per else-if before checking anything,
  // keeping the page busy for minutes before it renders.
  await corruptSavedProjects(page, [...ifBlock, 'extraState', 'elseIfCount'], 1_000_000_000);
  expect(JSON.stringify((await storedProjects(page))[0]?.document)).toContain('"elseIfCount":1000000000');

  const reloaded = Date.now();
  await reload(page);

  await expect(page.getByTestId('app-notice')).toContainText('The saved project could not be opened');
  expect(Date.now() - reloaded).toBeLessThan(5_000);
  expect(await currentProject(page)).toMatchObject({ name: 'Untitled', circuit: { components: [] } });
  await expectBlockText(page, 'on start');
  expect(await page.locator('#root > *').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('keeps the notice that saving is off after New, until dismissed', async ({ page }) => {
  // Storage the browser refuses, as in some private windows.
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
  });
  const notice = page.getByTestId('app-notice');
  await openApp(page);
  await expect(notice).toContainText('Projects cannot be saved in this browser.');
  await expectBlockText(page, 'forever');

  await page.getByRole('button', { name: 'New' }).click();
  await expect.poll(async () => (await canvasState(page)).components).toEqual([]);

  // Saving is still off for the new project, so the notice stays.
  await expect(notice).toContainText('Projects cannot be saved in this browser.');
  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();
});
