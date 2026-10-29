import { expect, test } from '@playwright/test';
import { forgeFromPrompt, signIn } from './helpers';

test('J2: a forge with a failing check shows it and blocks Send to print until acknowledged', async ({ page }) => {
  await signIn(page);
  await forgeFromPrompt(page, 'a planter 80 mm across with 0.8 mm walls');
  const failRow = page.locator('[data-testid="checks-list"] li[data-status="fail"]');
  await expect(failRow.first()).toContainText('Wall is 0.8 mm; the printer minimum is 1.2 mm.');
  const send = page.getByTestId('send-to-print');
  await expect(send).toBeDisabled();
  await expect(page.getByText('Fix or acknowledge the failing checks before sending to print.')).toBeVisible();
  await page.getByTestId('ack-checks').check();
  await expect(send).toBeEnabled();
  // Fixing the wall removes the failure and the need to acknowledge.
  await page.getByTestId('ack-checks').uncheck();
  await page.getByTestId('param-input-wall').fill('2');
  await expect(failRow).toHaveCount(0);
  await expect(send).toBeEnabled();
});
