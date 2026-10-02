import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { compileProgram } from '../src/core/program/compile-program';

// Blockly workspace → serialized JSON in the document → compileProgram (plan
// POC-05). The compiler runs here, on what the app stored, not inside the app.

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const ledOnProgram = readJson('../src/samples/led-on.project.json').program.blocks;
const boardPins: string[] = readJson('../src/core/devices/definitions/board.json').board.pins.map(
  (pin: { name: string }) => pin.name,
);

const storedProgram = (page: Page) => page.evaluate(() => window.__stem?.getProgramBlocks());

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'on start' })).toBeVisible();
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
  await page.getByTestId('blockly-panel').locator('.blocklyDropdownText', { hasText: 'HIGH' }).click();
  await page.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: 'LOW' }).click();

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
