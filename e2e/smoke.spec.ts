import { expect, test } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('STEM Studio');
  await expect(page.getByRole('heading', { name: 'STEM Studio' })).toBeVisible();
  await expect(page.getByText('Proof of Concept')).toBeVisible();
});

test('has its own icon, and the page asks for nothing that is missing', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      missing.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);

  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toBe('/favicon.svg');
  const icon = await page.request.get(href ?? '');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect(missing).toEqual([]);
});
