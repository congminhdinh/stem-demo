import { expect, test } from '@playwright/test';
import { chooseInDropdown, expectBlockText, renderedLit } from './helpers';

// E2E-1b (plan §11.3, VS-1): the blink sample (the app's default project)
// blinks on the canvas, stops during a wait, and runs again after an edit.

// Fine-grained polling: each LED state lasts about one second.
const toggle = { intervals: [50], timeout: 3000 };

test('blinks, stops during a wait, and runs the program as edited in Blockly', async ({ page }) => {
  await page.goto('/');
  await expectBlockText(page, 'forever');
  const status = page.getByTestId('run-status');
  const run = page.getByRole('button', { name: 'Run' });
  const stop = page.getByRole('button', { name: 'Stop' });

  await run.click();
  await expect(status).toHaveText('Running');
  // On at 0 ms, off at 1000 ms, on again at 2010 ms.
  await expect.poll(() => renderedLit(page), toggle).toBe(true);
  await expect.poll(() => renderedLit(page), toggle).toBe(false);
  await expect.poll(() => renderedLit(page), toggle).toBe(true);

  // The program is inside a wait: Stop interrupts it and the LED goes off.
  await stop.click();
  await expect(status).toHaveText('Idle');
  await expect.poll(() => renderedLit(page)).toBe(false);

  // Swap the levels of the two writes: the LED now lights in the second half
  // of each cycle. The second write is edited first, while its LOW is unique.
  await chooseInDropdown(page, 'LOW', 'HIGH');
  await chooseInDropdown(page, 'HIGH', 'LOW', 0);
  await run.click();

  await expect(status).toHaveText('Running');
  // The old program would be lit right away.
  expect(await renderedLit(page)).toBe(false);
  await expect.poll(() => renderedLit(page), toggle).toBe(true);

  await stop.click();
  await expect(status).toHaveText('Idle');
});
