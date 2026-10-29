import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { forgeFromPrompt, signIn } from './helpers';

test('J1: describe a part → MockAuthor → forge builds → change a slider → export STL', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a 40 mm cable clip for a 6 mm cable, with a snap closure');
  const readout = page.getByTestId('bbox-readout');
  await expect(readout).toContainText('× 40.0 mm');
  // The checks panel runs in the browser sandbox.
  await expect(page.getByTestId('checks-list').locator('li').first()).toBeVisible();

  const before = await readout.textContent();
  await page.getByTestId('param-input-width').fill('25');
  await expect(readout).toContainText('× 25.0 mm');
  expect(await readout.textContent()).not.toBe(before);

  const download = page.waitForEvent('download');
  await page.getByTestId('export-stl').click();
  const file = await (await download).path();
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(80) * 50 + 84).toBe(buf.length);
  expect((await download).suggestedFilename()).toMatch(/\.stl$/);
});

test('J1b: starter forges open and rebuild without an account', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('starter-planter').click();
  await expect(page.getByTestId('bbox-readout')).toContainText('104.4 × 104.4 × 90.0 mm', { timeout: 60_000 });
  await page.getByTestId('param-input-height').fill('120');
  await expect(page.getByTestId('bbox-readout')).toContainText('× 120.0 mm');
});

test('clamps an out-of-range value and says so', async ({ page }) => {
  await page.goto('/forge/starter/cable-clip');
  await expect(page.getByTestId('bbox-readout')).not.toHaveText('—', { timeout: 60_000 });
  await page.getByTestId('param-input-cable').fill('99');
  await expect(page.getByTestId('clamp-notes')).toContainText('Cable diameter was lowered to the maximum, 20 mm.');
});
