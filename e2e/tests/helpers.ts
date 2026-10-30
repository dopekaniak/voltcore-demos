import { expect, type Page } from '@playwright/test';
import { loadDotenv } from '@sw/config/dotenv';
import { createDb } from '@sw/db';

loadDotenv();
export const db = createDb(process.env.DATABASE_URL);

/** Sign in through the UI; the magic link is read from the outbox (as the email worker would send it). */
export async function signIn(page: Page, email = `e2e-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`, next = '/') {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('email-submit').click();
  await expect(page.getByText(`Check ${email}`)).toBeVisible();
  let url: string | null = null;
  for (let i = 0; i < 50 && !url; i++) {
    const msg = await db.outboxMessage.findFirst({ where: { topic: 'email', payload: { path: ['to'], equals: email } }, orderBy: { id: 'desc' } });
    url = msg ? (msg.payload as { vars: { url: string } }).vars.url : null;
    if (!url) await page.waitForTimeout(100);
  }
  const link = new URL(url!);
  await page.goto(`${link.pathname}${link.search}`);
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback'));
  await expect(page.getByTestId('credit-badge')).toBeVisible();
  return email;
}

export async function forgeFromPrompt(page: Page, prompt: string, opts: { confirmSizes?: boolean } = {}) {
  await page.goto('/');
  await page.getByTestId('prompt-input').fill(prompt);
  await page.getByTestId('prompt-submit').click();
  await page.waitForURL(/\/forge\/frg_/, { timeout: 90_000 });
  await expect(page.getByTestId('bbox-readout')).not.toHaveText('—', { timeout: 60_000 });
  // Sizes the description did not give are assumed and must be confirmed before export.
  if (opts.confirmSizes !== false) {
    await page.getByTestId('confirm-sizes').click();
    await expect(page.getByTestId('confirm-sizes')).toHaveCount(0);
  }
}
