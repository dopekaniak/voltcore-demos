import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, makeTestApp, signIn } from '@sw/api/testing';
import { fromApiId, newId, toApiId } from '@sw/shared';
import { processOrder } from '../src/processors/orders';
import { makeWorkerCtx } from './helpers';

let t: Awaited<ReturnType<typeof makeTestApp>>;
const w = makeWorkerCtx();
beforeAll(async () => {
  t = await makeTestApp({ ESTIMATE_ORDERS: 'allow-dev', PAYMENTS_MODE: 'mock', ORDER_ROUTE_DELAY_MS: 0 });
});
afterAll(async () => {
  await t.close();
  await w.close();
});

const address = { name: 'Ada Maker', line1: '1 Main St', city: 'Austin', region: 'TX', postal_code: '78701', country: 'US' };

async function paidOrder(material = 'PETG', bbox = [20, 20, 20]) {
  const s = await signIn(t);
  const call = as(t, s.cookie);
  const partId = newId();
  await t.ctx.db.printPart.create({ data: { id: partId, ownerId: fromApiId('user', s.userId)!, title: 'Bracket', status: 'READY', analysis: { volume_mm3: 8000, surface_area_mm2: 2400, bbox_mm: bbox, overhang_area_mm2: 0, printable: true }, settings: {} } });
  const q = (await call('POST', '/v1/print/quotes', { part_id: toApiId('part', partId), settings: { material } }, { 'idempotency-key': newId() })).json();
  await call('POST', '/v1/cart/items', { quote_id: q.id });
  const { order, checkout_url } = (await call('POST', '/v1/checkout', { address, accept_terms: true }, { 'idempotency-key': newId() })).json();
  await call('POST', `/v1/checkout/mock/${new URL(checkout_url).searchParams.get('session')}/complete`, { outcome: 'paid' });
  return { call, apiId: order.id as string, id: fromApiId('order', order.id)! };
}

describe('Order routing and the mock partner', () => {
  it('routes a paid order, prints, ships with tracking, and delivers, emailing at each milestone', async () => {
    const { call, apiId, id } = await paidOrder();
    await processOrder(w, { op: 'route', orderId: id });
    let o = (await call('GET', `/v1/orders/${apiId}`)).json();
    expect(o.status).toBe('IN_PRODUCTION');
    expect(o.items[0]).toMatchObject({ status: 'ROUTED', material: 'PETG' });
    expect(['Minneapolis', 'Austin']).toContain(o.items[0].partner_city);
    expect(o.can_cancel).toBe(false);
    for (let i = 0; i < 6 && o.status !== 'DELIVERED'; i++) {
      await processOrder(w, { op: 'advance', orderId: id });
      o = (await call('GET', `/v1/orders/${apiId}`)).json();
    }
    expect(o.status).toBe('DELIVERED');
    expect(o.items[0].status).toBe('SHIPPED');
    expect(o.shipments[0]).toMatchObject({ carrier: 'Mock Carrier', status: 'delivered' });
    expect(o.shipments[0].tracking_number).toMatch(/^MOCK[0-9A-F]{12}$/);
    const steps = o.events.filter((e: { type: string }) => e.type === 'item_status').map((e: { to: string }) => e.to);
    expect(steps).toEqual(['ROUTED', 'PRINTING', 'QC', 'PASSED', 'SHIPPED']);
    for (const tpl of ['order-paid', 'order-shipped', 'order-delivered']) expect(await w.db.outboxMessage.count({ where: { topic: 'email', key: `${tpl}:${id}` } })).toBe(1);
  });

  it('a part no printer can take waits and retries instead of failing', async () => {
    const { call, apiId, id } = await paidOrder('ASA', [240, 240, 100]);
    await processOrder(w, { op: 'route', orderId: id });
    const o = (await call('GET', `/v1/orders/${apiId}`)).json();
    expect(o.status).toBe('PAID');
    expect(o.events.some((e: { type: string }) => e.type === 'routing_failed')).toBe(true);
  });

  it('a canceled order is never routed', async () => {
    const { call, apiId, id } = await paidOrder();
    await call('POST', `/v1/orders/${apiId}/cancel`);
    await processOrder(w, { op: 'route', orderId: id });
    expect((await call('GET', `/v1/orders/${apiId}`)).json().status).toBe('CANCELED');
  });
});
