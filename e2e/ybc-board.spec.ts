import { expect, test, type Page } from '@playwright/test';
import { createDefaultProgram } from '../src/core/program/blocks';
import {
  canvasState,
  currentProject,
  expectBlockText,
  expectSaved,
  openApp,
  openProject,
  samples,
  worldToPage,
} from './helpers';

// YB-1 (YB plan §8.5 acceptance, GB9, GB12): a Yolo:Bit-compatible project has
// its own toolbox and palette, comes back from a reload as it was saved, and
// runs and stops with its empty program. The generic editor is unchanged.
// There is no UI to create such a project yet (YB-6), so the tests open one
// through the dev-only hook, as a stored document would arrive.

const ybcBoard = { id: 'ybc-board-1', deviceType: 'ybc-board', position: { x: 300, y: 200 } };
const ybcProject = (profile: string, components: unknown[] = [ybcBoard]) => ({
  schemaVersion: 1,
  id: `ybc-${profile}`,
  name: 'Bit-compatible project',
  profile,
  circuit: { components, wires: [] },
  program: { blocks: createDefaultProgram() },
});

const ybcCategories = ['Program', 'Logic', 'Loops', 'Time', 'Math', 'Text', 'Variables'];
const toolboxCategories = (page: Page) =>
  page.getByTestId('blockly-panel').locator('.blocklyToolboxCategory').allInnerTexts();
const paletteButtons = (page: Page) => page.getByRole('toolbar', { name: 'Add a device' }).getByRole('button').allInnerTexts();
const runStatus = (page: Page) => page.getByTestId('run-status');
const runMessages = (page: Page) => page.getByTestId('run-messages');

async function reload(page: Page) {
  await page.reload();
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

test.describe('generic project (unchanged)', () => {
  test('offers the four generic devices and the PoC toolbox, never the Yolo:Bit-compatible board', async ({ page }) => {
    await openApp(page);

    expect(await paletteButtons(page)).toEqual(['+ STEM Board', '+ LED', '+ Resistor', '+ Push Button']);
    expect(await toolboxCategories(page)).toEqual(['Events', 'Pins', 'Logic', 'Time']);
    expect((await currentProject(page)) as object).not.toHaveProperty('profile');
  });

  test('opens the empty template state, edits it, and Run says it needs a board (GB12)', async ({ page }) => {
    await openProject(page, { ...samples.ledOn, circuit: { components: [], wires: [] } });
    await expect.poll(async () => (await canvasState(page)).components).toEqual([]);

    await page.getByRole('button', { name: 'Add LED' }).click();
    await expect.poll(async () => (await canvasState(page)).components.map((c) => c.deviceType)).toEqual(['led']);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(runMessages(page)).toContainText('The circuit needs a board.');
    await expect(runStatus(page)).toHaveText('Idle');
    await expectSaved(page);

    await reload(page);
    expect((await canvasState(page)).components.map((c) => c.deviceType)).toEqual(['led']);
  });

  test('opens a project with two boards, and Run says it can have only one', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Add STEM Board' }).click();
    await expect.poll(async () => (await canvasState(page)).components.filter((c) => c.deviceType === 'board')).toHaveLength(2);
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(runMessages(page)).toContainText('The circuit can have only one board.');
    await expectSaved(page);
    await reload(page);
    expect((await canvasState(page)).components.filter((c) => c.deviceType === 'board')).toHaveLength(2);
  });
});

