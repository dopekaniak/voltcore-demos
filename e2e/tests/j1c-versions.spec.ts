import { expect, test } from '@playwright/test';
import { forgeFromPrompt, signIn } from './helpers';

test('saving settings creates a new version and forking creates a copy', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a desk tray 120 by 80 mm with 10 mm rounded corners');
  await expect(page.getByTestId('save-version')).toBeDisabled();
  await page.getByTestId('param-input-h').fill('30');
  await expect(page.getByTestId('bbox-readout')).toContainText('× 30.0 mm');
  await page.getByTestId('save-version').click();
  await page.waitForURL(/version=ver_/);
  await expect(page.getByTestId('version-select')).toContainText('Version 2');
  await expect(page.getByTestId('bbox-readout')).toContainText('× 30.0 mm', { timeout: 60_000 });
  await page.getByTestId('fork').click();
  await expect(page.getByText('Forked from')).toBeVisible({ timeout: 60_000 });
});
