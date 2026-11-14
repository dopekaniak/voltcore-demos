import { z } from 'zod';
import { defineRoute, idParam, page } from './route';

/** Checkout and orders (build prompt 5.4, 5.5, slice 8). Amounts are integer minor units. */

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(100),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postal_code: z.string().trim().min(2).max(20),
  /** ISO 3166-1 alpha-2. Mock partners ship to the US only for now. */
  country: z.string().trim().length(2).toUpperCase(),
  phone: z.string().trim().max(30).optional(),
});
export const SHIP_COUNTRIES = ['US'] as const;

export const orderItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  quantity: z.number().int(),
  unit_price_minor: z.number().int(),
  line_total_minor: z.number().int(),
  material: z.string().nullable(),
  status: z.string(),
  partner_city: z.string().nullable(),
});
export const orderEventSchema = z.object({ type: z.string(), from: z.string().nullable(), to: z.string().nullable(), item_id: z.string().nullable(), note: z.string().nullable(), at: z.string() });
export const shipmentSchema = z.object({ carrier: z.string(), tracking_number: z.string(), status: z.string(), events: z.array(z.object({ status: z.string(), at: z.string() })) });
export const orderSummary = z.object({
  id: z.string(),
  status: z.string(),
  total_minor: z.number().int(),
  currency: z.string(),
  items: z.number().int(),
  is_estimate: z.boolean(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
});
export const orderDetail = orderSummary.omit({ items: true }).extend({
  subtotal_minor: z.number().int(),
  shipping_minor: z.number().int(),
  tax_minor: z.number().int(),
  tax_note: z.string(),
  shipping_method: z.string(),
  address: addressSchema,
  items: z.array(orderItemSchema),
  events: z.array(orderEventSchema),
  shipments: z.array(shipmentSchema),
  can_cancel: z.boolean(),
  checkout_url: z.string().nullable(),
  payments_mode: z.enum(['mock', 'stripe-test']),
});

export const checkout = defineRoute({
  method: 'POST',
  path: '/v1/checkout',
  summary: 'Create an order from the cart and start payment (the server reprices every item)',
  tag: 'orders',
  auth: 'session',
  idempotent: true,
  body: z.object({ address: addressSchema, accept_terms: z.literal(true) }),
  status: 201,
  response: z.object({ order: orderDetail, checkout_url: z.string() }),
});

export const listOrders = defineRoute({ method: 'GET', path: '/v1/orders', summary: 'Your orders, newest first', tag: 'orders', auth: 'user', scope: 'orders:read', query: z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }), response: page(orderSummary) });
export const getOrder = defineRoute({ method: 'GET', path: '/v1/orders/:id', summary: 'An order with items, timeline, and tracking', tag: 'orders', auth: 'user', scope: 'orders:read', params: idParam, response: orderDetail });
export const cancelOrder = defineRoute({
  method: 'POST',
  path: '/v1/orders/:id/cancel',
  summary: 'Cancel before payment, or within the cancel window before printing starts (refunded in full)',
  tag: 'orders',
  auth: 'session',
  params: idParam,
  response: orderDetail,
});

/** Stripe (or the mock) calls this. Signature on the raw body; events are stored and processed once. */
export const paymentWebhook = defineRoute({ method: 'POST', path: '/v1/webhooks/payments', summary: 'Payment provider webhook', tag: 'internal', auth: 'internal', response: z.object({ received: z.literal(true), duplicate: z.boolean() }) });

/** Mock payments only: the test payment page reads the session and completes or abandons it. */
export const mockSession = defineRoute({
  method: 'GET',
  path: '/v1/checkout/mock/:id',
  summary: 'Mock payment session (PAYMENTS_MODE=mock only)',
  tag: 'orders',
  auth: 'session',
  params: idParam,
  response: z.object({ id: z.string(), order_id: z.string(), amount_minor: z.number().int(), currency: z.string(), status: z.string() }),
});
export const mockComplete = defineRoute({
  method: 'POST',
  path: '/v1/checkout/mock/:id/complete',
  summary: 'Mock payment: pay or abandon. Sends a signed event through the real webhook route.',
  tag: 'orders',
  auth: 'session',
  params: idParam,
  body: z.object({ outcome: z.enum(['paid', 'expired']) }),
  response: z.object({ order_id: z.string(), status: z.string() }),
});
