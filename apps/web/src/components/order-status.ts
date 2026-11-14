/** Badge tone for an order status. */
export const orderTone = (s: string) =>
  s === 'DELIVERED' || s === 'SHIPPED'
    ? 'pass'
    : s === 'CANCELED' || s === 'EXPIRED' || s === 'REFUNDED'
      ? 'neutral'
      : s === 'ON_HOLD'
        ? 'warn'
        : 'accent';
