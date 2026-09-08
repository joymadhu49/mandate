import type { Order } from './types.js';

export function cancelOrder(order: Order, account: string, now = Math.floor(Date.now() / 1000)) {
  if (order.account.toLowerCase() !== account.toLowerCase()) return 'not-found' as const;
  if (order.status !== 'queued') return 'not-queued' as const;
  order.status = 'cancelled';
  order.updatedAt = now;
  return 'cancelled' as const;
}
