import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const OPEN_BOX = fileURLToPath(new URL('../fixtures/open-box.stl', import.meta.url));

test('J3 (to the cart): upload anonymously → repair → quote → change material → sign in → add to cart', async ({ page }) => {
  await page.goto('/print');
  await page.getByTestId('print-file').setInputFiles(OPEN_BOX);
  await expect(page.getByTestId('validation-report')).toContainText('The mesh has holes or non-manifold edges', { timeout: 60_000 });
  await page.getByTestId('repair-part').click();
  await expect(page.getByTestId('validation-report')).toContainText('Closed, manifold mesh', { timeout: 60_000 });
  await expect(page.getByTestId('quote')).toContainText('ESTIMATE');
  const total = page.getByTestId('quote-total');
  await expect(total).toHaveText(/\$/);
  const plaTotal = await total.textContent();
  await page.getByTestId('material').selectOption('ASA');
  await expect(total).not.toHaveText(plaTotal!);
  const url = page.url();
  await signIn(page, undefined, url.replace(/^https?:\/\/[^/]+/, ''));
  await expect(page.getByTestId('quote-total')).not.toHaveText(plaTotal!);
  await page.getByTestId('add-to-cart').click();
  await page.goto('/cart');
  await expect(page.getByTestId('cart-items').locator('li')).toHaveCount(1);
});
