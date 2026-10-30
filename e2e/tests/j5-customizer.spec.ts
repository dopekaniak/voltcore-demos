import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('J5: customize a name plate for free, reject bad text, then export with the free allowance', async ({ page }) => {
  await page.goto('/customizers');
  await page.getByTestId('customizer-nameplate').click();
  await expect(page.getByTestId('export-allowance')).toContainText('Previews are free');
  await expect(page.getByTestId('bbox-readout')).not.toHaveText('—', { timeout: 60_000 });

  await page.getByTestId('param-text-label').fill('BAD<NAME>');
  await expect(page.getByText('can only use letters, numbers, spaces')).toBeVisible();
  await page.getByTestId('param-text-label').fill('SAM');

  await signIn(page);
  await page.goto('/customizers/nameplate');
  await expect(page.getByTestId('export-allowance')).toContainText('free exports left this month');
  await expect(page.getByTestId('export-footer')).toContainText('Made with the Shapewright');
  await expect(page.getByTestId('bbox-readout')).not.toHaveText('—', { timeout: 60_000 });
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('cz-export-stl').click();
  const file = await (await download).path();
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(80) * 50 + 84).toBe(buf.length);
  await expect(page.getByTestId('export-allowance')).toContainText('2 free exports left');
});
