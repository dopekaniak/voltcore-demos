import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const OPEN_BOX = fileURLToPath(new URL('../fixtures/open-box.stl', import.meta.url));

test.setTimeout(180_000);

test('J3: upload anonymously → repair → quote → change material → sign in → cart → checkout → pay → printed, shipped, delivered', async ({ page }) => {
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
  const cartTotal = await page.getByTestId('cart-total').textContent();

  // Checkout: address, terms, and the server-computed total.
  await page.getByTestId('checkout').click();
  await page.waitForURL('**/checkout');
  await expect(page.getByTestId('checkout-total')).toHaveText(cartTotal!);
  for (const [k, v] of Object.entries({ name: 'Ada Maker', line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701' })) await page.getByTestId(`checkout-${k}`).fill(v);
  await expect(page.getByTestId('checkout-pay')).toBeDisabled();
  await page.getByTestId('checkout-terms').check();
  await page.getByTestId('checkout-pay').click();

  // The test payment page (no money moves), then the order follows the mock partner to delivery.
  await page.waitForURL(/\/checkout\/mock\?session=mcs_/);
  await expect(page.getByTestId('mock-amount')).toHaveText(cartTotal!);
  await page.getByTestId('mock-pay').click();
  await page.waitForURL(/\/orders\/ord_/);
  await expect(page.getByText('Thanks! Your payment was received.')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText(/Paid|Printing/);
  await expect(page.getByTestId('order-status')).toHaveText('Delivered', { timeout: 90_000 });
  await expect(page.getByTestId('order-tracking')).toContainText('Mock Carrier');
  await expect(page.getByTestId('order-items')).toContainText(/Printed in (Minneapolis|Austin)/);
  await page.goto('/cart');
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
  await page.goto('/orders');
  await expect(page.getByTestId('orders')).toContainText('Delivered');
});

test('J3b: cancel a paid order within the cancel window for a full refund', async ({ page }) => {
  await signIn(page);
  await page.goto('/print');
  await page.getByTestId('print-file').setInputFiles(OPEN_BOX);
  await page.getByTestId('repair-part').click();
  await expect(page.getByTestId('quote-total')).toHaveText(/\$/, { timeout: 60_000 });
  await page.getByTestId('add-to-cart').click();
  await page.goto('/checkout');
  for (const [k, v] of Object.entries({ name: 'Ada Maker', line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701' })) await page.getByTestId(`checkout-${k}`).fill(v);
  await page.getByTestId('checkout-terms').check();
  await page.getByTestId('checkout-pay').click();
  await page.getByTestId('mock-pay').click();
  await page.waitForURL(/\/orders\/ord_/);
  await page.getByTestId('order-cancel').click();
  await expect(page.getByTestId('order-status')).toHaveText('Canceled');
});
