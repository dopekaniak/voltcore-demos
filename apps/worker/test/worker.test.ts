import { createServer } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '@sw/config';
import { createDb, credits, enqueue, onboardUser } from '@sw/db';
import { encrypt, verifySignedPayload } from '@sw/shared/node';
import { createMailer } from '../src/mailer';
import { processEmail } from '../src/processors/email';
import { reap } from '../src/processors/reaper';
import { processWebhookDelivery } from '../src/processors/webhook-delivery';
import { relayOnce } from '../src/relay';

const env = loadEnv({ ...process.env, MAIL_DRIVER: 'memory' });
const db = createDb(env.DATABASE_URL);
afterAll(() => db.$disconnect());

describe('outbox relay', () => {
  it('publishes each unpublished row once', async () => {
    const key = crypto.randomUUID();
    await enqueue(db, 'email', key, { template: 'magic-link', to: 'r@example.test', vars: { url: 'x' } });
    await enqueue(db, 'email', key, { template: 'magic-link', to: 'dup@example.test', vars: { url: 'y' } });
    const published: string[] = [];
    const pub = { publish: async (_t: string, id: string) => void published.push(id) };
    for (let i = 0; i < 20 && !published.some((p) => p.includes(key.replace(/:/g, '_'))); i++) await relayOnce(db, pub);
    expect(published.filter((p) => p.includes(key))).toHaveLength(1);
    await relayOnce(db, pub);
    expect(published.filter((p) => p.includes(key))).toHaveLength(1);
    const row = await db.outboxMessage.findUniqueOrThrow({ where: { topic_key: { topic: 'email', key } } });
    expect(row.publishedAt).not.toBeNull();
    expect((row.payload as { to: string }).to).toBe('r@example.test');
  });

  it('does not mark rows published when the queue rejects them', async () => {
    const key = crypto.randomUUID();
    await enqueue(db, 'email', key, { template: 'magic-link', to: 'x@example.test', vars: {} });
    const pub = { publish: async () => { throw new Error('redis down'); } };
    await expect(relayOnce(db, pub)).rejects.toThrow('redis down');
    const row = await db.outboxMessage.findUniqueOrThrow({ where: { topic_key: { topic: 'email', key } } });
    expect(row.publishedAt).toBeNull();
  });
});

describe('email', () => {
  it('renders the magic-link template and escapes HTML', async () => {
    const mailer = createMailer(env);
    await processEmail(mailer, { template: 'magic-link', to: 'm@example.test', vars: { url: 'https://x.test/?a=<b>' } });
    expect(mailer.sent![0]!.subject).toContain('sign-in link');
    expect(mailer.sent![0]!.html).toContain('&#60;b&#62;');
    await expect(processEmail(mailer, { template: 'nope', to: 'a', vars: {} })).rejects.toThrow(/unknown/);
  });
});

describe('webhook delivery', () => {
  it('signs the payload and records success', async () => {
    let received: { sig: string; body: string } | null = null;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received = { sig: String(req.headers['shapewright-signature']), body };
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const user = await db.user.create({ data: { email: `wh-${crypto.randomUUID()}@example.test` } });
    const ep = await db.webhookEndpoint.create({ data: { ownerId: user.id, url: `http://localhost:${port}/h`, events: ['webhook.test'], secretEnc: encrypt(env.APP_SECRET, 'webhook', 'whsec_test') } });
    const d = await db.webhookDelivery.create({ data: { endpointId: ep.id, event: 'webhook.test', payload: { type: 'webhook.test' } } });
    expect(await processWebhookDelivery(db, env, d.id)).toBe('SUCCEEDED');
    server.close();
    expect(verifySignedPayload('whsec_test', received!.body, received!.sig, Math.floor(Date.now() / 1000))).toBe(true);
    expect(await processWebhookDelivery(db, env, d.id)).toBe('SKIPPED');
  });

  it('retries on failure and gives up after max attempts', async () => {
    const user = await db.user.create({ data: { email: `wh-${crypto.randomUUID()}@example.test` } });
    const ep = await db.webhookEndpoint.create({ data: { ownerId: user.id, url: 'http://localhost:1/h', events: ['webhook.test'], secretEnc: encrypt(env.APP_SECRET, 'webhook', 's') } });
    const d = await db.webhookDelivery.create({ data: { endpointId: ep.id, event: 'webhook.test', payload: {} } });
    const failing = (async () => new Response('no', { status: 500 })) as typeof fetch;
    await expect(processWebhookDelivery(db, env, d.id, failing, 2)).rejects.toThrow(/retry/);
    expect(await processWebhookDelivery(db, env, d.id, failing, 2)).toBe('FAILED');
  });
});

describe('reaper', () => {
  it('releases stale reservations, fails their jobs, expires and renews plan credits', async () => {
    const now = new Date();
    const { userId } = await db.$transaction((tx) => onboardUser(tx, { email: `rp-${crypto.randomUUID()}@example.test`, now: new Date(now.getTime() - 40 * 86400e3) }));
    const job = await db.job.create({ data: { ownerId: userId, kind: 'GENERATE', status: 'RUNNING', idempotencyKey: crypto.randomUUID(), input: {} } });
    const r = await db.$transaction((tx) => credits.reserve(tx, { ownerId: userId, amount: 20, jobId: job.id, expiresAt: new Date(now.getTime() - 1000), idempotencyKey: crypto.randomUUID() }));
    const res = await reap(db, now);
    expect(res.released).toBeGreaterThanOrEqual(1);
    expect((await db.reservation.findUniqueOrThrow({ where: { id: r.reservationId } })).status).toBe('EXPIRED');
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('FAILED');
    const w = await db.creditWallet.findUniqueOrThrow({ where: { ownerId: userId } });
    // The old 100 expired, a new month's 100 was granted.
    expect([w.balance, w.reserved]).toEqual([100, 0]);
    const kinds = (await db.creditLedger.findMany({ where: { walletId: w.id }, orderBy: { createdAt: 'asc' } })).map((l) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(['GRANT', 'RESERVE', 'RELEASE', 'EXPIRE']));
    const sub = await db.subscription.findFirstOrThrow({ where: { ownerId: userId } });
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(now.getTime());
  });
});
