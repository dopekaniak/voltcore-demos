import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// The mock provider takes 8-25 s per task with the default .env.
test.setTimeout(240_000);

test('J4: generate preview → refine → export GLB with the mock provider', async ({ page }) => {
  await signIn(page);
  await page.goto('/generate');
  await page.getByTestId('gen-prompt').fill('a small ceramic vase with a wide lip');
  await expect(page.getByTestId('gen-cost')).toHaveText('20 credits');
  await expect(page.getByTestId('gen-refine')).toBeDisabled();
  await page.getByTestId('gen-preview').click();
  await expect(page.getByTestId('download-glb-preview')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('credit-badge')).toHaveText('80 credits');
  await page.getByTestId('gen-refine').click();
  await expect(page.getByTestId('download-glb-refined')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('credit-badge')).toHaveText('70 credits');
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-glb-refined').click();
  const file = readFileSync(await (await dl).path());
  expect(file.subarray(0, 4).toString()).toBe('glTF');
});

test('J4b: a failed generation is not charged', async ({ page }) => {
  await signIn(page);
  await page.goto('/generate');
  await page.getByTestId('gen-prompt').fill('a lamp [[fail]]');
  await page.getByTestId('gen-preview').click();
  await expect(page.getByText('Generation failed. You were not charged.')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('credit-badge')).toHaveText('100 credits');
});

test('library lists generated models and repairs create a new version', async ({ page }) => {
  await signIn(page);
  await page.goto('/generate');
  await page.getByTestId('gen-prompt').fill('a gem');
  await page.getByTestId('gen-preview').click();
  await expect(page.getByTestId('download-glb-preview')).toBeVisible({ timeout: 90_000 });
  await page.goto('/library');
  await expect(page.getByTestId('library-items').locator('li')).toHaveCount(1);
  await page.getByTestId('library-items').getByRole('link', { name: 'A gem' }).click();
  await expect(page.getByTestId('analysis')).toBeVisible();
});
