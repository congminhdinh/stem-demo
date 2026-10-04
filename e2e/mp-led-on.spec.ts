import { expect, test } from '@playwright/test';
import { chooseInDropdown, expectBlockText, openProject, renderedLit, samples } from './helpers';

// E2E-1a (plan §11.3, Minimum Proof): Blockly program → compile → RunSession →
// simulation snapshot → LED as rendered on the canvas.

test.beforeEach(async ({ page }) => {
  await openProject(page, samples.ledOn);
  await expectBlockText(page, 'on start');
});

test('Run lights the LED on the canvas and Stop turns it off', async ({ page }) => {
  const status = page.getByTestId('run-status');
  await expect(status).toHaveText('Idle');
  expect(await renderedLit(page)).toBe(false);

  // Click → LED drawn lit, timed inside the page (plan §2.5: ≤ 300 ms).
  const runToLitMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const isLit = () => window.__stem?.getCanvasState()?.components.find((c) => c.id === 'led')?.lit === true;
        const startedAt = performance.now();
        const check = () => (isLit() ? resolve(performance.now() - startedAt) : requestAnimationFrame(check));
        [...document.querySelectorAll('button')].find((button) => button.textContent === 'Run')?.click();
        requestAnimationFrame(check);
      }),
  );
  test.info().annotations.push({ type: 'Run → LED lit', description: `${runToLitMs.toFixed(1)} ms` });
  expect(runToLitMs).toBeLessThanOrEqual(300);

  // E6: the program ends but the board stays powered, so the LED stays lit.
  await expect(status).toHaveText('Program finished — board powered');
  expect(await renderedLit(page)).toBe(true);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(status).toHaveText('Idle');
  await expect.poll(() => renderedLit(page)).toBe(false);
});

test('Run right after a Blockly edit runs the edited program, not the saved one', async ({ page }) => {
  await chooseInDropdown(page, 'HIGH', 'LOW');
  // No waiting for the debounced save: Run itself must pick up the edit.
  await page.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('run-status')).toHaveText('Program finished — board powered');
  expect(await renderedLit(page)).toBe(false);
});
