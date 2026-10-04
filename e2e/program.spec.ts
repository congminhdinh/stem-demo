import { expect, test, type Page } from '@playwright/test';
import { compileProgram } from '../src/core/program/compile-program';
import { chooseInDropdown, expectBlockText, openProject, readJson, renderedLit, samples } from './helpers';

// Blockly workspace → serialized JSON in the document → compileProgram (plan
// POC-05). The compiler runs here, on what the app stored, not inside the app.

const ledOnProgram = samples.ledOn.program.blocks;
const boardPins: string[] = readJson('../src/core/devices/definitions/board.json').board.pins.map(
  (pin: { name: string }) => pin.name,
);

const storedProgram = (page: Page) => page.evaluate(() => window.__stem?.getProgramBlocks());
const levelDropdowns = (page: Page) => page.getByTestId('blockly-panel').locator('.blocklyDropdownText');

/** The led-on project again, same id, but its program writes D13 LOW. */
const ledOnLow = JSON.parse(JSON.stringify(samples.ledOn).replace('"LEVEL":"HIGH"', '"LEVEL":"LOW"'));

test.beforeEach(async ({ page }) => {
  await openProject(page, samples.ledOn);
  await expectBlockText(page, 'on start');
});

test('shows the led-on program in Blockly, whose stored JSON compiles to the MP IR', async ({ page }) => {
  await expect(page.getByTestId('blockly-panel').locator('.blocklyDropdownText')).toHaveText(['D13', 'HIGH']);

  expect(compileProgram(await storedProgram(page), boardPins)).toEqual({
    ok: true,
    ir: { onStart: [{ kind: 'digitalWrite', pin: 'D13', level: 1, blockId: 'write-d13-high' }], forever: null },
    diagnostics: [],
  });
});

test('editing a field writes the serialized workspace back to the document', async ({ page }) => {
  await chooseInDropdown(page, 'HIGH', 'LOW');

  // Everything Blockly saves back must match the sample except the edited field.
  const expected = JSON.parse(JSON.stringify(ledOnProgram).replace('"LEVEL":"HIGH"', '"LEVEL":"LOW"'));
  await expect.poll(() => storedProgram(page)).toEqual(expected);
  expect(compileProgram(await storedProgram(page), boardPins)).toEqual({
    ok: true,
    ir: { onStart: [{ kind: 'digitalWrite', pin: 'D13', level: 0, blockId: 'write-d13-high' }], forever: null },
    diagnostics: [],
  });
});

test('a block disabled from the context menu stays disabled in the document and does not compile', async ({
  page,
}) => {
  await page.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'digital write' }).click({ button: 'right' });
  await page.locator('.blocklyContextMenu .blocklyMenuItem', { hasText: 'Disable Block' }).click();

  const expected = structuredClone(ledOnProgram);
  expected.blocks.blocks[0].inputs.DO.block.disabledReasons = ['MANUALLY_DISABLED'];
  await expect.poll(() => storedProgram(page)).toEqual(expected);
  expect(compileProgram(await storedProgram(page), boardPins)).toEqual({
    ok: true,
    ir: { onStart: [], forever: null },
    diagnostics: [],
  });
});

test.describe('loading a project with the same id', () => {
  test('replaces the program in Blockly, and Run runs the loaded program', async ({ page }) => {
    await page.evaluate((project) => window.__stem?.loadProject(project), ledOnLow);
    await expect(levelDropdowns(page)).toHaveText(['D13', 'LOW']);

    await page.getByRole('button', { name: 'Run' }).click();

    await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
    expect(await renderedLit(page)).toBe(false);
    expect(await storedProgram(page)).toEqual(ledOnLow.program.blocks);
  });

  test('runs the loaded program even when Run comes before Blockly has reloaded', async ({ page }) => {
    // Same task: the workspace on screen still shows the previous HIGH program.
    await page.evaluate((project) => {
      window.__stem?.loadProject(project);
      [...document.querySelectorAll('button')].find((button) => button.textContent === 'Run')?.click();
    }, ledOnLow);

    await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
    expect(await renderedLit(page)).toBe(false);
    await expect(levelDropdowns(page)).toHaveText(['D13', 'LOW']);
    expect(await storedProgram(page)).toEqual(ledOnLow.program.blocks);
  });

  test('never lets an edit still waiting to be saved overwrite the loaded project', async ({ page }) => {
    await chooseInDropdown(page, 'HIGH', 'LOW');
    await page.evaluate(async (project) => {
      // Blockly fires its queued change event after a frame and a task; once it
      // has, the edit's debounced save is pending. Load while it still is.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      window.__stem?.loadProject(project);
    }, samples.ledOn);

    await expect(levelDropdowns(page)).toHaveText(['D13', 'HIGH']);
    expect(await storedProgram(page)).toEqual(ledOnProgram);
  });
});
