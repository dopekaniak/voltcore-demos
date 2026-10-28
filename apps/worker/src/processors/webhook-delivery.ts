import type { Env } from '@sw/config';
import type { Db } from '@sw/db';
import { decrypt, signPayload } from '@sw/shared/node';

/**
 * Deliver one outbound webhook, signed like Stripe (`Shapewright-Signature: t=..,v1=..`).
 * Throws on failure so the queue retries with backoff; gives up after `maxAttempts`.
 */
export async function processWebhookDelivery(
  db: Db,
  env: Env,
  deliveryId: string,
  fetchImpl: typeof fetch = fetch,
  maxAttempts = 6,
): Promise<'SUCCEEDED' | 'FAILED' | 'RETRY' | 'SKIPPED'> {
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!d || d.status !== 'PENDING') return 'SKIPPED';
  if (d.endpoint.status !== 'ACTIVE' && d.event !== 'webhook.test') {
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status: 'FAILED' } });
    return 'FAILED';
  }
  const secret = decrypt(env.APP_SECRET, 'webhook', d.endpoint.secretEnc);
  const body = JSON.stringify({ id: `evt_${d.id.replace(/-/g, '')}`, ...(d.payload as object) });
  let status = 0;
  try {
    const res = await fetchImpl(d.endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'shapewright-signature': signPayload(secret, body, Math.floor(Date.now() / 1000)) },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });
    status = res.status;
  } catch {
    status = 0;
  }
  const attempts = d.attempts + 1;
  if (status >= 200 && status < 300) {
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status: 'SUCCEEDED', attempts, responseStatus: status } });
    return 'SUCCEEDED';
  }
  const final = attempts >= maxAttempts;
  await db.webhookDelivery.update({
    where: { id: d.id },
    data: { attempts, responseStatus: status || null, status: final ? 'FAILED' : 'PENDING', nextAttemptAt: final ? null : new Date(Date.now() + 2 ** attempts * 1000) },
  });
  if (!final) throw new Error(`webhook delivery ${d.id} got ${status}; will retry`);
  return 'FAILED';
}
