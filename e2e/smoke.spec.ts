import { expect, test } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('STEM Studio');
  await expect(page.getByRole('heading', { name: 'STEM Studio' })).toBeVisible();
  await expect(page.getByText('Proof of Concept')).toBeVisible();
});
