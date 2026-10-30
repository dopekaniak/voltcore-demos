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
