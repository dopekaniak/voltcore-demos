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

test('M6: assumed sizes block export until confirmed', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a 40 mm cable clip for a 6 mm cable', { confirmSizes: false });
  await expect(page.getByTestId('assumed-sizes')).toContainText('Wall');
  await expect(page.getByTestId('export-stl')).toBeDisabled();
  await page.getByTestId('confirm-sizes').click();
  await expect(page.getByTestId('export-stl')).toBeEnabled();
});

test('M6: switching to a 180 mm printer re-runs bed fit', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a planter 200 mm across');
  await expect(page.getByTestId('checks-list')).toContainText('the bed is 220 × 220 × 250 mm');
  await page.getByTestId('printer-select').selectOption({ label: 'Original Prusa MINI+' });
  await expect(page.getByTestId('checks-list')).toContainText('larger than the 180 × 180 × 180 mm bed', { timeout: 30_000 });
});

test('M6: engineering estimates show the formula and the estimate label', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a bracket for a 60 mm fan');
  await page.getByTestId('estimates-toggle').click();
  await expect(page.getByTestId('estimate').first()).toContainText('θ = atan(d / h)');
  await page.getByTestId('bend-feature').selectOption('flange');
  await expect(page.getByTestId('estimate')).toHaveCount(2);
  await expect(page.getByTestId('estimate').nth(1)).toContainText('σ = 6 F L / (b t²)');
  for (const label of await page.getByTestId('estimate-label').all()) await expect(label).toHaveText('Estimate, not a certified load test.');
});

test('M6: cut a snap-fit test section and download it, labeled as a test section', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a box 80 mm wide, 50 mm deep and 30 mm tall with a snap-fit lid');
  await expect(page.getByTestId('plan-formats')).toContainText('free plan exports STL for personal use');
  await page.getByTestId('section-feature').selectOption('ridge');
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('section-export').click();
  expect((await download).suggestedFilename()).toMatch(/test-section\.stl$/);
  await expect(page.getByText('It is not the full part.')).toBeVisible();
});
