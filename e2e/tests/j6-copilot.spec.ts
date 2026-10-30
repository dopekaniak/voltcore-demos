import { expect, test } from '@playwright/test';
import { forgeFromPrompt, signIn } from './helpers';

test('M6: select an area of a planter and map it to a named feature', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a planter 100 mm across with 5 drainage holes');
  await page.getByTestId('select-area').click();
  // A click on the middle of the part lands on a labeled face.
  await page.getByTestId('model-viewer').click();
  await expect(page.getByTestId('feature-target').or(page.getByTestId('feature-candidates'))).toBeVisible();
  // Keyboard path: pick the rim from the list.
  await page.getByTestId('feature-select').selectOption('rim');
  await expect(page.getByTestId('feature-target')).toContainText('Selected: rim');
});

test('M6: describe a change to a selected feature, review the diff, and accept it as a new version', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a planter 100 mm across with 5 drainage holes');
  await expect(page.getByTestId('bbox-readout')).toContainText('104.4 × 104.4');
  await page.getByTestId('feature-select').selectOption('rim');
  await page.getByTestId('copilot-message').fill('make it 2 mm wider');
  await page.getByTestId('copilot-propose').click();
  await expect(page.getByTestId('copilot-diff')).toContainText('rim: changed', { timeout: 90_000 });
  await expect(page.getByTestId('copilot-diff')).toContainText('(p.rim + 2)');
  await page.getByTestId('copilot-accept').click();
  await page.waitForURL(/version=ver_/, { timeout: 90_000 });
  await expect(page.getByTestId('bbox-readout')).toContainText(/108\.\d × 108\.\d/, { timeout: 60_000 });
});