for (const profile of ['ybc-basic', 'ybc-advanced']) {
  test.describe(`${profile} project`, () => {
    test('offers the Yolo:Bit-compatible board only, and the structure and language in the toolbox', async ({ page }) => {
      await openProject(page, ybcProject(profile));

      await expect.poll(() => paletteButtons(page)).toEqual(['+ Bit-compatible Board']);
      expect(await toolboxCategories(page)).toEqual(ybcCategories);
      await expectBlockText(page, 'on start');
      await expectBlockText(page, 'forever');
      expect((await canvasState(page)).components.map((c) => c.deviceType)).toEqual(['ybc-board']);
    });

    test('runs the empty program and stops it', async ({ page }) => {
      await openProject(page, ybcProject(profile));
      await expect(page.getByRole('button', { name: 'Run' })).toBeVisible();

      await page.getByRole('button', { name: 'Run' }).click();
      await expect(runStatus(page)).toHaveText('Running');
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(runStatus(page)).toHaveText('Idle');
    });

    test('keeps the profile, the board and the toolbox across a reload', async ({ page }) => {
      await openProject(page, ybcProject(profile, []));
      await page.getByRole('button', { name: 'Add Bit-compatible Board' }).click();
      await expect.poll(async () => (await canvasState(page)).components.map((c) => c.deviceType)).toEqual(['ybc-board']);
      const edited = await currentProject(page);
      expect(edited).toMatchObject({ profile });
      await expectSaved(page);

      await reload(page);

      expect(await currentProject(page)).toEqual(edited);
      expect(await toolboxCategories(page)).toEqual(ybcCategories);
      expect(await paletteButtons(page)).toEqual(['+ Bit-compatible Board']);
      await page.getByRole('button', { name: 'Run' }).click();
      await expect(runStatus(page)).toHaveText('Running');
      await page.getByRole('button', { name: 'Stop' }).click();
    });

    test('keeps its profile and toolbox when the board is deleted, Run needs a board, a new board makes it run again', async ({ page }) => {
      await openProject(page, ybcProject(profile));
      await expect.poll(async () => (await canvasState(page)).components).toHaveLength(1);

      // Select the board by clicking its body, away from the port markers, and delete it.
      const { at } = await worldToPage(page);
      const board = (await canvasState(page)).components[0];
      if (!board) {
        throw new Error('The board is not on the canvas');
      }
      await page.mouse.click(at(board.x - 40, board.y + 90).x, at(board.x - 40, board.y + 90).y);
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await canvasState(page)).components).toEqual([]);
      expect(await currentProject(page)).toMatchObject({ profile });
      expect(await toolboxCategories(page)).toEqual(ybcCategories);

      await page.getByRole('button', { name: 'Run' }).click();
      await expect(runMessages(page)).toContainText('The circuit needs a board.');
      await expect(runStatus(page)).toHaveText('Idle');

      await page.getByRole('button', { name: 'Add Bit-compatible Board' }).click();
      await page.getByRole('button', { name: 'Run' }).click();
      await expect(runStatus(page)).toHaveText('Running');
      await page.getByRole('button', { name: 'Stop' }).click();
    });
  });
}

test.describe('a device of the wrong family in a Yolo:Bit-compatible project', () => {
  const withGenericBoard = ybcProject('ybc-basic', [ybcBoard, { id: 'old-board', deviceType: 'board', position: { x: 100, y: 200 } }]);

  test('is kept and marked, and Run names the problem; reloading changes nothing', async ({ page }) => {
    await openProject(page, withGenericBoard);
    await expect.poll(async () => (await canvasState(page)).components).toHaveLength(2);

    const marked = async () =>
      Object.fromEntries((await canvasState(page)).components.map((c) => [c.id, c.incompatible]));
    expect(await marked()).toEqual({ 'ybc-board-1': false, 'old-board': true });

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(runMessages(page)).toContainText('The circuit has devices that this kind of project cannot use.');
    await expect(runStatus(page)).toHaveText('Idle');
    await expectSaved(page);

    await reload(page);
    expect(await currentProject(page)).toEqual(withGenericBoard);
    expect(await marked()).toEqual({ 'ybc-board-1': false, 'old-board': true });
  });
});

test('a stored project with a profile nobody knows does not open: the saved project could not be opened', async ({ page }) => {
  await openApp(page);
  await page.evaluate(
    (project) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open('stem-studio');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const write = db.transaction('projects', 'readwrite');
          write.objectStore('projects').put({ id: project.id, updatedAt: Date.now() + 60_000, document: project });
          write.oncomplete = () => {
            db.close();
            resolve();
          };
          write.onerror = () => reject(write.error);
        };
      }),
    ybcProject('ybc-expert'),
  );

  await reload(page);

  await expect(page.getByTestId('app-notice')).toContainText('The saved project could not be opened');
  expect(await currentProject(page)).not.toHaveProperty('profile');
});
